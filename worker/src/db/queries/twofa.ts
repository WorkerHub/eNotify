import type { User2FA } from "../../types";

export async function get2FAConfig(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<User2FA | null> {
  const table = `${prefix}user_2fa`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
    .bind(userId)
    .first<User2FA>();
}

export async function upsert2FAConfig(
  db: D1Database,
  prefix: string,
  userId: string,
  data: Partial<Omit<User2FA, "user_id" | "updated_at">>,
): Promise<void> {
  const table = `${prefix}user_2fa`;
  const now = new Date().toISOString();

  const columns: string[] = ["user_id"];
  const placeholders: string[] = ["?"];
  const insertValues: unknown[] = [userId];

  const updateClauses: string[] = [];

  const fields: (keyof Omit<User2FA, "user_id" | "updated_at">)[] = [
    "totp_secret",
    "totp_enabled",
    "passkey_credentials",
    "passkey_enabled",
    "email_otp_enabled",
    "preferred_method",
  ];

  for (const field of fields) {
    if (field in data) {
      columns.push(field);
      placeholders.push("?");
      insertValues.push(data[field]);
      updateClauses.push(`${field} = excluded.${field}`);
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
