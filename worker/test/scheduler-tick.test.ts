import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMigrations } from "../src/lib/migrations";
import type { Env } from "../src/types";
import {
  claimSchedulerTick,
  getSchedulerTickClaim,
  releaseSchedulerTick,
  schedulerTickClaimsTable,
  schedulerTickKey,
} from "../src/db/queries/scheduler-ticks";
import {
  runSchedulerTick,
  wakerExecutionsTable,
  wakerSigningKey,
} from "../src/services/scheduler-tick";
import { MockKV, TEST_JWT_SECRET, TEST_SETUP_SECRET } from "./helpers";
import { SqliteD1 } from "./support/sqlite-d1";

// The business pass is the one thing this suite must not re-implement: it is
// mocked so the tests can count "did the hourly scan run" exactly.
const handleScheduledMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/services/scheduler", () => ({
  handleScheduled: handleScheduledMock,
}));

const HOUR_MS = 3_600_000;
/** Fixed nominal hour: 2026-10-28 10:00:00 UTC. */
const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);
const TEST_WAKER_KEY = "test-waker-signing-key";

/** Apply the real schema_v3 DDL for a resolved prefix. */
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

function makeTickEnv(
  d1: SqliteD1,
  overrides: Record<string, unknown> = {},
): Env {
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

beforeEach(() => {
  handleScheduledMock.mockReset();
  handleScheduledMock.mockImplementation(async () => {});
});

describe("schedulerTickKey", () => {
  it("rounds to the UTC hour slot", () => {
    expect(schedulerTickKey(T0)).toBe(`hour:${T0}`);
    expect(schedulerTickKey(T0 + 59 * 60 * 1000 + 59_999)).toBe(`hour:${T0}`);
    expect(schedulerTickKey(T0 + HOUR_MS)).toBe(`hour:${T0 + HOUR_MS}`);
  });

  it("keeps adjacent hour boundaries distinct", () => {
    const lastMs = T0 - 1; // 09:59:59.999
    expect(schedulerTickKey(lastMs)).not.toBe(schedulerTickKey(T0));
    expect(schedulerTickKey(lastMs)).toBe(`hour:${T0 - HOUR_MS}`);
  });
});

describe("wakerSigningKey gate", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "   \t  "],
    ["placeholder", "some-value_PLACEHOLDER"],
  ])("treats %s as not configured", (_name, value) => {
    expect(wakerSigningKey({ WAKER_SIGNING_KEY: value } as never)).toBeNull();
  });

  it("returns the trimmed value when configured", () => {
    expect(
      wakerSigningKey({ WAKER_SIGNING_KEY: `  ${TEST_WAKER_KEY}  ` } as never),
    ).toBe(TEST_WAKER_KEY);
  });
});

describe("claimSchedulerTick", () => {
  it("lets exactly one of two claims for the same hour win", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const key = schedulerTickKey(T0);

    expect(await claimSchedulerTick(d1 as never, "", key, "cron", 1)).toBe(
      true,
    );
    expect(await claimSchedulerTick(d1 as never, "", key, "waker", 2)).toBe(
      false,
    );

    expect(await getSchedulerTickClaim(d1 as never, "", key)).toEqual({
      tick_key: key,
      source: "cron",
      claimed_at: 1,
    });
    expect(countRows(d1, "scheduler_tick_claims")).toBe(1);
  });

  it("releases only the claim made by the releasing source", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const key = schedulerTickKey(T0);
    await claimSchedulerTick(d1 as never, "", key, "cron", 1);

    await releaseSchedulerTick(d1 as never, "", key, "waker");
    expect(countRows(d1, "scheduler_tick_claims")).toBe(1);

    await releaseSchedulerTick(d1 as never, "", key, "cron");
    expect(countRows(d1, "scheduler_tick_claims")).toBe(0);
  });
});

describe("runSchedulerTick — cross-entry guard", () => {
  it("runs the business pass once per hour across both entry points", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeTickEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });

    const sources = ["cron", "waker"] as const;
    const results = await Promise.all(
      sources.map((source) =>
        runSchedulerTick(env, { source, scheduledFor: T0 }),
      ),
    );

    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.executed)).toHaveLength(1);
    const duplicate = results.find((r) => r.reason === "duplicate_tick");
    expect(duplicate).toBeDefined();
    const winnerIndex = results.findIndex((r) => r.executed);
    const loserIndex = results.findIndex((r) => r.reason === "duplicate_tick");
    expect(duplicate?.claimedBy).toBe(sources[winnerIndex]);
    expect(loserIndex).not.toBe(winnerIndex);
    expect(countRows(d1, "scheduler_tick_claims")).toBe(1);
  });

  it("runs each distinct hour once", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeTickEnv(d1);

    const first = await runSchedulerTick(env, {
      source: "cron",
      scheduledFor: T0,
    });
    const second = await runSchedulerTick(env, {
      source: "cron",
      scheduledFor: T0 + HOUR_MS,
    });

    expect(first.executed).toBe(true);
    expect(second.executed).toBe(true);
    expect(handleScheduledMock).toHaveBeenCalledTimes(2);
    expect(countRows(d1, "scheduler_tick_claims")).toBe(2);
  });

  it("does not re-run an hour the other entry point already claimed", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeTickEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });
    await claimSchedulerTick(
      d1 as never,
      "",
      schedulerTickKey(T0),
      "cron",
      Date.now(),
    );

    const result = await runSchedulerTick(env, {
      source: "waker",
      scheduledFor: T0 + 30_000,
    });

    expect(result).toMatchObject({
      executed: false,
      reason: "duplicate_tick",
      claimedBy: "cron",
      tickKey: schedulerTickKey(T0),
    });
    expect(handleScheduledMock).not.toHaveBeenCalled();
  });
});

