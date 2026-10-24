import {
  DEFAULT_TABLE_PREFIX,
  ensureTrailingUnderscore,
  getTablePrefix,
} from "../types";
import type { Env } from "../types";

export type SetupResult =
  | { success: true; alreadyInitialized?: true; effectivePrefix: string }
  | {
      success: false;
      code: "PREFIX_CONFLICT";
      error: string;
      message: string;
      resolvedPrefix: string;
      detectedPrefixes: string[];
    };

// Unprefixed names of the tables that make up an initialized eNotify schema.
// Used to detect which prefixes the database has already been initialized
// under, so a prefix change can never silently re-initialize fresh tables.
const EONOTIFY_TABLES = [
  "users",
  "user_2fa",
  "items",
  "payment_history",
  "notification_configs",
  "system_settings",
  "notification_history",
];

/**
 * Detects the table prefixes under which an initialized eNotify schema exists.
 * A prefix counts as initialized when at least 4 core tables carrying it are
 * present and one of them is `users`. Unrelated tables (e.g. a lone `users`
 * table from another app) do not trigger a detection.
 */
export function detectTablePrefixes(tableNames: string[]): Set<string> {
  const count: Record<string, number> = {};
  const hasUsers: Record<string, boolean> = {};

  for (const t of tableNames) {
    for (const suffix of EONOTIFY_TABLES) {
      if (t === suffix) {
        count[""] = (count[""] ?? 0) + 1;
        if (suffix === "users") hasUsers[""] = true;
      } else if (t.endsWith("_" + suffix)) {
        const p = t.slice(0, t.length - suffix.length); // keeps the trailing underscore, e.g. "eNotify_"
        count[p] = (count[p] ?? 0) + 1;
        if (suffix === "users") hasUsers[p] = true;
      }
    }
  }

  return new Set(
    Object.entries(count)
      .filter(([p, n]) => n >= 4 && hasUsers[p])
      .map(([p]) => p),
  );
}

const DEFAULT_SETTINGS: Record<string, string> = {
  email_verification_enabled: "false",
  require_2fa: "false",
  registration_enabled: "true",
  smtp_config: "{}",
  resend_config: "{}",
  email_provider: "none",
  app_name: "eNotify",
};

// Channel IDs whose sender code has been removed. Their DB columns are kept
// (dropping them would require rebuilding the table) but any stale ID left in
// enabled_channels is stripped so it cannot fail every push.
const RETIRED_CHANNELS = ["serverchan", "pushplus", "gotify", "notifyx"];

