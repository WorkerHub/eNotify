import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { getMigrations } from "../src/lib/migrations";
import type { Env } from "../src/types";
import { schedulerTickKey } from "../src/db/queries/scheduler-ticks";
import { MockKV, TEST_JWT_SECRET, TEST_SETUP_SECRET } from "./helpers";
import { SqliteD1 } from "./support/sqlite-d1";

const handleScheduledMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/services/scheduler", () => ({
  handleScheduled: handleScheduledMock,
}));

const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);
const HOUR_MS = 3_600_000;
const TEST_WAKER_KEY = "test-waker-signing-key";

/** The SPA fallback in front of every route would answer this with 200 HTML. */
function htmlAssets(): { fetch: () => Promise<Response> } {
  return {
    fetch: async () =>
      new Response("<!DOCTYPE html><html><body>spa</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  };
}

function applySchemaV3(d1: SqliteD1, prefix: string): void {
  const migration = getMigrations(prefix).find((m) => m.name === "schema_v3");
  if (!migration) throw new Error("schema_v3 missing");
  for (const statement of migration.sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    d1.db.exec(statement);
  }
}

function makeEnv(d1: SqliteD1, overrides: Record<string, unknown> = {}): Env {
  return {
    DB: d1,
    KV: new MockKV(),
    JWT_SECRET: TEST_JWT_SECRET,
    SETUP_SECRET: TEST_SETUP_SECRET,
    TABLE_PREFIX: "",
    ASSETS: htmlAssets(),
    ...overrides,
  } as unknown as Env;
}

function scheduledEvent(scheduledTime: number): ScheduledEvent {
  return {
    scheduledTime,
    cron: "0 * * * *",
    noRetry: () => {},
    waitUntil: () => {},
  } as unknown as ScheduledEvent;
}

function claimRows(d1: SqliteD1): { tick_key: string; source: string }[] {
  return d1.db
    .prepare("SELECT tick_key, source FROM scheduler_tick_claims")
    .all() as { tick_key: string; source: string }[];
}

beforeEach(() => {
  handleScheduledMock.mockReset();
  handleScheduledMock.mockImplementation(async () => {});
});

describe("native scheduled() entry", () => {
  it("claims the hour of event.scheduledTime as source cron", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);

    await worker.scheduled(scheduledEvent(T0), env);

    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
    expect(claimRows(d1)).toEqual([
      { tick_key: schedulerTickKey(T0), source: "cron" },
    ]);
  });

  it("does not sweep the same hour twice", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);

    await worker.scheduled(scheduledEvent(T0), env);
    await worker.scheduled(scheduledEvent(T0), env);

    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
  });

  it("waits for the business pass before resolving (no waitUntil + early return)", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);
    let finished = false;
    handleScheduledMock.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished = true;
    });

    await worker.scheduled(scheduledEvent(T0), env);

    expect(finished).toBe(true);
  });

  it("still runs when the claim table is missing and no waker key is set", async () => {
    const d1 = new SqliteD1(); // migration not applied
    const env = makeEnv(d1);
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

    await worker.scheduled(scheduledEvent(T0), env);

    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
    errorMock.mockRestore();
  });

  it("skips the sweep when the claim table is missing and a waker key is set", async () => {
    const d1 = new SqliteD1();
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

    await worker.scheduled(scheduledEvent(T0), env);

    expect(handleScheduledMock).not.toHaveBeenCalled();
    expect(
      errorMock.mock.calls.some(([line]) =>
        String(line).includes("scheduler_tick_claim_unavailable"),
      ),
    ).toBe(true);
    errorMock.mockRestore();
  });

  it("runs every distinct hour", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);

    await worker.scheduled(scheduledEvent(T0), env);
    await worker.scheduled(scheduledEvent(T0 + HOUR_MS), env);

    expect(handleScheduledMock).toHaveBeenCalledTimes(2);
    expect(claimRows(d1).map((r) => r.tick_key)).toEqual([
      schedulerTickKey(T0),
      schedulerTickKey(T0 + HOUR_MS),
    ]);
  });
});

describe("/_waker is mounted before the SPA fallback", () => {
  it("answers an unsigned POST with 400 JSON, never the 200 HTML fallback", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);

    const res = await worker.fetch(
      new Request("https://notify.example.com/_waker/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      env,
      {} as ExecutionContext,
    );
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    expect(text).not.toContain("<!DOCTYPE");
    expect(handleScheduledMock).not.toHaveBeenCalled();
  });

  it("answers GET /_waker/execute with 404, not the SPA document", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);

    const res = await worker.fetch(
      new Request("https://notify.example.com/_waker/execute"),
      env,
      {} as ExecutionContext,
    );
    const text = await res.text();

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
    expect(text).not.toContain("<!DOCTYPE");
  });

  it("keeps the SPA fallback for ordinary GET routes", async () => {
    const d1 = new SqliteD1();
    const env = makeEnv(d1);

    const res = await worker.fetch(
      new Request("https://notify.example.com/items/123"),
      env,
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
  });
});
