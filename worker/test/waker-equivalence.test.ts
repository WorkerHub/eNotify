/**
 * Acceptance evidence for "business equivalence": the same seeded data swept
 * through the native cron entry and through the waker callback must produce the
 * same notifications and the same history rows.
 *
 * This file deliberately does **not** mock the scheduler — both runs go through
 * the real `handleScheduled`, so the comparison covers channels, message
 * content and history records (`trigger_source` included).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { runSetup } from "../src/lib/setup";
import { CALLBACK_MOUNT_PATH } from "../src/waker";
import { WAKER_JOB_NAME } from "../src/services/waker-callback";
import { MockKV, TEST_JWT_SECRET, TEST_SETUP_SECRET } from "./helpers";
import { SqliteD1 } from "./support/sqlite-d1";

const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);
const TEST_WAKER_KEY = "test-waker-signing-key";

const htmlAssets = {
  fetch: async () =>
    new Response("<!DOCTYPE html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
};

/** Fresh env with the real migrated schema (schema_v1..v3) and the same fixture. */
async function seededEnv(
  overrides: Record<string, unknown> = {},
): Promise<{ env: Env; d1: SqliteD1 }> {
  const d1 = new SqliteD1();
  const env = {
    DB: d1,
    KV: new MockKV(),
    JWT_SECRET: TEST_JWT_SECRET,
    SETUP_SECRET: TEST_SETUP_SECRET,
    TABLE_PREFIX: "",
    ASSETS: htmlAssets,
    ...overrides,
  } as unknown as Env;
  const setup = await runSetup(env);
  expect(setup.success).toBe(true);

  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  d1.db
    .prepare(
      `INSERT INTO users (id, email, password_hash, timezone, language, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run("user-1", "user@example.com", "hash", "UTC", "en", now, now);
  d1.db
    .prepare(
      `INSERT INTO notification_configs
       (user_id, enabled_channels, default_channel, telegram_config, notification_hours, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "user-1",
      JSON.stringify(["telegram"]),
      "telegram",
      JSON.stringify({ bot_token: "token", chat_id: "1" }),
      "[]",
      now,
    );
  d1.db
    .prepare(
      `INSERT INTO items
       (id, user_id, name, item_mode, expiry_date, period_value, period_unit,
        reminder_unit, reminder_value, currency, is_active, auto_renew,
        calendar_mode, channels, notification_hours, item_kind, created_at, updated_at)
       VALUES (?, ?, ?, 'cycle', ?, 1, 'month', 'day', 7, 'CNY', 1, 0,
        'solar', '[]', '[]', 'subscription', ?, ?)`,
    )
    .run("item-1", "user-1", "Equivalence item", expiry, now, now);

  return { env, d1 };
}

interface HistoryRow {
  channel: string;
  title: string;
  body: string;
  success: number;
  trigger_source: string | null;
}

/** Normalize the "sent at" wall clock so two runs in the same minute compare. */
function normalizeBody(body: string): string {
  return body.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "<time>");
}

function historyOf(d1: SqliteD1): HistoryRow[] {
  return (
    d1.db
      .prepare(
        `SELECT channel, title, body, success, trigger_source
         FROM notification_history ORDER BY title`,
      )
      .all() as HistoryRow[]
  ).map((row) => ({ ...row, body: normalizeBody(row.body) }));
}

