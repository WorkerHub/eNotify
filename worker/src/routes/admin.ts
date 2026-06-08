import { Hono } from "hono";
import { getTablePrefix, VALID_CHANNELS } from "../types";
import type { HonoEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import {
  listUsers,
  findUserById,
  findUserByEmail,
  createUser,
  updateUser,
  deleteUser,
} from "../db/queries/users";
import {
  listItemsByUser,
  createItem,
  updateItem,
  deleteItem,
  getItem,
} from "../db/queries/items";
import { getAllSettings, setSetting } from "../db/queries/settings";
import { upsertNotificationConfig } from "../db/queries/notifications";
import { generateId, hashPassword } from "../core/auth";
import { sendEmail } from "../services/email";

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export const adminRoutes = new Hono<HonoEnv>();

adminRoutes.use("*", authMiddleware);
adminRoutes.use("*", adminMiddleware);

// User management
adminRoutes.post("/users", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json<{
    email: string;
    password: string;
    role?: string;
  }>();

  if (!body.email || !body.password)
    return c.json({ error: "Email and password required" }, 400);
  if (!EMAIL_RE.test(body.email))
    return c.json({ error: "Invalid email format" }, 400);
  if (body.password.length < 8)
    return c.json({ error: "Password must be at least 8 characters" }, 400);

  const existing = await findUserByEmail(c.env.DB, prefix, body.email);
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const id = generateId();
  const passwordHash = await hashPassword(body.password);
  const role = body.role === "admin" ? "admin" : "user";

  await createUser(c.env.DB, prefix, {
    id,
    email: body.email,
    password_hash: passwordHash,
    role,
  });
  await upsertNotificationConfig(c.env.DB, prefix, id, {});
  await updateUser(c.env.DB, prefix, id, { email_verified: 1 });

  const user = await findUserById(c.env.DB, prefix, id);
  return c.json(
    {
      id: user!.id,
      email: user!.email,
      role: user!.role,
      is_active: !!user!.is_active,
      email_verified: !!user!.email_verified,
      created_at: user!.created_at,
    },
    201,
  );
});

adminRoutes.get("/users", async (c) => {
  const prefix = getTablePrefix(c.env);
  const users = await listUsers(c.env.DB, prefix);
  return c.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      is_active: !!u.is_active,
      email_verified: !!u.email_verified,
      created_at: u.created_at,
    })),
  );
});

adminRoutes.get("/users/:uid", async (c) => {
  const prefix = getTablePrefix(c.env);
  const uid = c.req.param("uid");
  const user = await findUserById(c.env.DB, prefix, uid);
  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({
    id: user.id,
    email: user.email,
    role: user.role,
    is_active: !!user.is_active,
    email_verified: !!user.email_verified,
    base_currency: user.base_currency,
    timezone: user.timezone,
    language: user.language,
    theme: user.theme,
    created_at: user.created_at,
  });
});

adminRoutes.put("/users/:uid", async (c) => {
  const prefix = getTablePrefix(c.env);
  const uid = c.req.param("uid");
  const body = await c.req.json<{
    role?: string;
    is_active?: number;
    email?: string;
    password?: string;
  }>();

  const user = await findUserById(c.env.DB, prefix, uid);
  if (!user) return c.json({ error: "User not found" }, 404);

  const updates: Record<string, any> = {};
  if (body.role !== undefined && ["admin", "user"].includes(body.role))
    updates.role = body.role;
  if (body.is_active !== undefined) updates.is_active = body.is_active ? 1 : 0;
  if (body.email !== undefined) {
    if (!EMAIL_RE.test(body.email))
      return c.json({ error: "Invalid email format" }, 400);
    const existing = await findUserByEmail(c.env.DB, prefix, body.email);
    if (existing && existing.id !== uid)
      return c.json({ error: "Email already in use" }, 409);
    updates.email = body.email;
  }
  if (body.password !== undefined) {
    if (body.password.length < 8)
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    updates.password_hash = await hashPassword(body.password);
  }

  await updateUser(c.env.DB, prefix, uid, updates);
  return c.json({ success: true });
});

adminRoutes.delete("/users/:uid", async (c) => {
  const prefix = getTablePrefix(c.env);
  const uid = c.req.param("uid");
  const currentUserId = c.get("userId");

  if (uid === currentUserId) {
    return c.json({ error: "Cannot delete yourself" }, 400);
  }

  const user = await findUserById(c.env.DB, prefix, uid);
  if (!user) return c.json({ error: "User not found" }, 404);

  await deleteUser(c.env.DB, prefix, uid);
  return c.json({ success: true });
});

// Admin manage user items
adminRoutes.get("/users/:uid/items", async (c) => {
  const prefix = getTablePrefix(c.env);
  const uid = c.req.param("uid");

  const user = await findUserById(c.env.DB, prefix, uid);
  if (!user) return c.json({ error: "User not found" }, 404);

  const items = await listItemsByUser(c.env.DB, prefix, uid);
  return c.json(items);
});

