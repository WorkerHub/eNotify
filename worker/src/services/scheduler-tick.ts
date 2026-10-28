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
  /** Nominal scheduled time (epoch ms): cron `event.scheduledTime` / waker `ctx.scheduledFor`. */
  scheduledFor: number;
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
  tickKey: string;
  /** Which entry point claimed the hour (`duplicate_tick` only). */
  claimedBy?: string;
  durationMs: number;
}

/** Best-effort read of the winning claim, for the `claimedBy` field. */
async function readClaimedBy(
  env: Env,
  prefix: string,
  tickKey: string,
): Promise<string | undefined> {
  try {
    const row = await getSchedulerTickClaim(env.DB, prefix, tickKey);
    return row?.source;
  } catch {
    return undefined;
  }
}

export async function runSchedulerTick(
  env: Env,
  options: SchedulerTickOptions,
): Promise<SchedulerTickResult> {
  const startedAt = Date.now();
  const prefix = getTablePrefix(env);
  const tickKey = schedulerTickKey(options.scheduledFor);
  const source = options.source;
  const wakerConfigured = wakerSigningKey(env) !== null;

  // 1) Claim the nominal hour slot. With only one entry point a claim failure
  //    must not break the existing schedule (e.g. migration not applied yet);
  //    with two possible entry points, running unclaimed could double-notify.
  let claimed: boolean;
  try {
    claimed = await claimSchedulerTick(
      env.DB,
      prefix,
      tickKey,
      source,
      startedAt,
    );
  } catch (err) {
    console.error(
      `scheduler_tick_claim_unavailable (${source}, ${tickKey}):`,
      err,
    );
    if (wakerConfigured) {
      if (source === "waker") throw err;
      return {
        executed: false,
        reason: "claim_unavailable",
        tickKey,
        durationMs: Date.now() - startedAt,
      };
    }
    claimed = true;
  }

  if (!claimed) {
    const claimedBy = await readClaimedBy(env, prefix, tickKey);
    console.debug(
      `scheduler tick ${tickKey} already claimed by ${claimedBy ?? "another entry"}`,
    );
    return {
      executed: false,
      reason: "duplicate_tick",
      tickKey,
      claimedBy,
      durationMs: Date.now() - startedAt,
    };
  }

  // 2) The unchanged business pass. Both entries await it to completion, so the
  //    waker callback only answers 2xx once notifications have actually gone out.
  try {
    await handleScheduled(env);
  } catch (err) {
    if (source === "waker") {
      // Release the hour so the platform retry (same executionId) can re-claim.
      try {
        await releaseSchedulerTick(env.DB, prefix, tickKey, source);
      } catch (releaseErr) {
        console.error(
          `scheduler_tick_release_failed (${tickKey}):`,
          releaseErr,
        );
      }
      throw err;
    }
    console.error(
      `scheduled run failed for ${tickKey}; keeping the claim for this hour:`,
      err,
    );
    return {
      executed: false,
      reason: "job_failed",
      tickKey,
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
    tickKey,
    durationMs: Date.now() - startedAt,
  };
  console.info("scheduler tick:", { source, ...result });
  return result;
}
