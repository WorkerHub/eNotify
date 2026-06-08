import { Hono } from "hono";
import { getTablePrefix, VALID_CHANNELS } from "../types";
import type { Item, HonoEnv } from "../types";
import { authMiddleware, getEffectiveUserId } from "../middleware/auth";
import {
  createItem,
  getItem,
  listItemsByUser,
  updateItem,
  deleteItem,
  toggleItemStatus,
} from "../db/queries/items";
import {
  createPayment,
  listPaymentsByItem,
  updatePayment,
  deletePayment,
  getPayment,
} from "../db/queries/payments";
import { getNotificationConfig } from "../db/queries/notifications";
import { findUserById } from "../db/queries/users";
import { generateId } from "../core/auth";
import {
  nowISO,
  addPeriod,
  diffInHours,
  diffInDays,
  nowInTimezone,
} from "../core/time";
import { addLunarMonths, addLunarYears, solarToLunar } from "../core/lunar";
import {
  sendNotifications,
  type NotifyMessage,
} from "../services/notify/index";

export const itemRoutes = new Hono<HonoEnv>();

itemRoutes.use("*", authMiddleware);

itemRoutes.get("/", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const items = await listItemsByUser(c.env.DB, prefix, userId);
  return c.json(items);
});

itemRoutes.post("/", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json();

  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    return c.json({ error: "Name is required" }, 400);
  }
  if (!body.expiry_date || typeof body.expiry_date !== "string") {
    return c.json({ error: "Expiry date is required" }, 400);
  }
  if (Number.isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: "Invalid expiry date" }, 400);
  }
  if (body.start_date && Number.isNaN(Date.parse(body.start_date))) {
    return c.json({ error: "Invalid start date" }, 400);
  }
  if (
    body.lunar_expiry_date &&
    Number.isNaN(Date.parse(body.lunar_expiry_date))
  ) {
    return c.json({ error: "Invalid lunar expiry date" }, 400);
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
  if (body.item_mode && !["cycle", "reset"].includes(body.item_mode)) {
    return c.json({ error: "Invalid item mode" }, 400);
  }
  if (body.item_kind && !["regular", "subscription"].includes(body.item_kind)) {
    return c.json({ error: "Invalid item_kind" }, 400);
  }
  if (
    body.amount !== undefined &&
    body.amount !== null &&
    (typeof body.amount !== "number" || body.amount < 0)
  ) {
    return c.json({ error: "Amount must be a non-negative number" }, 400);
  }
  const validChannels = VALID_CHANNELS;
  if (body.channels !== undefined && !Array.isArray(body.channels)) {
    return c.json({ error: "channels must be an array" }, 400);
  }
  if (body.channels?.some((ch: string) => !validChannels.includes(ch))) {
    return c.json({ error: "Invalid channel name" }, 400);
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

  const id = generateId();
  const now = nowISO();

  const item: Omit<Item, "created_at" | "updated_at"> = {
    id,
    user_id: userId,
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
  };

  await createItem(c.env.DB, prefix, item);

  if (item.amount && item.start_date) {
    await createPayment(c.env.DB, prefix, {
      id: generateId(),
      item_id: id,
      user_id: userId,
      date: item.start_date || now,
      amount: item.amount,
      currency: item.currency,
      type: "initial",
      note: "",
      period_start: item.start_date,
      period_end: item.expiry_date,
    });
  }

  return c.json(item, 201);
});

itemRoutes.get("/tags", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const table = `${prefix}items`;

  const categoriesResult = await c.env.DB.prepare(
    `SELECT category, COUNT(*) as cnt FROM ${table} WHERE user_id = ? AND category != '' GROUP BY category ORDER BY cnt DESC`,
  )
    .bind(userId)
    .all<{ category: string; cnt: number }>();

  return c.json({
    categories: categoriesResult.results.map((r) => r.category),
  });
});

itemRoutes.get("/:id", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(item);
});

