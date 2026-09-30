import type { PaymentHistory } from "../../types";

export function prepareCreatePayment(
  db: D1Database,
  prefix: string,
  data: Omit<PaymentHistory, "created_at">,
): D1PreparedStatement {
  const table = `${prefix}payment_history`;
  const now = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO ${table} (id, item_id, user_id, date, amount, currency, type, note, period_start, period_end, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.item_id,
      data.user_id,
      data.date,
      data.amount,
      data.currency,
      data.type,
      data.note,
      data.period_start,
      data.period_end,
      now,
    );
}

export async function createPayment(
  db: D1Database,
  prefix: string,
  data: Omit<PaymentHistory, "created_at">,
): Promise<void> {
  await prepareCreatePayment(db, prefix, data).run();
}

export async function listPaymentsByItem(
  db: D1Database,
  prefix: string,
  itemId: string,
): Promise<PaymentHistory[]> {
  const table = `${prefix}payment_history`;
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE item_id = ? ORDER BY date DESC`)
    .bind(itemId)
    .all<PaymentHistory>();
  return result.results;
}

export async function listPaymentsByUser(
  db: D1Database,
  prefix: string,
  userId: string,
  limit?: number,
): Promise<PaymentHistory[]> {
  const table = `${prefix}payment_history`;
  if (limit !== undefined) {
    const result = await db
      .prepare(
        `SELECT * FROM ${table} WHERE user_id = ? ORDER BY date DESC LIMIT ?`,
      )
      .bind(userId, limit)
      .all<PaymentHistory>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY date DESC`)
    .bind(userId)
    .all<PaymentHistory>();
  return result.results;
}

export function prepareUpdatePayment(
  db: D1Database,
  prefix: string,
  id: string,
  data: Partial<
    Pick<
      PaymentHistory,
      "date" | "amount" | "currency" | "note" | "period_start" | "period_end"
    >
  >,
): D1PreparedStatement | null {
  const table = `${prefix}payment_history`;
  const allowedCols = new Set([
    "date",
    "amount",
    "currency",
    "note",
    "period_start",
    "period_end",
  ]);
  const entries = (Object.entries(data) as [string, unknown][]).filter(
    ([col]) => allowedCols.has(col),
  );
  if (entries.length === 0) return null;

  const setClauses = entries.map(([col]) => `${col} = ?`).join(", ");
  const values = entries.map(([, val]) => val);

  return db
    .prepare(`UPDATE ${table} SET ${setClauses} WHERE id = ?`)
    .bind(...values, id);
}

export async function updatePayment(
  db: D1Database,
  prefix: string,
  id: string,
  data: Parameters<typeof prepareUpdatePayment>[3],
): Promise<void> {
  await prepareUpdatePayment(db, prefix, id, data)?.run();
}

export async function listPaymentsByUserSince(
  db: D1Database,
  prefix: string,
  userId: string,
  since: string,
): Promise<PaymentHistory[]> {
  const table = `${prefix}payment_history`;
  const result = await db
    .prepare(
      `SELECT * FROM ${table} WHERE user_id = ? AND date >= ? ORDER BY date DESC`,
    )
    .bind(userId, since)
    .all<PaymentHistory>();
  return result.results;
}

export async function getPayment(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<PaymentHistory | null> {
  const table = `${prefix}payment_history`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<PaymentHistory>();
}
