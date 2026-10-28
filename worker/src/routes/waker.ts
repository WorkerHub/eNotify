/**
 * `/_waker` mount: hand the request to the SDK receiver.
 *
 * Mounted in `index.ts` **before** the SPA fallback (`app.get("*")`), so the
 * fallback can never answer a callback with 200 HTML. Paths, signature
 * verification, idempotency and error codes all come from the SDK; this file
 * copies none of the protocol.
 *
 * Why per request: `env` (signing key secret, D1 binding, table prefix) is only
 * visible per request, and the receiver resolves both the key and the ledger
 * table from it. Building the receiver is object construction only — no IO.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { createWakerCallbackReceiver } from "../services/waker-callback";
import { CALLBACK_MOUNT_PATH } from "../waker";

/**
 * The receiver registers its route relative to the mount prefix (`POST
 * /execute`), so it must be attached through `app.route(prefix, receiver)`.
 * A throwaway Hono host does exactly that (path stripping and the 404 for
 * undeclared paths stay Hono's / the SDK's decisions — no hand-written
 * forwarding logic).
 */
function forwardToReceiver(
  request: Request,
  env: HonoEnv["Bindings"],
): Response | Promise<Response> {
  const host = new Hono<HonoEnv>();
  host.route(
    CALLBACK_MOUNT_PATH,
    createWakerCallbackReceiver(env) as unknown as Hono<HonoEnv>,
  );
  return host.fetch(request, env);
}

/** `/_waker` sub-app (`app.route(CALLBACK_MOUNT_PATH, wakerRoutes())` in index.ts). */
export function wakerRoutes(): Hono<HonoEnv> {
  const routes = new Hono<HonoEnv>();
  routes.all("*", (c) => forwardToReceiver(c.req.raw, c.env));
  return routes;
}
