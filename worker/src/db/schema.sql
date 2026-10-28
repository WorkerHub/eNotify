-- enotify database schema
-- All table names use {prefix} placeholder, replaced at runtime

CREATE TABLE IF NOT EXISTS {prefix}users (
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
  period_value    INTEGER NOT NULL DEFAULT 1,
  period_unit     TEXT NOT NULL DEFAULT 'month',
  reminder_unit   TEXT NOT NULL DEFAULT 'day',
  reminder_value  INTEGER NOT NULL DEFAULT 7,
  notes           TEXT NOT NULL DEFAULT '',
  amount          REAL,
  currency        TEXT NOT NULL DEFAULT 'CNY',
  last_payment_date TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  auto_renew  INTEGER NOT NULL DEFAULT 1,
  calendar_mode TEXT NOT NULL DEFAULT 'solar',
  lunar_expiry_date TEXT,
  channels    TEXT NOT NULL DEFAULT '[]',
  notification_hours TEXT NOT NULL DEFAULT '[]',
  item_kind   TEXT NOT NULL DEFAULT 'regular',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}items_user_id
  ON {prefix}items(user_id);

CREATE TABLE IF NOT EXISTS {prefix}payment_history (
  id      TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES {prefix}items(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES {prefix}users(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  amount          REAL NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'CNY',
  type            TEXT NOT NULL DEFAULT 'manual',
  note            TEXT NOT NULL DEFAULT '',
  period_start    TEXT,
  period_end      TEXT,
  created_at      TEXT NOT NULL
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
  user_id    TEXT NOT NULL REFERENCES {prefix}users(id) ON DELETE CASCADE,
  item_id    TEXT REFERENCES {prefix}items(id) ON DELETE SET NULL,
  channel    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  success    INTEGER NOT NULL DEFAULT 1,
  error      TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}notification_history_user_id
  ON {prefix}notification_history(user_id, created_at);

-- Waker executionId idempotency ledger (SDK `createD1ExecutionLedger`).
-- The eight columns are frozen verbatim from waker-client 2.0.0
-- `executionLedgerDdl()` — schema_v3 creates the same table at runtime.
-- (Keep semicolons out of these comment lines: tests split this file on them.)
CREATE TABLE IF NOT EXISTS {prefix}waker_executions (
  execution_id   TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL,
  job_name       TEXT NOT NULL,
  scheduled_for  INTEGER NOT NULL,
  status         TEXT NOT NULL,
  response_json  TEXT,
  claimed_at     INTEGER NOT NULL,
  completed_at   INTEGER
);

-- Cross-entry hourly tick claim: one row per claimed UTC hour, written by both
-- the native cron and the waker callback (schema_v3).
CREATE TABLE IF NOT EXISTS {prefix}scheduler_tick_claims (
  tick_key   TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}scheduler_tick_claims_claimed_at
  ON {prefix}scheduler_tick_claims(claimed_at);
