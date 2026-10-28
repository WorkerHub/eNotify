/**
 * The single entry point both schedulers go through: native cron
 * (`scheduled()` in `index.ts`) and the waker callback
 * (`services/waker-callback.ts`).
 *
 * Business logic is untouched: `handleScheduled(env)` from
 * `services/scheduler.ts` is still the only scan/push implementation. This
 * module only adds the cross-entry guard in front of it:
 *
 *   1. claim the nominal hour slot (atomic D1 INSERT … ON CONFLICT DO NOTHING)
 *   2. await the unchanged business pass
 *   3. prune claims older than 7 days
 *
 * Failure semantics (frozen in the migration plan):
 *
 * | situation                          | cron                            | waker                    |
 * |------------------------------------|---------------------------------|--------------------------|
 * | claim statement fails, no key      | log + run anyway (only one entry)| n/a                     |
 * | claim statement fails, key present | log + do not run (safe)         | throw → platform retries |
 * | slot already claimed               | do not run (debug log)          | 2xx duplicate_tick       |
 * | business throws                    | keep claim, log, no re-run      | release claim + throw    |
 * | business succeeds                  | keep claim                      | keep claim               |
 *
 * The asymmetry is deliberate: cron has no retry, so re-running a failed hour
 * would re-notify users it already handled; waker retries carry the same
 * executionId, so releasing the claim resumes rather than duplicates.
 *
 * Two cases need more than the table above:
 *
 * - **Manual trigger / dead-letter replay** (`trigger: "manual"` from the
 *   platform) carries `scheduledFor = dispatch time`, not a nominal slot, and
 *   during the dual-run period cron has usually claimed that hour already. Such
 *   a run does **not** take the hourly slot: the SDK ledger already dedupes the
 *   executionId and the sweep's own KV dedupe keeps reminders and renewals
 *   unique, so the sweep runs and the console's "run now" is not a silent no-op.
 * - **Aborted executions**: if the platform times out or evicts the isolate, the
 *   claim is never released and a retry would see a duplicate hour forever. When
 *   the caller passes `staleClaimMs` (waker only), a claim of the *same* source
 *   older than that window is taken over atomically, so the retry finishes the
 *   hour. The `claimed_at` compare-and-swap keeps it race-free.
 */

import { getTablePrefix } from "../types";
import type { Env } from "../types";
import {
  claimSchedulerTick,
  getSchedulerTickClaim,
  pruneSchedulerTicks,
  releaseSchedulerTick,
  schedulerTickClaimsTable,
  schedulerTickKey,
  takeoverSchedulerTick,
  wakerExecutionsTable,
  type SchedulerTickSource,
} from "../db/queries/scheduler-ticks";
import { handleScheduled } from "./scheduler";

export { schedulerTickClaimsTable, schedulerTickKey, wakerExecutionsTable };
export type { SchedulerTickSource };

/** How long a claim row is kept; only needed to arbitrate near-live hours. */
const CLAIM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The waker signing key, or `null` when the waker receiver is not configured.
 *
 * This is the **only** gate: `WAKER_SIGNING_KEY` present and usable ⇒ the waker
 * entry exists; absent/blank/placeholder ⇒ native cron only. Empty values must
 * never be mistaken for "configured", so `""`, whitespace, `undefined` and the
 * `*_PLACEHOLDER` convention (same as `JWT_SECRET`) all mean "not configured".
 *
 * The trimmed value is what the receiver verifies with — gate and verification
 * always see the same string.
 */
export function wakerSigningKey(
  env: Pick<Env, "WAKER_SIGNING_KEY">,
): string | null {
  const raw = env.WAKER_SIGNING_KEY;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length === 0) return null;
  if (key.endsWith("_PLACEHOLDER")) return null;
  return key;
}

export interface SchedulerTickOptions {
  source: SchedulerTickSource;
  /**
   * Nominal scheduled time (epoch ms): cron `event.scheduledTime` / waker
   * `ctx.scheduledFor`. Only a `"schedule"` trigger has a real nominal slot —
   * manual triggers and dead-letter replays carry the dispatch time.
   */
  scheduledFor: number;
  /**
   * Waker execution trigger. `"manual"` (console "run now" / dead-letter
   * replay) runs the sweep without taking the hourly slot; defaults to
   * `"schedule"`.
   */
  trigger?: "schedule" | "manual";
  /**
   * Waker only: age after which a claim of the same source is considered
   * orphaned (aborted execution) and may be taken over. Not set for cron, which
   * must never re-sweep an hour it already touched.
   */
  staleClaimMs?: number;
}

export type SchedulerTickReason =
  | "executed"
  | "duplicate_tick"
  | "claim_unavailable"
  | "job_failed";

export interface SchedulerTickResult {
  /** `true` only when this call ran the business pass to completion. */
  executed: boolean;
  reason: SchedulerTickReason;
  /** Hour slot claim key; absent for manual triggers (they take no slot). */
  tickKey?: string;
  /** Which entry point claimed the hour (`duplicate_tick` only). */
  claimedBy?: string;
  /** Execution trigger, echoed for the waker execution log. */
  trigger: "schedule" | "manual";
  durationMs: number;
}

