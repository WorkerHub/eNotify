import { Hono, type Context } from "hono";
import { getTablePrefix, type HonoEnv } from "../types";
import { getNotificationConfig } from "../db/queries/notifications";
import { findUserById } from "../db/queries/users";
import {
  sendNotifications,
  type NotifyMessage,
} from "../services/notify/index";
import { rateLimit } from "../middleware/ratelimit";
import { apiKeyOrCookieAuth } from "../middleware/apiKey";

export const notifyRoutes = new Hono<HonoEnv>();

notifyRoutes.use(
  "/:token",
  rateLimit({ max: 30, window: 60, keyPrefix: "notify_trigger" }),
);

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
  return notifyByUserId(c, userId);
});

// Third-party trigger — authenticate via token in URL, header, or query param
notifyRoutes.post("/:token", async (c) => {
  const token = c.req.param("token");
  const prefix = getTablePrefix(c.env);

  // Find user by their third-party API token stored in notification_configs
  // Token format: userId:secret stored in KV
  const userId = await c.env.KV.get(`notify_token:${token}`);
  if (!userId) {
    return c.json({ error: "Invalid token" }, 401);
  }

  const user = await findUserById(c.env.DB, prefix, userId);
  if (!user?.is_active) {
    return c.json({ error: "User not found or disabled" }, 401);
  }

  return notifyByUserId(c, userId);
});

/** Shared helper: resolve the user's notification config and dispatch the message. */
async function notifyByUserId(
  c: Context<HonoEnv>,
  userId: string,
): Promise<Response> {
  const prefix = getTablePrefix(c.env);

  const notifyConfig = await getNotificationConfig(c.env.DB, prefix, userId);
  if (!notifyConfig) {
    return c.json({ error: "No notification channels configured" }, 400);
  }

  const body = await c.req.json<{
    title?: string;
    body?: string;
    url?: string;
  }>();

  const message: NotifyMessage = {
    title: body.title || "Notification",
    body: body.body || "",
    url: body.url,
  };

  const results = await sendNotifications(notifyConfig, message, c.env);
  return c.json({ success: true, results });
}
