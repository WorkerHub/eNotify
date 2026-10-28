/**
 * Single source of truth for the database schema: an ordered migration list.
 *
 * Rules for adding migrations (see the ledger migration spec §2.2):
 *
 * - Append new migrations ONLY at the END of the list, named `schema_vN`.
 * - Never rename, re-edit or reorder a migration that has already been merged.
 *   A database that recorded it will not run it again, so editing it only makes
 *   old and new databases diverge.
 * - Migrations must be additive: `CREATE TABLE/INDEX IF NOT EXISTS`,
 *   `ADD COLUMN`, `INSERT OR IGNORE`. No `DROP` / `RENAME` / data rewrites —
 *   destructive changes need their own spec and their own migration plan.
 * - Migration SQL string literals must not contain `;`: the runner splits each
 *   migration on `;` and executes the statements one by one.
 */
export interface Migration {
  name: string;
  sql: string;
}

/**
 * schema_v1 — the whole schema at the time the migration ledger was introduced.
 * Moved verbatim out of the former `getSchema()`; no column definition was
 * changed. `{prefix}` is replaced with the effective table prefix when the
 * migration list is produced.
 */
const SCHEMA_V1 = `CREATE TABLE IF NOT EXISTS {prefix}users (
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

/**
 * schema_v2 — notification history provenance. `trigger_source` is nullable so
 * rows written before this migration keep their meaning (unknown source), and
 * the composite index serves the history page's channel/success/source filters.
 */
const SCHEMA_V2 = `ALTER TABLE {prefix}notification_history ADD COLUMN trigger_source TEXT;
CREATE INDEX IF NOT EXISTS idx_{prefix}notification_history_filter
  ON {prefix}notification_history(user_id, channel, success, created_at)`;

export function getMigrations(prefix: string): Migration[] {
  return [
    {
      name: "schema_v1",
      sql: SCHEMA_V1.replace(/\{prefix\}/g, prefix),
    },
    {
      name: "schema_v2",
      sql: SCHEMA_V2.replace(/\{prefix\}/g, prefix),
    },
  ];
}
