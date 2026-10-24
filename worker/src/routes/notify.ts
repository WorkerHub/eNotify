import { Hono } from "hono";
import { getTablePrefix, VALID_CHANNELS, type HonoEnv } from "../types";
import { getNotificationConfig } from "../db/queries/notifications";
import {
  sendNotifications,
  type NotifyMessage,
} from "../services/notify/index";
import { rateLimit } from "../middleware/ratelimit";
import { apiKeyOrCookieAuth } from "../middleware/apiKey";

export const notifyRoutes = new Hono<HonoEnv>();

const NOTIFY_TOKEN_DEPRECATED =
  "Notify tokens are deprecated. Use POST /api/notify with an API key (Authorization: Bearer enk_...) instead; create a key in Settings → API Keys.";

// API-key or logged-in session trigger — exact POST /api/notify (no :token).
// The enk_... bearer is validated by apiKeyOrCookieAuth (its own 120/min per-key
// limit); the 30/min notify_trigger limit below is the second layer against spam.
notifyRoutes.use("/", apiKeyOrCookieAuth);
notifyRoutes.use(
  "/",
  rateLimit({ max: 30, window: 60, keyPrefix: "notify_trigger" }),
);

notifyRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const prefix = getTablePrefix(c.env);

  const notifyConfig = await getNotificationConfig(c.env.DB, prefix, userId);
  if (!notifyConfig) {
    return c.json({ error: "No notification channels configured" }, 400);
  }

  const body = await c.req.json<{
    title?: string;
    body?: string;
    url?: string;
    channels?: unknown;
  }>();

  let channels: string[] | undefined;
  if (body.channels !== undefined) {
    if (!Array.isArray(body.channels)) {
      return c.json({ error: "channels must be an array" }, 400);
    }
    channels = body.channels;
    const invalidChannel = channels.find((ch) => !VALID_CHANNELS.includes(ch));
    if (invalidChannel !== undefined) {
      return c.json({ error: `Invalid channel name: ${invalidChannel}` }, 400);
    }
    let enabledChannels: string[];
    try {
      enabledChannels = JSON.parse(notifyConfig.enabled_channels || "[]");
    } catch {
      enabledChannels = [];
    }
    const disabledChannel = channels.find(
      (ch) => !enabledChannels.includes(ch),
    );
    if (disabledChannel) {
      return c.json({ error: `Channel not enabled: ${disabledChannel}` }, 400);
    }
  }

  const message: NotifyMessage = {
    title: body.title || "Notification",
    body: body.body || "",
    url: body.url,
  };

  try {
    const results = await sendNotifications(
      notifyConfig,
      message,
      c.env,
      undefined,
      channels,
    );
    return c.json({ success: true, results });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

// Third-party token trigger — deprecated in favour of API keys. Return 410
// without touching KV or the DB; legacy clients must migrate to POST /api/notify.
notifyRoutes.post("/:token", async (c) => {
  return c.json({ error: NOTIFY_TOKEN_DEPRECATED }, 410);
});