async function runMigrations(db: D1Database, prefix: string): Promise<void> {
  // Migration: add body column to notification_history
  try {
    const histCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_history)`)
      .all<{ name: string }>();
    if (!histCols.results.some((c) => c.name === "body")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}notification_history ADD COLUMN body TEXT`,
        )
        .run();
    }
  } catch {
    // ignore
  }

  // Migration: add slack_config column to notification_configs
  try {
    const notifCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_configs)`)
      .all<{ name: string }>();
    if (!notifCols.results.some((c) => c.name === "slack_config")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}notification_configs ADD COLUMN slack_config TEXT NOT NULL DEFAULT '{}'`,
        )
        .run();
    }
  } catch (err) {
    console.error("Migration failed for notification_configs table:", err);
  }

  // Migration: add feishu_config / discord_config columns to notification_configs
  try {
    const notifCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_configs)`)
      .all<{ name: string }>();
    for (const column of ["feishu_config", "discord_config"]) {
      if (!notifCols.results.some((c) => c.name === column)) {
        await db
          .prepare(
            `ALTER TABLE ${prefix}notification_configs ADD COLUMN ${column} TEXT NOT NULL DEFAULT '{}'`,
          )
          .run();
      }
    }
  } catch (err) {
    console.error("Migration failed for notification_configs table:", err);
  }

  // Migration: add default_channel column to notification_configs. This must
  // run before the retired-channel cleanup, which reads the new column.
  try {
    const notifCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_configs)`)
      .all<{ name: string }>();
    if (!notifCols.results.some((c) => c.name === "default_channel")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}notification_configs ADD COLUMN default_channel TEXT NOT NULL DEFAULT ''`,
        )
        .run();
    }
  } catch (err) {
    console.error("Migration failed for notification_configs table:", err);
  }

  // Migration: drop retired channels (serverchan/pushplus/gotify/notifyx) from
  // enabled_channels and default_channel. Their sender code is gone, so stale
  // enabled IDs would fail and a retired default would make routing fail too.
  // Idempotent: the second run finds nothing to strip and performs no UPDATE.
  try {
    const rows = await db
      .prepare(
        `SELECT user_id, enabled_channels, default_channel FROM ${prefix}notification_configs`,
      )
      .all<{
        user_id: string;
        enabled_channels: string;
        default_channel: string;
      }>();
    for (const row of rows.results) {
      let channels: unknown;
      try {
        channels = JSON.parse(row.enabled_channels || "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(channels)) continue;
      const filtered = channels.filter((ch) => !RETIRED_CHANNELS.includes(ch));
      const defaultChannel = RETIRED_CHANNELS.includes(row.default_channel)
        ? ""
        : row.default_channel;
      if (
        filtered.length === channels.length &&
        defaultChannel === row.default_channel
      ) {
        continue;
      }
      await db
        .prepare(
          `UPDATE ${prefix}notification_configs SET enabled_channels = ?, default_channel = ? WHERE user_id = ?`,
        )
        .bind(JSON.stringify(filtered), defaultChannel, row.user_id)
        .run();
    }
  } catch (err) {
    console.error("Migration failed to drop retired channels:", err);
  }

  // Migration: items table columns (type/use_lunar -> calendar_mode, lunar_expiry_date).
  // Uses ALTER TABLE instead of recreating the table: DROP TABLE would cascade-delete payment_history.
  try {
    const colCheck = await db
      .prepare(`PRAGMA table_info(${prefix}items)`)
      .all<{ name: string }>();
    const cols = new Set(colCheck.results.map((c) => c.name));

    if (!cols.has("calendar_mode")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}items ADD COLUMN calendar_mode TEXT NOT NULL DEFAULT 'solar'`,
        )
        .run();
      if (cols.has("use_lunar")) {
        await db
          .prepare(
            `UPDATE ${prefix}items SET calendar_mode = CASE WHEN use_lunar = 1 THEN 'lunar' ELSE 'solar' END`,
          )
          .run();
      }
    }
    if (!cols.has("lunar_expiry_date")) {
      await db
        .prepare(`ALTER TABLE ${prefix}items ADD COLUMN lunar_expiry_date TEXT`)
        .run();
    }
    if (cols.has("use_lunar")) {
      await db
        .prepare(`ALTER TABLE ${prefix}items DROP COLUMN use_lunar`)
        .run();
    }
    if (cols.has("type")) {
      await db.prepare(`ALTER TABLE ${prefix}items DROP COLUMN type`).run();
    }
  } catch (err) {
    console.error("Migration failed for items table:", err);
  }
}

