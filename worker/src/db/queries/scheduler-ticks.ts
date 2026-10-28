/**
 * Cross-entry scheduler tick claims + waker execution-ledger table names.
 *
 * Why this table exists: while the native Cloudflare cron trigger and a waker
 * declarative job both fire at the same hour, only one of them may run the
 * hourly scan. D1/SQLite gives us a single-statement atomic claim
 * (`INSERT ... ON CONFLICT(tick_key) DO NOTHING` + `meta.changes`), which is the
 * same primitive the waker SDK ledger already uses for executionId idempotency
 * — no hand-rolled distributed lock, no read-then-write window.
 *
 * Table names are always built here and resolved through `getTablePrefix(env)`
 * by the caller; the prefix is never hard-coded.
 */

/** Suffix of the SDK executionId idempotency ledger (created by `schema_v3`). */
export const WAKER_EXECUTIONS_TABLE = "waker_executions";

/** Suffix of the per-hour cross-entry claim table (created by `schema_v3`). */
export const SCHEDULER_TICK_CLAIMS_TABLE = "scheduler_tick_claims";

/** Which entry point claimed the hour; observability only, never used for routing. */
export type SchedulerTickSource = "cron" | "waker";

/** `{prefix}waker_executions`. */
export function wakerExecutionsTable(prefix: string): string {
  return `${prefix}${WAKER_EXECUTIONS_TABLE}`;
}

/** `{prefix}scheduler_tick_claims`. */
export function schedulerTickClaimsTable(prefix: string): string {
  return `${prefix}${SCHEDULER_TICK_CLAIMS_TABLE}`;
}

/**
 * Nominal hour slot of a trigger, as the claim key: `"hour:<epoch ms>"`.
 *
 * Both entry points round their *nominal* scheduled time (cron
 * `event.scheduledTime`, waker `ctx.scheduledFor`) to the hour, so a waker
 * misfire replay still maps onto the same slot as the cron firing it is
 * competing with. Hours do not depend on the process timezone: the epoch value
 * is UTC-based.
 */
export function schedulerTickKey(scheduledFor: number): string {
  const slot = Math.floor(scheduledFor / 3_600_000) * 3_600_000;
  return `hour:${slot}`;
}

export interface SchedulerTickClaimRow {
  tick_key: string;
  source: string;
  claimed_at: number;
}

/**
 * Try to win one hour slot. Returns `true` when this caller inserted the row
 * (`meta.changes > 0`), `false` when the slot is already claimed.
 */
export async function claimSchedulerTick(
  db: D1Database,
  prefix: string,
  tickKey: string,
  source: SchedulerTickSource,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO ${schedulerTickClaimsTable(prefix)} (tick_key, source, claimed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(tick_key) DO NOTHING`,
    )
    .bind(tickKey, source, now)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Read the claim of one hour slot (only used to report who won it). */
export async function getSchedulerTickClaim(
  db: D1Database,
  prefix: string,
  tickKey: string,
): Promise<SchedulerTickClaimRow | null> {
  return db
    .prepare(
      `SELECT tick_key, source, claimed_at FROM ${schedulerTickClaimsTable(prefix)}
       WHERE tick_key = ?`,
    )
    .bind(tickKey)
    .first<SchedulerTickClaimRow>();
}

/**
 * Drop a claim this source made, so a waker retry (same executionId) can claim
 * the hour again. Scoped by `source` so it can never release the other entry's
 * claim.
 */
export async function releaseSchedulerTick(
  db: D1Database,
  prefix: string,
  tickKey: string,
  source: SchedulerTickSource,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM ${schedulerTickClaimsTable(prefix)} WHERE tick_key = ? AND source = ?`,
    )
    .bind(tickKey, source)
    .run();
}

/** Delete claims older than `beforeEpochMs` (7-day retention, keeps the table small). */
export async function pruneSchedulerTicks(
  db: D1Database,
  prefix: string,
  beforeEpochMs: number,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM ${schedulerTickClaimsTable(prefix)} WHERE claimed_at < ?`,
    )
    .bind(beforeEpochMs)
    .run();
}