describe("runSchedulerTick — failure semantics", () => {
  it("releases the hour on a waker failure so the retry can finish the job", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeTickEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });
    handleScheduledMock.mockRejectedValueOnce(new Error("hour blew up"));

    await expect(
      runSchedulerTick(env, { source: "waker", scheduledFor: T0 }),
    ).rejects.toThrow("hour blew up");
    expect(countRows(d1, "scheduler_tick_claims")).toBe(0);

    const retry = await runSchedulerTick(env, {
      source: "waker",
      scheduledFor: T0,
    });
    expect(retry.executed).toBe(true);
    expect(handleScheduledMock).toHaveBeenCalledTimes(2);
    expect(countRows(d1, "scheduler_tick_claims")).toBe(1);
  });

  it("keeps the claim on a cron failure so the hour is not swept twice", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeTickEnv(d1);
    handleScheduledMock.mockRejectedValueOnce(new Error("cron blew up"));

    const failed = await runSchedulerTick(env, {
      source: "cron",
      scheduledFor: T0,
    });
    expect(failed).toMatchObject({ executed: false, reason: "job_failed" });
    expect(countRows(d1, "scheduler_tick_claims")).toBe(1);

    const again = await runSchedulerTick(env, {
      source: "cron",
      scheduledFor: T0,
    });
    expect(again).toMatchObject({
      executed: false,
      reason: "duplicate_tick",
      claimedBy: "cron",
    });
    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
  });

  it("runs anyway when the claim table is unavailable and no waker key is set", async () => {
    // Fresh DB: scheduler_tick_claims does not exist (migration not applied).
    const d1 = new SqliteD1();
    const env = makeTickEnv(d1);
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runSchedulerTick(env, {
      source: "cron",
      scheduledFor: T0,
    });

    expect(result.executed).toBe(true);
    expect(handleScheduledMock).toHaveBeenCalledTimes(1);
    expect(
      errorMock.mock.calls.some(([line]) =>
        String(line).includes("scheduler_tick_claim_unavailable"),
      ),
    ).toBe(true);
    errorMock.mockRestore();
  });

  it("fails safe on both entries when the claim table is unavailable and a waker key is set", async () => {
    const d1 = new SqliteD1();
    const env = makeTickEnv(d1, { WAKER_SIGNING_KEY: TEST_WAKER_KEY });
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

    const cronResult = await runSchedulerTick(env, {
      source: "cron",
      scheduledFor: T0,
    });
    expect(cronResult).toMatchObject({
      executed: false,
      reason: "claim_unavailable",
    });
    expect(handleScheduledMock).not.toHaveBeenCalled();

    await expect(
      runSchedulerTick(env, { source: "waker", scheduledFor: T0 }),
    ).rejects.toThrow(/no such table/);
    expect(handleScheduledMock).not.toHaveBeenCalled();
    errorMock.mockRestore();
  });
});

describe("runSchedulerTick — housekeeping and prefixes", () => {
  it("prunes claims older than 7 days and keeps recent ones", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const now = Date.now();
    d1.db
      .prepare(
        "INSERT INTO scheduler_tick_claims (tick_key, source, claimed_at) VALUES (?, ?, ?)",
      )
      .run("hour:old", "cron", now - 8 * 24 * HOUR_MS);
    d1.db
      .prepare(
        "INSERT INTO scheduler_tick_claims (tick_key, source, claimed_at) VALUES (?, ?, ?)",
      )
      .run("hour:recent", "waker", now - 24 * HOUR_MS);

    const env = makeTickEnv(d1);
    await runSchedulerTick(env, { source: "cron", scheduledFor: now });

    const keys = (
      d1.db.prepare("SELECT tick_key FROM scheduler_tick_claims").all() as {
        tick_key: string;
      }[]
    ).map((r) => r.tick_key);
    expect(keys).not.toContain("hour:old");
    expect(keys).toContain("hour:recent");
    expect(keys).toContain(schedulerTickKey(now));
  });

  it("keeps the tick result even when pruning fails", async () => {
    const d1 = new SqliteD1();
    applySchemaV3(d1, "");
    const env = makeTickEnv(d1);
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});
    // The business pass succeeds but leaves no claim table for the prune step.
    handleScheduledMock.mockImplementationOnce(async () => {
      d1.db.exec("DROP TABLE scheduler_tick_claims");
    });

    const result = await runSchedulerTick(env, {
      source: "cron",
      scheduledFor: T0,
    });

    expect(result.executed).toBe(true);
    expect(
      errorMock.mock.calls.some(([line]) =>
        String(line).includes("scheduler_tick_prune_failed"),
      ),
    ).toBe(true);
    errorMock.mockRestore();
  });

  it.each([
    ["default", undefined, "enotify_"],
    ["explicit empty", "", ""],
    ["custom", "eNotify", "eNotify_"],
  ])(
    "resolves the claim table for the %s TABLE_PREFIX state",
    async (_n, prefix, resolved) => {
      const d1 = new SqliteD1();
      applySchemaV3(d1, resolved);
      const env = makeTickEnv(d1, { TABLE_PREFIX: prefix });

      const result = await runSchedulerTick(env, {
        source: "cron",
        scheduledFor: T0,
      });

      const table = schedulerTickClaimsTable(resolved);
      expect(table).toBe(`${resolved}scheduler_tick_claims`);
      expect(result.executed).toBe(true);
      expect(countRows(d1, table)).toBe(1);
    },
  );

  it("names the waker ledger table with the resolved prefix", () => {
    expect(wakerExecutionsTable("enotify_")).toBe("enotify_waker_executions");
    expect(wakerExecutionsTable("")).toBe("waker_executions");
    expect(wakerExecutionsTable("eNotify_")).toBe("eNotify_waker_executions");
  });
});
