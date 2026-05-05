import type { Subscription } from '../../types';

export async function createSubscription(
  db: D1Database,
  prefix: string,
  data: Omit<Subscription, 'created_at' | 'updated_at'>
): Promise<void> {
  const table = `${prefix}subscriptions`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ${table}
         (id, user_id, name, subscription_mode, custom_type, category, start_date, expiry_date,
          period_value, period_unit, reminder_unit, reminder_value, notes, amount, currency,
          last_payment_date, is_active, auto_renew, use_lunar, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.user_id,
      data.name,
      data.subscription_mode,
      data.custom_type,
      data.category,
      data.start_date,
      data.expiry_date,
      data.period_value,
      data.period_unit,
      data.reminder_unit,
      data.reminder_value,
      data.notes,
      data.amount,
      data.currency,
      data.last_payment_date,
      data.is_active,
      data.auto_renew,
      data.use_lunar,
      now,
      now
    )
    .run();
}

export async function getSubscription(
  db: D1Database,
  prefix: string,
  id: string
): Promise<Subscription | null> {
  const table = `${prefix}subscriptions`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<Subscription>();
}

export async function listSubscriptionsByUser(
  db: D1Database,
  prefix: string,
  userId: string
): Promise<Subscription[]> {
  const table = `${prefix}subscriptions`;
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<Subscription>();
  return result.results;
}

export async function updateSubscription(
  db: D1Database,
  prefix: string,
  id: string,
  data: Partial<Subscription>
): Promise<void> {
  const table = `${prefix}subscriptions`;
  const now = new Date().toISOString();
  const allowedCols = new Set(['name', 'subscription_mode', 'custom_type', 'category', 'start_date', 'expiry_date', 'period_value', 'period_unit', 'reminder_unit', 'reminder_value', 'notes', 'amount', 'currency', 'last_payment_date', 'is_active', 'auto_renew', 'use_lunar']);
  const entries = (Object.entries(data) as [string, unknown][]).filter(
    ([col]) => allowedCols.has(col)
  );
  if (entries.length === 0) return;

  const setClauses = entries.map(([col]) => `${col} = ?`).join(', ');
  const values = entries.map(([, val]) => val);

  await db
    .prepare(`UPDATE ${table} SET ${setClauses}, updated_at = ? WHERE id = ?`)
    .bind(...values, now, id)
    .run();
}

export async function deleteSubscription(
  db: D1Database,
  prefix: string,
  id: string
): Promise<void> {
  const table = `${prefix}subscriptions`;
  await db
    .prepare(`DELETE FROM ${table} WHERE id = ?`)
    .bind(id)
    .run();
}

export async function toggleSubscriptionStatus(
  db: D1Database,
  prefix: string,
  id: string
): Promise<void> {
  const table = `${prefix}subscriptions`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE ${table} SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?`
    )
    .bind(now, id)
    .run();
}

export async function getActiveSubscriptionsByUser(
  db: D1Database,
  prefix: string,
  userId: string
): Promise<Subscription[]> {
  const table = `${prefix}subscriptions`;
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND is_active = 1 ORDER BY expiry_date ASC`)
    .bind(userId)
    .all<Subscription>();
  return result.results;
}

