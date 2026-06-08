import type { SystemSetting } from "../../types";

export async function getSetting(
  db: D1Database,
  prefix: string,
  key: string,
): Promise<string | null> {
  const table = `${prefix}system_settings`;
  const row = await db
    .prepare(`SELECT value FROM ${table} WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(
  db: D1Database,
  prefix: string,
  key: string,
  value: string,
): Promise<void> {
  const table = `${prefix}system_settings`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ${table} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run();
}

export async function getAllSettings(
  db: D1Database,
  prefix: string,
): Promise<Record<string, string>> {
  const table = `${prefix}system_settings`;
  const result = await db
    .prepare(`SELECT key, value FROM ${table}`)
    .all<Pick<SystemSetting, "key" | "value">>();
  return Object.fromEntries(result.results.map((row) => [row.key, row.value]));
}
