/**
 * Waker callback business side: platform POST `/_waker/execute` → one hourly
 * sweep → JSON result.
 *
 * Frozen contract (migration plan §10):
 *   - **synchronous**: the handler awaits `runSchedulerTick` and only then
 *     returns, so the SDK answers 2xx after the business pass finished. Never
 *     `waitUntil` + immediate OK.
 *   - **signature**: HMAC-SHA256 over `timestamp + executionId + jobId + rawBody`
 *     with a 300s window — entirely inside the SDK (`../waker`, a verbatim copy
 *     of waker-client 2.0.0). This file never touches signatures.
 *   - **idempotency**: executionId is deduplicated by the SDK's D1 ledger
 *     (`{prefix}waker_executions`, created by `schema_v3`). The cross-entry
 *     hour claim in `runSchedulerTick` is the second, independent guard so the
 *     native cron and this callback can never both sweep the same hour.
 *   - payload / misfire / attempt are ignored for business purposes: a misfire
 *     replay is semantically identical to a normal run and dedupes on the
 *     nominal hour slot.
 */

import { getTablePrefix } from "../types";
import type { Env } from "../types";
import { createD1ExecutionLedger, createWakerReceiver } from "../waker";
import {
  runSchedulerTick,
  wakerExecutionsTable,
  wakerSigningKey,
} from "./scheduler-tick";

/**
 * Job name registered in the waker console. Must match the platform job name
 * **verbatim** — the receiver dispatches on it and answers 404 `unknown_job`
 * otherwise. Task creation is done by the user in the waker console; eNotify
 * ships no registration client and holds no project token.
 */
export const WAKER_JOB_NAME = "hourly-reminder-sweep";

/**
 * Build a receiver bound to this request's env.
 *
 * The signing key is resolved once here: the same resolved value gates
 * "configured or not" and is what the SDK verifies signatures with. When it is
 * `null` the receiver still mounts and fails closed by itself (500
 * `signing_key_missing` for a real callback, 400 for missing headers, 404 for
 * GET) without touching the DB or the business code.
 */
export function createWakerCallbackReceiver(env: Env) {
  const signingKey = wakerSigningKey(env);
  const prefix = getTablePrefix(env);
  const table = wakerExecutionsTable(prefix);

  return createWakerReceiver({
    jobs: {
      [WAKER_JOB_NAME]: async (context) => {
        // `scheduledFor` is the platform's nominal slot (not the dispatch time),
        // which is what maps a waker misfire replay onto the native cron slot.
        const result = await runSchedulerTick(env, {
          source: "waker",
          scheduledFor: context.scheduledFor,
        });
        return { ...result };
      },
    },
    // Gate and verification share one value; null → SDK fail-closed path.
    signingKey: () => signingKey,
    ledger: createD1ExecutionLedger(env.DB, { table }),
    onJobError: (error, context) => {
      // Only identifiers and the message: never the payload, headers or key.
      console.error(
        `waker job ${context.jobName} (execution ${context.executionId}, attempt ${context.attempt}) failed:`,
        error instanceof Error ? error.message : String(error),
      );
    },
  });
}
