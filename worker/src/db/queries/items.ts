import type { Item } from '../../types';

export async function createItem(
  db: D1Database,
  prefix: string,
  data: Omit<Item, 'created_at' | 'updated_at'>
): Promise<void> {
  const table = `${prefix}items`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ${table}
         (id, user_id, name, item_mode, category, start_date, expiry_date,
          period_value, period_unit, reminder_unit, reminder_value, notes, amount, currency,
          last_payment_date, is_active, auto_renew, calendar_mode, channels, notification_hours, item_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.user_id,
      data.name,
      data.item_mode,
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
      data.calendar_mode,
      data.channels,
      data.notification_hours,
      data.item_kind,
      now,
      now
    )
    .run();
}

export async function getItem(
  db: D1Database,
  prefix: string,
  id: string
): Promise<Item | null> {
  const table = `${prefix}items`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<Item>();
}

export async function listItemsByUser(
  db: D1Database,
  prefix: string,
  userId: string
): Promise<Item[]> {
  const table = `${prefix}items`;
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<Item>();
  return result.results;
}

export async function updateItem(
  db: D1Database,
  prefix: string,
  id: string,
  data: Partial<Item>
): Promise<void> {
  const table = `${prefix}items`;
  const now = new Date().toISOString();
  const allowedCols = new Set(['name', 'item_mode', 'category', 'start_date', 'expiry_date', 'period_value', 'period_unit', 'reminder_unit', 'reminder_value', 'notes', 'amount', 'currency', 'last_payment_date', 'is_active', 'auto_renew', 'calendar_mode', 'channels', 'notification_hours', 'item_kind']);
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

export async function deleteItem(
  db: D1Database,
  prefix: string,
  id: string
): Promise<void> {
  const table = `${prefix}items`;
  await db
    .prepare(`DELETE FROM ${table} WHERE id = ?`)
    .bind(id)
    .run();
}

export async function toggleItemStatus(
  db: D1Database,
  prefix: string,
  id: string
): Promise<void> {
  const table = `${prefix}items`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE ${table} SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?`
    )
    .bind(now, id)
    .run();
}

export async function getActiveItemsByUser(
  db: D1Database,
  prefix: string,
  userId: string
): Promise<Item[]> {
  const table = `${prefix}items`;
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND is_active = 1 ORDER BY expiry_date ASC`)
    .bind(userId)
    .all<Item>();
  return result.results;
}
