import type { VikunjaIntegration } from "../../types";

/**
 * Data access for `{prefix}vikunja_integrations` (schema_v4): one inbound
 * Vikunja webhook integration per user, keyed by `user_id` (the `hook_token`
 * is unique so a delivery can locate its owner).
 *
 * The plaintext `secret` deliberately lives in this table (HMAC verification
 * needs the raw key); callers that build API responses must never echo it.
 */

export type VikunjaIntegrationUpdates = Partial<
  Pick<VikunjaIntegration, "hook_token" | "secret" | "base_url" | "enabled">
>;

export async function getVikunjaIntegrationByToken(
  db: D1Database,
  prefix: string,
  hookToken: string,
): Promise<VikunjaIntegration | null> {
  const table = `${prefix}vikunja_integrations`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE hook_token = ?`)
    .bind(hookToken)
    .first<VikunjaIntegration>();
}

export async function getVikunjaIntegrationByUser(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<VikunjaIntegration | null> {
  const table = `${prefix}vikunja_integrations`;
  return db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
    .bind(userId)
    .first<VikunjaIntegration>();
}

export async function createVikunjaIntegration(
  db: D1Database,
  prefix: string,
  data: {
    user_id: string;
    hook_token: string;
    secret: string;
    base_url?: string;
    enabled?: boolean;
  },
): Promise<void> {
  const table = `${prefix}vikunja_integrations`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ${table} (user_id, hook_token, secret, base_url, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.user_id,
      data.hook_token,
      data.secret,
      data.base_url ?? "",
      data.enabled === false ? 0 : 1,
      now,
      now,
    )
    .run();
}

export async function updateVikunjaIntegration(
  db: D1Database,
  prefix: string,
  userId: string,
  data: VikunjaIntegrationUpdates,
): Promise<void> {
  const table = `${prefix}vikunja_integrations`;
  const allowedCols = new Set(["hook_token", "secret", "base_url", "enabled"]);
  const entries = (Object.entries(data) as [string, unknown][]).filter(
    ([col]) => allowedCols.has(col),
  );
  if (entries.length === 0) return;

  const setClauses = entries.map(([col]) => `${col} = ?`).join(", ");
  const values = entries.map(([, val]) => val);

  await db
    .prepare(
      `UPDATE ${table} SET ${setClauses}, updated_at = ? WHERE user_id = ?`,
    )
    .bind(...values, new Date().toISOString(), userId)
    .run();
}

export async function deleteVikunjaIntegration(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<boolean> {
  const table = `${prefix}vikunja_integrations`;
  const result = await db
    .prepare(`DELETE FROM ${table} WHERE user_id = ?`)
    .bind(userId)
    .run();
  return result.meta.changes > 0;
}
