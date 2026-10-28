import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMigrations } from "../src/lib/migrations";
import type { Env } from "../src/types";
import { CALLBACK_MOUNT_PATH } from "../src/waker";
import { wakerRoutes } from "../src/routes/waker";
import { WAKER_JOB_NAME } from "../src/services/waker-callback";
import { schedulerTickKey } from "../src/db/queries/scheduler-ticks";
import { MockKV, TEST_JWT_SECRET, TEST_SETUP_SECRET } from "./helpers";
import { SqliteD1 } from "./support/sqlite-d1";

// Business pass mocked: the receiver contract is about verification, idempotency
// and cross-entry claims, and the count of business runs must be exact.
const handleScheduledMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/services/scheduler", () => ({
  handleScheduled: handleScheduledMock,
}));

const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);
const TEST_WAKER_KEY = "test-waker-signing-key";

const app = new Hono();
app.route(CALLBACK_MOUNT_PATH, wakerRoutes());

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
    ASSETS: {},
    ...overrides,
  } as unknown as Env;
}

function countRows(d1: SqliteD1, table: string): number {
  const row = d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
    n: number;
  };
  return Number(row.n);
}

interface CallbackOptions {
  executionId?: string;
  jobId?: string;
  jobName?: string;
  scheduledFor?: number;
  payload?: unknown;
}

/** The exact wire body: signatures are computed over this unparsed string. */
function callbackBody(options: CallbackOptions = {}): string {
  return JSON.stringify({
    protocolVersion: 2,
    executionId: options.executionId ?? "exec-1",
    jobId: options.jobId ?? "job-1",
    projectId: "project-1",
    jobName: options.jobName ?? WAKER_JOB_NAME,
    kind: "cron",
    trigger: "schedule",
    misfire: false,
    attempt: 0,
    scheduledFor: options.scheduledFor ?? T0,
    dispatchedAt: (options.scheduledFor ?? T0) + 1_000,
    timeoutSeconds: 300,
    payload: options.payload ?? {},
  });
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

async function signedHeaders(
  body: string,
  options: {
    key?: string;
    executionId?: string;
    jobId?: string;
    timestampSeconds?: number;
  } = {},
): Promise<Record<string, string>> {
  const key = options.key ?? TEST_WAKER_KEY;
  const executionId = options.executionId ?? "exec-1";
  const jobId = options.jobId ?? "job-1";
  const timestamp = String(
    options.timestampSeconds ?? Math.floor(Date.now() / 1000),
  );
  const hex = await hmacHex(
    key,
    `${timestamp}\n${executionId}\n${jobId}\n${body}`,
  );
  return {
    "Content-Type": "application/json",
    "X-Waker-Timestamp": timestamp,
    "X-Waker-Execution-Id": executionId,
    "X-Waker-Job-Id": jobId,
    "X-Waker-Project-Id": "project-1",
    "X-Waker-Attempt": "0",
    "X-Waker-Signature": `v2=${hex}`,
    "X-Waker-Protocol-Version": "2",
  };
}

async function post(
  env: Env,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string; json: any; contentType: string }> {
  const res = await app.request(
    CALLBACK_MOUNT_PATH + "/execute",
    { method: "POST", headers, body },
    env,
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    text,
    json,
    contentType: res.headers.get("content-type") ?? "",
  };
}

beforeEach(() => {
  handleScheduledMock.mockReset();
  handleScheduledMock.mockImplementation(async () => {});
});

describe("unconfigured signing key", () => {
  it("fails closed with 500 JSON and never touches the DB or the business", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1); // no WAKER_SIGNING_KEY

    const body = callbackBody();
    const result = await post(env, body, await signedHeaders(body));

    expect(result.status).toBe(500);
    expect(result.json).toEqual({
      ok: false,
      error: {
        code: "signing_key_missing",
        message: expect.stringContaining("WAKER_SIGNING_KEY"),
      },
    });
    expect(result.contentType).toContain("application/json");
    expect(handleScheduledMock).not.toHaveBeenCalled();
    expect(countRows(d1, "waker_executions")).toBe(0);
    expect(countRows(d1, "scheduler_tick_claims")).toBe(0);
  });

  it("still answers 400 for a request without signature headers", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);

    const result = await post(env, callbackBody(), {});

    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe("invalid_request");
    expect(handleScheduledMock).not.toHaveBeenCalled();
  });

  it("never answers GET with the SPA's 200 HTML", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1);

    const res = await app.request(
      CALLBACK_MOUNT_PATH + "/execute",
      { method: "GET" },
      env,
    );
    const text = await res.text();

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
    expect(text).not.toContain("<!DOCTYPE");
  });
});

