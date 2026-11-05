import { Hono } from "hono";
import { getTablePrefix } from "../types";
import type { HonoEnv } from "../types";
import { getVikunjaIntegrationByToken } from "../db/queries/vikunja-integrations";
import { findUserById } from "../db/queries/users";
import { getNotificationConfig } from "../db/queries/notifications";
import { sendNotifications } from "../services/notify/index";
import {
  VIKUNJA_SIGNATURE_HEADER,
  buildVikunjaMessage,
  isVikunjaEventName,
  verifyVikunjaSignature,
} from "../services/vikunja-webhook";
import { rateLimit } from "../middleware/ratelimit";

/**
 * Inbound integration endpoints. Deliberately NOT behind session auth or
 * `apiKeyOrCookieAuth`: Vikunja can only send its own HMAC-signed payload.
 *
 * `POST /api/integrations/vikunja/:hookToken`
 *   limit → look up the token → enabled → read the raw body once → verify the
 *   HMAC → parse JSON → map the event → user/config → `sendNotifications`
 *   (no channels: the #154 default-channel semantics apply, no
 *   notification_hours gate, no items, no dedupe) → respond after sending.
 */
export const integrationRoutes = new Hono<HonoEnv>();

const VIKUNJA_WEBHOOK_PATH = "/vikunja/:hookToken";

integrationRoutes.use(
  VIKUNJA_WEBHOOK_PATH,
  rateLimit({
    max: 60,
    window: 60,
    keyPrefix: "vikunja_webhook",
    keyFn: (c) => c.req.param("hookToken") || "unknown",
  }),
);

integrationRoutes.post(VIKUNJA_WEBHOOK_PATH, async (c) => {
  const prefix = getTablePrefix(c.env);
  const hookToken = c.req.param("hookToken");

  const integration = await getVikunjaIntegrationByToken(
    c.env.DB,
    prefix,
    hookToken,
  );
  if (!integration) return c.json({ error: "Not found" }, 404);
  if (!integration.enabled) {
    return c.json({ error: "Integration disabled" }, 403);
  }

  // The signature covers the exact bytes Vikunja sent, so the body is read
  // once as text and that same string is both verified and parsed.
  const rawBody = await c.req.text();
  const signature = c.req.header(VIKUNJA_SIGNATURE_HEADER);
  if (!(await verifyVikunjaSignature(integration.secret, signature, rawBody))) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return c.json({ error: "Invalid payload" }, 400);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const eventName = payload.event_name;
  if (typeof eventName !== "string" || eventName === "") {
    return c.json({ error: "Missing event_name" }, 400);
  }
  // Unknown events are ignored (forward compatible), not an error.
  if (!isVikunjaEventName(eventName)) return c.json({ ignored: true });

  const user = await findUserById(c.env.DB, prefix, integration.user_id);
  // A deleted/disabled owner is answered like an unknown token, so the
  // endpoint never reveals which half of the lookup failed.
  if (!user?.is_active) return c.json({ error: "Not found" }, 404);

  const message = buildVikunjaMessage(
    eventName,
    payload.data,
    integration.base_url,
    user.timezone || "UTC",
  );
  if (message === null) {
    // Vikunja never retries, so a malformed known event is only logged.
    console.error(
      `[vikunja] ignored ${eventName} for user ${user.id}: incomplete payload data`,
    );
    return c.json({ ignored: true });
  }

  const config = await getNotificationConfig(c.env.DB, prefix, user.id);
  if (!config) {
    return c.json({ error: "No notification channels configured" }, 400);
  }

  try {
    const results = await sendNotifications(config, message, c.env, {
      db: c.env.DB,
      prefix,
      userId: user.id,
      itemId: null,
      triggerSource: "vikunja",
    });
    return c.json({ success: true, results });
  } catch (err) {
    // Config-class failures (no default channel, default not enabled, …) are
    // reported verbatim, same as POST /api/notify.
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});
