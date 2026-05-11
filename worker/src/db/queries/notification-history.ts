export interface NotificationHistoryRecord {
  id: string
  user_id: string
  item_id: string | null
  channel: string
  title: string
  body: string | null
  success: number
  error: string | null
  created_at: string
}

export async function insertNotificationHistory(
  db: D1Database,
  prefix: string,
  record: {
    id: string
    user_id: string
    item_id?: string | null
    channel: string
    title: string
    body?: string | null
    success: boolean
    error?: string | null
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ${prefix}notification_history (id, user_id, item_id, channel, title, body, success, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      new Date().toISOString()
    )
    .run()
}

export async function listNotificationHistory(
  db: D1Database,
  prefix: string,
  userId: string,
  limit = 50
): Promise<NotificationHistoryRecord[]> {
  const result = await db
    .prepare(
      `SELECT h.*, i.name as item_name
       FROM ${prefix}notification_history h
       LEFT JOIN ${prefix}items i ON i.id = h.item_id
       WHERE h.user_id = ?
       ORDER BY h.created_at DESC
       LIMIT ?`
    )
    .bind(userId, limit)
    .all<NotificationHistoryRecord & { item_name?: string }>()
  return result.results
}

export async function deleteNotificationHistory(
  db: D1Database,
  prefix: string,
  userId: string,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM ${prefix}notification_history WHERE id = ? AND user_id = ?`
    )
    .bind(id, userId)
    .run()
  return result.meta.changes > 0
}