export async function runSetup(env: Env): Promise<SetupResult> {
  const prefix = getTablePrefix(env);
  const db = env.DB;

  // Anti-silent-switch guard: if the database already holds an initialized
  // eNotify schema under a different prefix, abort instead of re-initializing
  // fresh tables under the resolved prefix.
  const rows = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all<{ name: string }>();
  const detected = detectTablePrefixes(rows.results.map((r) => r.name));

  if (!detected.has(prefix) && detected.size > 0) {
    const detectedList = [...detected].sort();
    let message: string;
    if (
      detected.has("") &&
      prefix === ensureTrailingUnderscore(DEFAULT_TABLE_PREFIX)
    ) {
      message =
        `Detected a legacy schema without table prefix, but TABLE_PREFIX is unset ` +
        `(resolves to "${prefix}"). To keep the legacy tables, set TABLE_PREFIX to an ` +
        `explicit empty value (GitHub vars: TABLE_PREFIX=none, injected as "" by CI), ` +
        `or migrate the tables to the "${prefix}" prefix per the README upgrade guide.`;
    } else {
      message =
        `TABLE_PREFIX mismatch: this database is already initialized under a different ` +
        `table prefix (detected: ${detectedList.join(", ")}), but TABLE_PREFIX resolves ` +
        `to "${prefix}". Set TABLE_PREFIX explicitly to keep the existing tables ` +
        `(e.g. "${detectedList[0]}"), or migrate the tables to the new prefix before ` +
        `retrying setup.`;
    }

    return {
      success: false,
      code: "PREFIX_CONFLICT",
      error: message,
      message,
      resolvedPrefix: prefix,
      detectedPrefixes: detectedList,
    };
  }

  // Check if already initialized under the resolved prefix
  const existing = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .bind(`${prefix}users`)
    .first();

  if (existing) {
    await runMigrations(db, prefix);
    return { success: true, alreadyInitialized: true, effectivePrefix: prefix };
  }

  const schemaSQL = getSchema();
  const resolvedSQL = schemaSQL.replace(/\{prefix\}/g, prefix);

  const statements = resolvedSQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }

  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${prefix}system_settings (key, value, updated_at) VALUES (?, ?, ?)`,
      )
      .bind(key, value, now)
      .run();
  }

  return { success: true, effectivePrefix: prefix };
}

function getSchema(): string {
  return `CREATE TABLE IF NOT EXISTS {prefix}users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  is_active     INTEGER NOT NULL DEFAULT 1,
  email_verified INTEGER NOT NULL DEFAULT 0,
  base_currency TEXT NOT NULL DEFAULT 'CNY',
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  language      TEXT NOT NULL DEFAULT 'zh',
  theme         TEXT NOT NULL DEFAULT 'system',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}user_2fa (
  user_id           TEXT PRIMARY KEY REFERENCES {prefix}users(id) ON DELETE CASCADE,
  totp_secret       TEXT,
  totp_enabled      INTEGER NOT NULL DEFAULT 0,
  passkey_credentials TEXT,
  passkey_enabled   INTEGER NOT NULL DEFAULT 0,
  email_otp_enabled INTEGER NOT NULL DEFAULT 0,
  preferred_method  TEXT,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}items (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES {prefix}users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  item_mode   TEXT NOT NULL DEFAULT 'cycle',
  category    TEXT NOT NULL DEFAULT '',
  start_date  TEXT,
  expiry_date TEXT NOT NULL,
  period_value  INTEGER NOT NULL DEFAULT 1,
  period_unit   TEXT NOT NULL DEFAULT 'month',
  reminder_unit  TEXT NOT NULL DEFAULT 'day',
  reminder_value INTEGER NOT NULL DEFAULT 7,
  notes             TEXT NOT NULL DEFAULT '',
  amount            REAL,
  currency          TEXT NOT NULL DEFAULT 'CNY',
  last_payment_date TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  auto_renew        INTEGER NOT NULL DEFAULT 1,
  calendar_mode     TEXT NOT NULL DEFAULT 'solar',
  lunar_expiry_date TEXT,
  channels          TEXT NOT NULL DEFAULT '[]',
  notification_hours TEXT NOT NULL DEFAULT '[]',
  item_kind         TEXT NOT NULL DEFAULT 'regular',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}items_user_id
  ON {prefix}items(user_id);

CREATE TABLE IF NOT EXISTS {prefix}payment_history (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES {prefix}items(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  date        TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'CNY',
  type        TEXT NOT NULL DEFAULT 'manual',
  note        TEXT NOT NULL DEFAULT '',
  period_start TEXT,
  period_end   TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}payment_history_item_id
  ON {prefix}payment_history(item_id);
CREATE INDEX IF NOT EXISTS idx_{prefix}payment_history_user_id
  ON {prefix}payment_history(user_id);

CREATE TABLE IF NOT EXISTS {prefix}notification_configs (
  user_id           TEXT PRIMARY KEY REFERENCES {prefix}users(id) ON DELETE CASCADE,
  enabled_channels  TEXT NOT NULL DEFAULT '[]',
  default_channel TEXT NOT NULL DEFAULT '',
  telegram_config   TEXT NOT NULL DEFAULT '{}',
  webhook_config    TEXT NOT NULL DEFAULT '{}',
  wechatbot_config  TEXT NOT NULL DEFAULT '{}',
  email_config      TEXT NOT NULL DEFAULT '{}',
  bark_config       TEXT NOT NULL DEFAULT '{}',
  slack_config      TEXT NOT NULL DEFAULT '{}',
  feishu_config     TEXT NOT NULL DEFAULT '{}',
  discord_config    TEXT NOT NULL DEFAULT '{}',
  notification_hours TEXT NOT NULL DEFAULT '[]',
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}notification_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  item_id    TEXT,
  channel    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  success    INTEGER NOT NULL DEFAULT 1,
  error      TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}notification_history_user_id
  ON {prefix}notification_history(user_id, created_at)`;
}