async function hmacHex(key: string, message: string): Promise<string> {
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    imported,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Deliver one signed waker callback through the real worker entry. */
async function postWakerTick(
  env: Env,
  executionId: string,
  options: { scheduledFor?: number; trigger?: "schedule" | "manual" } = {},
) {
  const scheduledFor = options.scheduledFor ?? T0;
  const body = JSON.stringify({
    protocolVersion: 2,
    executionId,
    jobId: "job-hourly",
    projectId: "project-enotify",
    jobName: WAKER_JOB_NAME,
    kind: "cron",
    trigger: options.trigger ?? "schedule",
    misfire: false,
    attempt: 0,
    scheduledFor,
    dispatchedAt: scheduledFor + 1_000,
    timeoutSeconds: 300,
    payload: {},
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hex = await hmacHex(
    TEST_WAKER_KEY,
    `${timestamp}\n${executionId}\njob-hourly\n${body}`,
  );
  const res = await worker.fetch(
    new Request(
      "https://notify.example.com" + CALLBACK_MOUNT_PATH + "/execute",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Waker-Timestamp": timestamp,
          "X-Waker-Execution-Id": executionId,
          "X-Waker-Job-Id": "job-hourly",
          "X-Waker-Signature": `v2=${hex}`,
        },
        body,
      },
    ),
    env,
    {} as ExecutionContext,
  );
  return { status: res.status, json: await res.json() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("waker callback vs native cron business equivalence", () => {
  it("produces the same sent messages and history rows", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const cron = await seededEnv();
    const waker = await seededEnv({ WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    await worker.scheduled(
      {
        scheduledTime: T0,
        cron: "0 * * * *",
        noRetry: () => {},
        waitUntil: () => {},
      } as unknown as ScheduledEvent,
      cron.env,
    );
    const cronCalls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: normalizeBody(String(init?.body ?? "")),
    }));

    fetchMock.mockClear();
    const callback = await postWakerTick(waker.env, "exec-equivalence");
    const wakerCalls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: normalizeBody(String(init?.body ?? "")),
    }));

    expect(callback.status).toBe(200);
    expect(callback.json).toMatchObject({ ok: true, executed: true });
    expect(wakerCalls).toEqual(cronCalls);
    expect(cronCalls).toHaveLength(1);
    expect(historyOf(cron.d1)).toEqual(historyOf(waker.d1));
    expect(historyOf(cron.d1)).toHaveLength(1);
    expect(historyOf(cron.d1)[0]).toMatchObject({
      channel: "telegram",
      success: 1,
      trigger_source: "item",
      title: expect.stringContaining("Equivalence item"),
    });

    // The two entries only differ in who won the hour.
    expect(
      cron.d1.db.prepare("SELECT source FROM scheduler_tick_claims").all(),
    ).toEqual([{ source: "cron" }]);
    expect(
      waker.d1.db.prepare("SELECT source FROM scheduler_tick_claims").all(),
    ).toEqual([{ source: "waker" }]);
  });

  it("sends nothing extra on a duplicate callback for the same execution", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const waker = await seededEnv({ WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const first = await postWakerTick(waker.env, "exec-once");
    const second = await postWakerTick(waker.env, "exec-once");

    expect(first.json).toMatchObject({ ok: true, executed: true });
    expect(second.json).toMatchObject({ ok: true, duplicate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(historyOf(waker.d1)).toHaveLength(1);
  });

  it("runs a manual trigger through the real worker even when cron owns the hour", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const shared = await seededEnv({ WAKER_SIGNING_KEY: TEST_WAKER_KEY });
    // Cron already claimed 10:00 (and has not swept yet).
    shared.d1.db
      .prepare(
        "INSERT INTO scheduler_tick_claims (tick_key, source, claimed_at) VALUES (?, ?, ?)",
      )
      .run(`hour:${T0}`, "cron", Date.now());

    // Console "run now" sends the dispatch time, not a slot.
    const manual = await postWakerTick(shared.env, "exec-manual", {
      scheduledFor: T0 + 40 * 60 * 1000,
      trigger: "manual",
    });

    expect(manual.status).toBe(200);
    expect(manual.json).toMatchObject({
      ok: true,
      executed: true,
      reason: "executed",
      trigger: "manual",
    });
    expect(manual.json.tickKey).toBeUndefined();
    // The sweep really ran: one push and one history row.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(historyOf(shared.d1)).toHaveLength(1);
    // …and it did not touch cron's hour claim.
    expect(
      shared.d1.db
        .prepare("SELECT tick_key, source FROM scheduler_tick_claims")
        .all(),
    ).toEqual([{ tick_key: `hour:${T0}`, source: "cron" }]);
  });

  it("does not double-notify when both entries fire in the same hour", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const shared = await seededEnv({ WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    await worker.scheduled(
      {
        scheduledTime: T0,
        cron: "0 * * * *",
        noRetry: () => {},
        waitUntil: () => {},
      } as unknown as ScheduledEvent,
      shared.env,
    );
    const callback = await postWakerTick(shared.env, "exec-same-hour");

    expect(callback.status).toBe(200);
    expect(callback.json).toMatchObject({
      ok: true,
      executed: false,
      reason: "duplicate_tick",
      claimedBy: "cron",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(historyOf(shared.d1)).toHaveLength(1);
    expect(
      shared.d1.db
        .prepare("SELECT COUNT(*) AS n FROM scheduler_tick_claims")
        .get(),
    ).toEqual({ n: 1 });
  });
});
