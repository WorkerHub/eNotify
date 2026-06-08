import type { NotificationConfig } from "../../types";

export async function getNotificationConfig(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<NotificationConfig | null> {
  const table = `${prefix}notification_configs`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
    .bind(userId)
    .first<NotificationConfig>();
}

export async function upsertNotificationConfig(
  db: D1Database,
  prefix: string,
  userId: string,
  data: Partial<Omit<NotificationConfig, "user_id" | "updated_at">>,
): Promise<void> {
  const table = `${prefix}notification_configs`;
  const now = new Date().toISOString();

  const columns: string[] = ["user_id"];
  const placeholders: string[] = ["?"];
  const insertValues: unknown[] = [userId];

  const updateClauses: string[] = [];
  const updateValues: unknown[] = [];

  const fields: (keyof Omit<NotificationConfig, "user_id" | "updated_at">)[] = [
    "enabled_channels",
    "telegram_config",
    "webhook_config",
    "wechatbot_config",
    "email_config",
    "bark_config",
    "gotify_config",
    "serverchan_config",
    "pushplus_config",
    "notifyx_config",
    "notification_hours",
  ];

  for (const field of fields) {
    if (field in data) {
      columns.push(field);
      placeholders.push("?");
      insertValues.push(data[field]);
      updateClauses.push(`${field} = excluded.${field}`);
      updateValues.push(data[field]);
    }
  }

  columns.push("updated_at");
  placeholders.push("?");
  insertValues.push(now);
  updateClauses.push("updated_at = excluded.updated_at");

  await db
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})
       ON CONFLICT(user_id) DO UPDATE SET ${updateClauses.join(", ")}`,
    )
    .bind(...insertValues)
    .run();
}
