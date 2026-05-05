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
  show_lunar    INTEGER NOT NULL DEFAULT 0,
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
  custom_type TEXT NOT NULL DEFAULT '',
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
  use_lunar   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}items_user_id
  ON {prefix}items(user_id);

CREATE TABLE IF NOT EXISTS {prefix}payment_history (
  id      TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES {prefix}items(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
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
  telegram_config   TEXT NOT NULL DEFAULT '{}',
  webhook_config    TEXT NOT NULL DEFAULT '{}',
  wechatbot_config  TEXT NOT NULL DEFAULT '{}',
  email_config      TEXT NOT NULL DEFAULT '{}',
  bark_config       TEXT NOT NULL DEFAULT '{}',
  gotify_config     TEXT NOT NULL DEFAULT '{}',
  serverchan_config TEXT NOT NULL DEFAULT '{}',
  pushplus_config   TEXT NOT NULL DEFAULT '{}',
  notifyx_config    TEXT NOT NULL DEFAULT '{}',
  notification_hours TEXT NOT NULL DEFAULT '[]',
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
