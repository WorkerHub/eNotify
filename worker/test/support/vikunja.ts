import { runSetup } from "../../src/lib/setup";
import type { Env } from "../../src/types";
import { MockKV, TEST_JWT_SECRET, TEST_SETUP_SECRET } from "../helpers";
import { SqliteD1 } from "./sqlite-d1";

/** Prefix used by every Vikunja integration test ("en" → tables `en_*`). */
export const VIKUNJA_PREFIX = "en_";
export const VIKUNJA_USER_ID = "u-1";

const encoder = new TextEncoder();

export function makeVikunjaEnv(d1: SqliteD1): Env {
  return {
    DB: d1,
    KV: new MockKV(),
    JWT_SECRET: TEST_JWT_SECRET,
    SETUP_SECRET: TEST_SETUP_SECRET,
    TABLE_PREFIX: "en",
    ASSETS: {},
  } as unknown as Env;
}

/** Fresh database through the real migration runner. */
export async function setupVikunjaDb(): Promise<{
  d1: SqliteD1;
  env: Env;
}> {
  const d1 = new SqliteD1();
  const env = makeVikunjaEnv(d1);
  const result = await runSetup(env);
  if (!result.success) throw new Error("setup failed");
  return { d1, env };
}

export function seedVikunjaUser(
  d1: SqliteD1,
  opts: { userId?: string; timezone?: string; isActive?: boolean } = {},
): string {
  const userId = opts.userId ?? VIKUNJA_USER_ID;
  const now = "2026-01-01T00:00:00.000Z";
  d1.db
    .prepare(
      `INSERT INTO ${VIKUNJA_PREFIX}users
         (id, email, password_hash, is_active, timezone, created_at, updated_at)
       VALUES (?, ?, 'hash', ?, ?, ?, ?)`,
    )
    .run(
      userId,
      `${userId}@example.com`,
      opts.isActive === false ? 0 : 1,
      opts.timezone ?? "Asia/Shanghai",
      now,
      now,
    );
  return userId;
}

export function seedVikunjaConfig(
  d1: SqliteD1,
  opts: {
    userId?: string;
    defaultChannel?: string;
    notificationHours?: string;
  } = {},
): void {
  d1.db
    .prepare(
      `INSERT INTO ${VIKUNJA_PREFIX}notification_configs
         (user_id, enabled_channels, default_channel, telegram_config,
          bark_config, notification_hours, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.userId ?? VIKUNJA_USER_ID,
      '["telegram","bark"]',
      opts.defaultChannel ?? "telegram",
      '{"bot_token":"bot-token","chat_id":"42"}',
      '{"device_key":"device-key"}',
      opts.notificationHours ?? "[]",
      "2026-01-01T00:00:00.000Z",
    );
}

export function seedVikunjaIntegration(
  d1: SqliteD1,
  opts: {
    userId?: string;
    hookToken?: string;
    secret?: string;
    baseUrl?: string;
    enabled?: boolean;
  } = {},
): { hookToken: string; secret: string } {
  const hookToken = opts.hookToken ?? "vhk_seeded_token";
  const secret = opts.secret ?? "seeded-secret-value";
  const now = "2026-01-01T00:00:00.000Z";
  d1.db
    .prepare(
      `INSERT INTO ${VIKUNJA_PREFIX}vikunja_integrations
         (user_id, hook_token, secret, base_url, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.userId ?? VIKUNJA_USER_ID,
      hookToken,
      secret,
      opts.baseUrl ?? "https://vikunja.example.com",
      opts.enabled === false ? 0 : 1,
      now,
      now,
    );
  return { hookToken, secret };
}

export function setVikunjaIntegration(
  d1: SqliteD1,
  fields: { enabled?: number; base_url?: string; secret?: string },
  userId = VIKUNJA_USER_ID,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  d1.db
    .prepare(
      `UPDATE ${VIKUNJA_PREFIX}vikunja_integrations SET ${sets.join(", ")} WHERE user_id = ?`,
    )
    .run(...values, userId);
}

/** Hex HMAC-SHA256 of the raw body, exactly what Vikunja sends. */
export async function signVikunjaBody(
  secret: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