itemRoutes.put("/:id", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  const body = await c.req.json();

  if (
    body.period_value !== undefined &&
    (typeof body.period_value !== "number" || body.period_value < 1)
  ) {
    return c.json({ error: "Period value must be >= 1" }, 400);
  }
  if (body.expiry_date && Number.isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: "Invalid expiry date" }, 400);
  }
  if (body.start_date && Number.isNaN(Date.parse(body.start_date))) {
    return c.json({ error: "Invalid start date" }, 400);
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
  if (body.item_mode && !["cycle", "reset"].includes(body.item_mode)) {
    return c.json({ error: "Invalid item mode" }, 400);
  }
  if (body.item_kind && !["regular", "subscription"].includes(body.item_kind)) {
    return c.json({ error: "Invalid item_kind" }, 400);
  }
  if (
    body.amount !== undefined &&
    body.amount !== null &&
    typeof body.amount !== "number"
  ) {
    return c.json({ error: "Amount must be a number" }, 400);
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

  const updates: Record<string, any> = {};
  const allowedFields = [
    "name",
    "item_mode",
    "category",
    "start_date",
    "expiry_date",
    "lunar_expiry_date",
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
    if (body[key] !== undefined)
      updates[key] = key === "name" ? body[key].trim() : body[key];
  }

  // channels is stored as JSON string
  if (body.channels !== undefined)
    updates.channels = JSON.stringify(body.channels);

  // notification_hours is stored as JSON string
  if (body.notification_hours !== undefined)
    updates.notification_hours = JSON.stringify(body.notification_hours);

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  await updateItem(c.env.DB, prefix, id, updates);
  return c.json({ success: true });
});

itemRoutes.delete("/:id", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  await deleteItem(c.env.DB, prefix, id);
  return c.json({ success: true });
});

itemRoutes.post("/:id/toggle-status", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  await toggleItemStatus(c.env.DB, prefix, id);
  return c.json({ success: true, is_active: item.is_active ? 0 : 1 });
});

itemRoutes.post("/:id/renew", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  let body: {
    amount?: number;
    date?: string;
    multiplier?: number;
    note?: string;
  } = {};
  try {
    body = await c.req.json<{
      amount?: number;
      date?: string;
      multiplier?: number;
      note?: string;
    }>();
  } catch {
    // Allow empty request body for manual renew calls.
  }
  const multiplier = Math.min(Math.max(body.multiplier || 1, 1), 120);
  let newExpiry = item.expiry_date;
  let newLunarExpiry = item.lunar_expiry_date;

  for (let i = 0; i < multiplier; i++) {
    if (item.calendar_mode === "both" && newLunarExpiry) {
      const nextSolar = addPeriod(
        newExpiry,
        item.period_value,
        item.period_unit,
      );
      const nextLunar =
        item.period_unit === "month"
          ? addLunarMonths(newLunarExpiry, item.period_value)
          : item.period_unit === "year"
            ? addLunarYears(newLunarExpiry, item.period_value)
            : addPeriod(newLunarExpiry, item.period_value, item.period_unit);
      newLunarExpiry = nextLunar;
      newExpiry = nextSolar;
    } else {
      newExpiry = addPeriod(newExpiry, item.period_value, item.period_unit);
    }
  }

  const paymentDate = body.date || nowISO();
  const paymentAmount = body.amount ?? item.amount ?? 0;

  await updateItem(c.env.DB, prefix, id, {
    expiry_date: newExpiry,
    ...(item.calendar_mode === "both"
      ? { lunar_expiry_date: newLunarExpiry }
      : {}),
    last_payment_date: paymentDate,
  });

  await createPayment(c.env.DB, prefix, {
    id: generateId(),
    item_id: id,
    user_id: userId,
    date: paymentDate,
    amount: paymentAmount,
    currency: item.currency,
    type: "manual",
    note: body.note || "",
    period_start: item.expiry_date,
    period_end: newExpiry,
  });

  return c.json({ success: true, new_expiry_date: newExpiry });
});

