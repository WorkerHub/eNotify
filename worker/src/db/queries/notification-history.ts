export interface NotificationHistoryRecord {
  id: string;
  user_id: string;
  item_id: string | null;
  channel: string;
  title: string;
  body: string | null;
  success: number;
  error: string | null;
  trigger_source: string | null;
  created_at: string;
}

export interface ListHistoryOptions {
  limit?: number;
  channel?: string;
  success?: boolean;
  triggerSource?: string;
}

export async function insertNotificationHistory(
  db: D1Database,
  prefix: string,
  record: {
    id: string;
    user_id: string;
    item_id?: string | null;
    channel: string;
    title: string;
    body?: string | null;
    success: boolean;
    error?: string | null;
    trigger_source?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ${prefix}notification_history (id, user_id, item_id, channel, title, body, success, error, trigger_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.id,
      record.user_id,
      record.item_id ?? null,
      record.channel,
      record.title,
      record.body ?? null,
      record.success ? 1 : 0,
      record.error ?? null,
      record.trigger_source ?? null,
      new Date().toISOString(),
    )
    .run();
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

export async function listNotificationHistory(
  db: D1Database,
  prefix: string,
  userId: string,
  options: ListHistoryOptions = {},
): Promise<(NotificationHistoryRecord & { item_name?: string })[]> {
  const where = ["h.user_id = ?"];
  const params: (string | number)[] = [userId];

  if (options.channel) {
    where.push("h.channel = ?");
    params.push(options.channel);
  }
  if (options.success !== undefined) {
    where.push("h.success = ?");
    params.push(options.success ? 1 : 0);
  }
  if (options.triggerSource) {
    where.push("h.trigger_source = ?");
    params.push(options.triggerSource);
  }
  params.push(normalizeLimit(options.limit));

  const result = await db
    .prepare(
      `SELECT h.*, i.name as item_name
       FROM ${prefix}notification_history h
       LEFT JOIN ${prefix}items i ON i.id = h.item_id
       WHERE ${where.join(" AND ")}
       ORDER BY h.created_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all<NotificationHistoryRecord & { item_name?: string }>();
  return result.results;
}

export async function deleteNotificationHistory(
  db: D1Database,
  prefix: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM ${prefix}notification_history WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .run();
  return result.meta.changes > 0;
}

export async function pruneNotificationHistory(
  db: D1Database,
  prefix: string,
  days: number,
): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await db
    .prepare(`DELETE FROM ${prefix}notification_history WHERE created_at < ?`)
    .bind(cutoff)
    .run();
}