adminRoutes.post("/users/:uid/items", async (c) => {
  const prefix = getTablePrefix(c.env);
  const uid = c.req.param("uid");

  const user = await findUserById(c.env.DB, prefix, uid);
  if (!user) return c.json({ error: "User not found" }, 404);

  const body = await c.req.json();

  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    return c.json({ error: "Name is required" }, 400);
  }
  if (!body.expiry_date || Number.isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: "Valid expiry date is required" }, 400);
  }
  if (body.start_date && Number.isNaN(Date.parse(body.start_date))) {
    return c.json({ error: "Invalid start date" }, 400);
  }
  if (
    body.period_value !== undefined &&
    (typeof body.period_value !== "number" || body.period_value < 1)
  ) {
    return c.json({ error: "Period value must be >= 1" }, 400);
  }
  if (
    body.period_unit &&
    !["day", "week", "month", "year"].includes(body.period_unit)
  ) {
    return c.json({ error: "Invalid period unit" }, 400);
  }
  if (body.reminder_unit && !["day", "hour"].includes(body.reminder_unit)) {
    return c.json({ error: "Invalid reminder unit" }, 400);
  }
  if (
    body.amount !== undefined &&
    body.amount !== null &&
    (typeof body.amount !== "number" || body.amount < 0)
  ) {
    return c.json({ error: "Amount must be a non-negative number" }, 400);
  }

  const id = generateId();
  await createItem(c.env.DB, prefix, {
    id,
    user_id: uid,
    name: body.name.trim(),
    item_mode: body.item_mode || "cycle",
    category: body.category || "",
    start_date: body.start_date || null,
    expiry_date: body.expiry_date,
    period_value: body.period_value || 1,
    period_unit: body.period_unit || "month",
    reminder_unit: body.reminder_unit || "day",
    reminder_value: body.reminder_value ?? 7,
    notes: body.notes || "",
    amount: body.amount ?? null,
    currency: body.currency || "CNY",
    last_payment_date: body.last_payment_date || null,
    is_active: body.is_active ?? 1,
    auto_renew: body.auto_renew ?? 1,
    calendar_mode: body.calendar_mode || "solar",
    lunar_expiry_date: body.lunar_expiry_date || null,
    channels: JSON.stringify(body.channels || []),
    notification_hours: JSON.stringify(body.notification_hours || []),
    item_kind: body.item_kind || "regular",
  });

  return c.json({ id }, 201);
});

adminRoutes.put("/users/:uid/items/:iid", async (c) => {
  const prefix = getTablePrefix(c.env);
  const uid = c.req.param("uid");
  const iid = c.req.param("iid");
  const body = await c.req.json();

  const item = await getItem(c.env.DB, prefix, iid);
  if (!item || item.user_id !== uid) return c.json({ error: "Not found" }, 404);

  if (
    body.period_value !== undefined &&
    (typeof body.period_value !== "number" || body.period_value < 1)
  ) {
    return c.json({ error: "Period value must be >= 1" }, 400);
  }
  if (body.expiry_date && Number.isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: "Invalid expiry date" }, 400);
  }
  if (
    body.period_unit &&
    !["day", "week", "month", "year"].includes(body.period_unit)
  ) {
    return c.json({ error: "Invalid period unit" }, 400);
  }
  if (body.reminder_unit && !["day", "hour"].includes(body.reminder_unit)) {
    return c.json({ error: "Invalid reminder unit" }, 400);
  }
  if (
    body.amount !== undefined &&
    body.amount !== null &&
    typeof body.amount !== "number"
  ) {
    return c.json({ error: "Amount must be a number" }, 400);
  }
  const validChannels = VALID_CHANNELS;
  if (body.channels !== undefined) {
    if (!Array.isArray(body.channels)) {
      return c.json({ error: "channels must be an array" }, 400);
    }
    if (body.channels.some((ch: string) => !validChannels.includes(ch))) {
      return c.json({ error: "Invalid channel name" }, 400);
    }
  }
  if (body.notification_hours !== undefined) {
    if (!Array.isArray(body.notification_hours)) {
      return c.json({ error: "notification_hours must be an array" }, 400);
    }
    if (
      body.notification_hours.some(
        (h: number) => !Number.isInteger(h) || h < 0 || h > 23,
      )
    ) {
      return c.json({ error: "notification_hours must be integers 0-23" }, 400);
    }
  }
  if (body.item_mode && !["cycle", "reset"].includes(body.item_mode)) {
    return c.json({ error: "Invalid item mode" }, 400);
  }
  if (body.item_kind && !["regular", "subscription"].includes(body.item_kind)) {
    return c.json({ error: "Invalid item_kind" }, 400);
  }
  if (body.is_active !== undefined && ![0, 1].includes(body.is_active)) {
    return c.json({ error: "is_active must be 0 or 1" }, 400);
  }
  if (body.auto_renew !== undefined && ![0, 1].includes(body.auto_renew)) {
    return c.json({ error: "auto_renew must be 0 or 1" }, 400);
  }
  if (
    body.calendar_mode &&
    !["solar", "lunar", "both"].includes(body.calendar_mode)
  ) {
    return c.json({ error: "Invalid calendar_mode" }, 400);
  }
  if (
    body.reminder_value !== undefined &&
    (typeof body.reminder_value !== "number" || body.reminder_value < 0)
  ) {
    return c.json(
      { error: "reminder_value must be a non-negative number" },
      400,
    );
  }

  const updates: Record<string, any> = {};
  const allowedFields = [
    "name",
    "item_mode",
    "category",
    "start_date",
    "expiry_date",
    "period_value",
    "period_unit",
    "reminder_unit",
    "reminder_value",
    "notes",
    "amount",
    "currency",
    "is_active",
    "auto_renew",
    "calendar_mode",
    "item_kind",
  ];
  for (const key of allowedFields) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.channels !== undefined)
    updates.channels = JSON.stringify(body.channels);
  if (body.notification_hours !== undefined)
    updates.notification_hours = JSON.stringify(body.notification_hours);

  await updateItem(c.env.DB, prefix, iid, updates);
  return c.json({ success: true });
});