itemRoutes.post("/:id/reset", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }
  if (item.item_mode !== "reset") {
    return c.json({ error: "Item is not in reset mode" }, 400);
  }

  let body: { amount?: number; date?: string; note?: string } = {};
  try {
    body = await c.req.json<{
      amount?: number;
      date?: string;
      note?: string;
    }>();
  } catch {
    // Allow empty request body for reset action triggered from list page.
  }
  const now = nowISO();
  const today = body.date || now.split("T")[0];

  // Update the previous period's end date to the day before reset
  const prevPayments = await listPaymentsByItem(c.env.DB, prefix, id);
  const lastPayment = prevPayments.find(
    (p) => p.period_end === item.expiry_date,
  );
  if (lastPayment) {
    const dayBefore = addPeriod(today, -1, "day");
    // Clamp period_end so it never goes before period_start
    const clampedEnd =
      lastPayment.period_start && dayBefore < lastPayment.period_start
        ? lastPayment.period_start
        : dayBefore;
    await updatePayment(c.env.DB, prefix, lastPayment.id, {
      period_end: clampedEnd,
    });
  }

  let newExpiry: string;

  let newLunarExpiry: string | null = null;
  if (item.calendar_mode === "both") {
    const solarExpiry = addPeriod(today, item.period_value, item.period_unit);
    newLunarExpiry =
      item.period_unit === "month"
        ? addLunarMonths(today, item.period_value)
        : item.period_unit === "year"
          ? addLunarYears(today, item.period_value)
          : addPeriod(today, item.period_value, item.period_unit);
    newExpiry = solarExpiry;
  } else if (item.calendar_mode === "lunar" && item.period_unit === "month") {
    newExpiry = addLunarMonths(today, item.period_value);
  } else if (item.calendar_mode === "lunar" && item.period_unit === "year") {
    newExpiry = addLunarYears(today, item.period_value);
  } else {
    newExpiry = addPeriod(today, item.period_value, item.period_unit);
  }

  await updateItem(c.env.DB, prefix, id, {
    expiry_date: newExpiry,
    ...(item.calendar_mode === "both"
      ? { lunar_expiry_date: newLunarExpiry }
      : {}),
    last_payment_date: now,
  });

  await createPayment(c.env.DB, prefix, {
    id: generateId(),
    item_id: id,
    user_id: userId,
    date: now,
    amount: body.amount ?? item.amount ?? 0,
    currency: item.currency,
    type: "manual",
    note: body.note || "",
    period_start: today,
    period_end: newExpiry,
  });

  return c.json({ success: true, new_expiry_date: newExpiry });
});

itemRoutes.post("/:id/test-notify", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  const notifyConfig = await getNotificationConfig(c.env.DB, prefix, userId);
  if (!notifyConfig) {
    return c.json({ error: "No notification channels configured" }, 400);
  }

  const user = await findUserById(c.env.DB, prefix, userId);
  const lang = user?.language || "en";
  const timezone = user?.timezone || "UTC";

  const nowISOStr = nowISO();
  const hoursUntil = diffInHours(nowISOStr, item.expiry_date);
  const daysUntil = diffInDays(nowISOStr, item.expiry_date);

  // Lunar date label for the expiry date
  const [ey, em, ed] = item.expiry_date.split("-").map(Number);
  const lunar = solarToLunar(ey, em, ed);
  const lunarStr =
    item.calendar_mode !== "solar" && lunar
      ? `${lunar.monthStr}${lunar.dayStr}`
      : null;

  // Formatted send time in user's timezone
  const d = nowInTimezone(timezone);
  const sentAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  let message: NotifyMessage;
  if (lang === "zh") {
    const modeLabel = item.item_mode === "cycle" ? "周期" : "重置";
    const autoRenewLabel = item.auto_renew ? "是" : "否";
    const timeLabel =
      daysUntil > 0
        ? item.reminder_unit === "hour"
          ? `将在 ${Math.round(hoursUntil)} 小时后到期`
          : `将在 ${Math.round(daysUntil)} 天后到期`
        : `已过期 ${Math.abs(Math.round(daysUntil))} 天`;
    const lines = [
      `名称：${item.name}`,
      `模式：${modeLabel}`,
      `到期日期：${item.expiry_date}`,
    ];
    if (lunarStr) lines.push(`农历日期：${lunarStr}`);
    lines.push(`自动续期：${autoRenewLabel}`);
    if (item.notes) lines.push(`备注：${item.notes}`);
    lines.push(``, timeLabel, `发送时间：${sentAt}`, `当前时区：${timezone}`);
    message = { title: `🔔 ${item.name} - 测试通知`, body: lines.join("\n") };
  } else {
    const modeLabel = item.item_mode === "cycle" ? "Cycle" : "Reset";
    const autoRenewLabel = item.auto_renew ? "Yes" : "No";
    const timeLabel =
      daysUntil > 0
        ? item.reminder_unit === "hour"
          ? `Expires in ${Math.round(hoursUntil)} hours`
          : `Expires in ${Math.round(daysUntil)} days`
        : `Expired ${Math.abs(Math.round(daysUntil))} days ago`;
    const lines = [
      `Name: ${item.name}`,
      `Mode: ${modeLabel}`,
      `Expiry date: ${item.expiry_date}`,
    ];
    if (lunarStr) lines.push(`Lunar date: ${lunarStr}`);
    lines.push(`Auto-renew: ${autoRenewLabel}`);
    if (item.notes) lines.push(`Notes: ${item.notes}`);
    lines.push(``, timeLabel, `Sent at: ${sentAt}`, `Timezone: ${timezone}`);
    message = {
      title: `🔔 ${item.name} - Test Notification`,
      body: lines.join("\n"),
    };
  }

  // Filter channels if item has specific channels configured
  let itemChannels: string[] | undefined;
  try {
    itemChannels = JSON.parse(item.channels || "[]");
  } catch {
    itemChannels = [];
  }

  const results = await sendNotifications(
    notifyConfig,
    message,
    c.env,
    {
      db: c.env.DB,
      prefix,
      userId,
      itemId: id,
    },
    itemChannels?.length ? itemChannels : undefined,
  );
  return c.json({ results });
});