/** Best-effort read of the current claim row. */
async function readClaim(env: Env, prefix: string, tickKey: string) {
  try {
    return await getSchedulerTickClaim(env.DB, prefix, tickKey);
  } catch {
    return null;
  }
}

/**
 * Take over a claim left by an execution of the same source that never reported
 * back. Never touches another source's claim (a cron claim stays authoritative).
 */
async function takeOverStaleClaim(
  env: Env,
  prefix: string,
  tickKey: string,
  source: SchedulerTickSource,
  staleClaimMs: number,
  now: number,
): Promise<boolean> {
  const existing = await readClaim(env, prefix, tickKey);
  if (existing === null || existing.source !== source) return false;
  if (now - existing.claimed_at < staleClaimMs) return false;
  try {
    const won = await takeoverSchedulerTick(
      env.DB,
      prefix,
      tickKey,
      source,
      existing.claimed_at,
      now,
    );
    if (won) {
      console.info(
        `scheduler tick ${tickKey}: took over a stale ${source} claim (age ${now - existing.claimed_at}ms)`,
      );
    }
    return won;
  } catch (err) {
    console.error(`scheduler_tick_takeover_failed (${tickKey}):`, err);
    return false;
  }
}

export async function runSchedulerTick(
  env: Env,
  options: SchedulerTickOptions,
): Promise<SchedulerTickResult> {
  const startedAt = Date.now();
  const prefix = getTablePrefix(env);
  const source = options.source;
  const trigger = options.trigger ?? "schedule";
  // Only a real schedule firing has a nominal hour slot to arbitrate: a manual
  // trigger / dead-letter replay carries the dispatch time, and flooring that to
  // the current hour would collide with the cron claim of that hour and turn the
  // console's "run now" into a silent 2xx no-op. Non-null ⇔ this run claims an hour.
  const slotKey =
    trigger === "schedule" ? schedulerTickKey(options.scheduledFor) : null;
  const wakerConfigured = wakerSigningKey(env) !== null;

  // 1) Claim the nominal hour slot. With only one entry point a claim failure
  //    must not break the existing schedule (e.g. migration not applied yet);
  //    with two possible entry points, running unclaimed could double-notify.
  let claimed = true;
  if (slotKey !== null) {
    try {
      claimed = await claimSchedulerTick(
        env.DB,
        prefix,
        slotKey,
        source,
        startedAt,
      );
    } catch (err) {
      console.error(
        `scheduler_tick_claim_unavailable (${source}, ${slotKey}):`,
        err,
      );
      if (wakerConfigured) {
        if (source === "waker") throw err;
        return {
          executed: false,
          reason: "claim_unavailable",
          tickKey: slotKey,
          trigger,
          durationMs: Date.now() - startedAt,
        };
      }
      claimed = true;
    }

    // A waker retry after a platform abort may take over its own orphaned claim.
    if (
      !claimed &&
      options.staleClaimMs !== undefined &&
      options.staleClaimMs > 0
    ) {
      claimed = await takeOverStaleClaim(
        env,
        prefix,
        slotKey,
        source,
        options.staleClaimMs,
        startedAt,
      );
    }

    if (!claimed) {
      const claimedBy = (await readClaim(env, prefix, slotKey))?.source;
      console.debug(
        `scheduler tick ${slotKey} already claimed by ${claimedBy ?? "another entry"}`,
      );
      return {
        executed: false,
        reason: "duplicate_tick",
        tickKey: slotKey,
        claimedBy,
        trigger,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // 2) The unchanged business pass. Both entries await it to completion, so the
  //    waker callback only answers 2xx once notifications have actually gone out.
  try {
    await handleScheduled(env);
  } catch (err) {
    if (source === "waker") {
      // Release the hour so the platform retry (same executionId) can re-claim.
      if (slotKey !== null) {
        try {
          await releaseSchedulerTick(env.DB, prefix, slotKey, source);
        } catch (releaseErr) {
          console.error(
            `scheduler_tick_release_failed (${slotKey}):`,
            releaseErr,
          );
        }
      }
      throw err;
    }
    console.error(
      `scheduled run failed for ${slotKey ?? "manual"}${slotKey === null ? "" : " (hour claim kept)"}:`,
      err,
    );
    return {
      executed: false,
      reason: "job_failed",
      ...(slotKey === null ? {} : { tickKey: slotKey }),
      trigger,
      durationMs: Date.now() - startedAt,
    };
  }

  // 3) Housekeeping: never let pruning failures affect the tick result.
  try {
    await pruneSchedulerTicks(env.DB, prefix, Date.now() - CLAIM_RETENTION_MS);
  } catch (err) {
    console.error(`scheduler_tick_prune_failed (${prefix}):`, err);
  }

  const result: SchedulerTickResult = {
    executed: true,
    reason: "executed",
    ...(slotKey === null ? {} : { tickKey: slotKey }),
    trigger,
    durationMs: Date.now() - startedAt,
  };
  console.info("scheduler tick:", { source, ...result });
  return result;
}