adminRoutes.delete("/users/:uid/items/:iid", async (c) => {
  const prefix = getTablePrefix(c.env);
  const uid = c.req.param("uid");
  const iid = c.req.param("iid");

  const item = await getItem(c.env.DB, prefix, iid);
  if (!item || item.user_id !== uid) return c.json({ error: "Not found" }, 404);

  await deleteItem(c.env.DB, prefix, iid);
  return c.json({ success: true });
});

// System settings
adminRoutes.get("/system/settings", async (c) => {
  const prefix = getTablePrefix(c.env);
  const settings = await getAllSettings(c.env.DB, prefix);

  // Redact sensitive values
  const safe = { ...settings };
  if (safe.smtp_config) {
    try {
      const smtp = JSON.parse(safe.smtp_config);
      if (smtp.password) smtp.password = "••••••";
      safe.smtp_config = JSON.stringify(smtp);
    } catch {
      /* ignore malformed */
    }
  }
  if (safe.resend_config) {
    try {
      const resend = JSON.parse(safe.resend_config);
      if (resend.api_key) resend.api_key = "••••••";
      safe.resend_config = JSON.stringify(resend);
    } catch {
      /* ignore malformed */
    }
  }

  return c.json(safe);
});

adminRoutes.put("/system/settings", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json<Record<string, string>>();

  const allowedKeys = [
    "email_verification_enabled",
    "require_2fa",
    "registration_enabled",
    "smtp_config",
    "resend_config",
    "email_provider",
    "app_name",
  ];

  const existingSettings = await getAllSettings(c.env.DB, prefix);

  for (const [key, value] of Object.entries(body)) {
    if (!allowedKeys.includes(key)) continue;

    // Don't overwrite secrets with redacted values
    if (key === "smtp_config") {
      let newConfig: Record<string, any>;
      try {
        newConfig = JSON.parse(value);
      } catch {
        continue;
      }
      if (!newConfig.password) {
        let existingSmtp: Record<string, any> = {};
        try {
          existingSmtp = existingSettings.smtp_config
            ? JSON.parse(existingSettings.smtp_config)
            : {};
        } catch {
          /* */
        }
        newConfig.password = existingSmtp.password || "";
      }
      await setSetting(c.env.DB, prefix, key, JSON.stringify(newConfig));
    } else if (key === "resend_config") {
      let newConfig: Record<string, any>;
      try {
        newConfig = JSON.parse(value);
      } catch {
        continue;
      }
      if (!newConfig.api_key) {
        let existingResend: Record<string, any> = {};
        try {
          existingResend = existingSettings.resend_config
            ? JSON.parse(existingSettings.resend_config)
            : {};
        } catch {
          /* */
        }
        newConfig.api_key = existingResend.api_key || "";
      }
      await setSetting(c.env.DB, prefix, key, JSON.stringify(newConfig));
    } else {
      await setSetting(c.env.DB, prefix, key, value);
    }
  }

  return c.json({ success: true });
});

// Test email
adminRoutes.post("/system/settings/test-email", async (c) => {
  const { to } = await c.req.json<{ to: string }>();
  if (!to || !EMAIL_RE.test(to))
    return c.json({ error: "Invalid email address" }, 400);

  const result = await sendEmail(c.env, {
    to,
    subject: "eNotify Test Email",
    html: "<p>This is a test email from eNotify. Your email configuration is working correctly.</p>",
  });

  if (!result.success) {
    return c.json({ error: result.error || "Failed to send email" }, 500);
  }

  return c.json({ success: true });
});