// Payment history
itemRoutes.get("/:id/payments", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  const payments = await listPaymentsByItem(c.env.DB, prefix, id);
  return c.json(payments);
});

itemRoutes.put("/:id/payments/:pid", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const pid = c.req.param("pid");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  const payment = await getPayment(c.env.DB, prefix, pid);
  if (!payment || payment.item_id !== id) {
    return c.json({ error: "Payment not found" }, 404);
  }

  const body = await c.req.json();

  if (body.amount !== undefined && typeof body.amount !== "number") {
    return c.json({ error: "Amount must be a number" }, 400);
  }
  if (body.date && Number.isNaN(Date.parse(body.date))) {
    return c.json({ error: "Invalid date" }, 400);
  }
  if (body.period_start && Number.isNaN(Date.parse(body.period_start))) {
    return c.json({ error: "Invalid period_start" }, 400);
  }
  if (body.period_end && Number.isNaN(Date.parse(body.period_end))) {
    return c.json({ error: "Invalid period_end" }, 400);
  }

  await updatePayment(c.env.DB, prefix, pid, body);
  return c.json({ success: true });
});

itemRoutes.delete("/:id/payments/:pid", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const pid = c.req.param("pid");

  const item = await getItem(c.env.DB, prefix, id);
  if (!item || item.user_id !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  const payment = await getPayment(c.env.DB, prefix, pid);
  if (!payment || payment.item_id !== id) {
    return c.json({ error: "Payment not found" }, 404);
  }

  await deletePayment(c.env.DB, prefix, pid);

  let newExpiryDate: string | null = null;

  if (payment.period_start) {
    const remaining = await listPaymentsByItem(c.env.DB, prefix, id);
    const hasLaterPayment = remaining.some(
      (p) => p.period_end && p.period_end > (payment.period_start as string),
    );
    if (!hasLaterPayment) {
      if (item.item_mode === "reset") {
        // For reset-mode items, recalculate expiry from the previous payment's period_start or item start_date
        const sortedRemaining = remaining
          .filter((p) => p.period_start)
          .sort((a, b) =>
            (b.period_start || "").localeCompare(a.period_start || ""),
          );
        const prevPayment = sortedRemaining[0];
        const baseDate = (prevPayment?.period_start || item.start_date)?.slice(
          0,
          10,
        );

        if (baseDate) {
          let newExpiry: string;
          let newLunarExpiry: string | null = null;

          if (item.calendar_mode === "both") {
            newExpiry = addPeriod(
              baseDate,
              item.period_value,
              item.period_unit,
            );
            newLunarExpiry =
              item.period_unit === "month"
                ? addLunarMonths(baseDate, item.period_value)
                : item.period_unit === "year"
                  ? addLunarYears(baseDate, item.period_value)
                  : addPeriod(baseDate, item.period_value, item.period_unit);
          } else if (
            item.calendar_mode === "lunar" &&
            item.period_unit === "month"
          ) {
            newExpiry = addLunarMonths(baseDate, item.period_value);
          } else if (
            item.calendar_mode === "lunar" &&
            item.period_unit === "year"
          ) {
            newExpiry = addLunarYears(baseDate, item.period_value);
          } else {
            newExpiry = addPeriod(
              baseDate,
              item.period_value,
              item.period_unit,
            );
          }

          // Restore the previous payment's period_end to the recalculated value
          if (prevPayment) {
            await updatePayment(c.env.DB, prefix, prevPayment.id, {
              period_end: newExpiry,
            });
          }

          await updateItem(c.env.DB, prefix, id, {
            expiry_date: newExpiry,
            ...(item.calendar_mode === "both"
              ? { lunar_expiry_date: newLunarExpiry }
              : {}),
          });
          newExpiryDate = newExpiry;
        } else {
          // No base date available, fall back
          await updateItem(c.env.DB, prefix, id, {
            expiry_date: payment.period_start,
          });
          newExpiryDate = payment.period_start;
        }
      } else {
        await updateItem(c.env.DB, prefix, id, {
          expiry_date: payment.period_start,
        });
      }
    }
  }

  return c.json({
    success: true,
    ...(newExpiryDate ? { new_expiry_date: newExpiryDate } : {}),
  });
});