describe("callback verification", () => {
  it("accepts a correctly signed callback and runs the sweep once", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const body = callbackBody();
    const result = await post(env, body, await signedHeaders(body));

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      ok: true,
      executed: true,
      reason: "executed",
      tickKey: schedulerTickKey(T0),
    });
    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
    expect(countRows(d1, "scheduler_tick_claims")).toBe(1);
    const ledger = d1.db
      .prepare("SELECT execution_id, status FROM waker_executions")
      .all() as { execution_id: string; status: string }[];
    expect(ledger).toEqual([{ execution_id: "exec-1", status: "succeeded" }]);
  });

  it("replays a duplicate executionId without re-running the business", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const body = callbackBody({ executionId: "exec-replay" });
    const headers = await signedHeaders(body, { executionId: "exec-replay" });
    const first = await post(env, body, headers);
    const second = await post(env, body, headers);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({
      ok: true,
      duplicate: true,
      executed: true,
      reason: "executed",
    });
    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
    expect(countRows(d1, "scheduler_tick_claims")).toBe(1);
  });

  it("rejects a stale timestamp", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const body = callbackBody();
    const headers = await signedHeaders(body, {
      timestampSeconds: Math.floor(Date.now() / 1000) - 400,
    });
    const result = await post(env, body, headers);

    expect(result.status).toBe(401);
    expect(result.json.error.code).toBe("stale_timestamp");
    expect(handleScheduledMock).not.toHaveBeenCalled();
    expect(countRows(d1, "waker_executions")).toBe(0);
  });

  it("rejects a tampered signature", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const body = callbackBody();
    const headers = await signedHeaders(body);
    const signature = headers["X-Waker-Signature"];
    headers["X-Waker-Signature"] =
      signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
    const result = await post(env, body, headers);

    expect(result.status).toBe(401);
    expect(result.json.error.code).toBe("invalid_signature");
    expect(handleScheduledMock).not.toHaveBeenCalled();
  });

  it("answers 404 for an undeclared job name", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const body = callbackBody({ jobName: "some-other-job" });
    const headers = await signedHeaders(body);
    const result = await post(env, body, headers);

    expect(result.status).toBe(404);
    expect(result.json.error.code).toBe("unknown_job");
    expect(handleScheduledMock).not.toHaveBeenCalled();
  });

  it("does not echo the signing key or the payload in the response", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const body = callbackBody({ payload: { marker: "payload-marker-value" } });
    const result = await post(env, body, await signedHeaders(body));

    expect(result.status).toBe(200);
    expect(result.text).not.toContain(TEST_WAKER_KEY);
    expect(result.text).not.toContain("payload-marker-value");
  });
});

describe("cross-entry claim from the callback", () => {
  it("reports duplicate_tick and skips the sweep when cron owns the hour", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    d1.db
      .prepare(
        "INSERT INTO scheduler_tick_claims (tick_key, source, claimed_at) VALUES (?, ?, ?)",
      )
      .run(schedulerTickKey(T0), "cron", Date.now());
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const body = callbackBody();
    const result = await post(env, body, await signedHeaders(body));

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      ok: true,
      executed: false,
      reason: "duplicate_tick",
      claimedBy: "cron",
      tickKey: schedulerTickKey(T0),
    });
    expect(handleScheduledMock).not.toHaveBeenCalled();
  });

  it("releases the executionId and the hour on failure so a retry completes the job", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });
    handleScheduledMock.mockRejectedValueOnce(new Error("sweep exploded"));

    const body = callbackBody({ executionId: "exec-retry" });
    const headers = await signedHeaders(body, { executionId: "exec-retry" });
    const failed = await post(env, body, headers);

    expect(failed.status).toBe(500);
    expect(failed.json.error.code).toBe("job_failed");
    expect(countRows(d1, "waker_executions")).toBe(0);
    expect(countRows(d1, "scheduler_tick_claims")).toBe(0);

    const retry = await post(env, body, headers);
    expect(retry.status).toBe(200);
    expect(retry.json).toMatchObject({ ok: true, executed: true });
    expect(handleScheduledMock).toHaveBeenCalledTimes(2);
  });
});
