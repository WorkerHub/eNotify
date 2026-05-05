import { Hono } from 'hono'
import type { Env } from '../types'

type HonoEnv = { Bindings: Env }

export const setupRoutes = new Hono<HonoEnv>()

const DEFAULT_SETTINGS: Record<string, string> = {
  email_verification_enabled: '0',
  require_2fa: '0',
  registration_enabled: '1',
  smtp_config: '{}',
  resend_config: '{}',
  email_provider: 'none',
}

setupRoutes.get('/:secret', async (c) => {
  const secret = c.req.param('secret')

  if (!c.env.SETUP_SECRET || secret !== c.env.SETUP_SECRET) {
    return c.json({ error: 'Invalid setup secret' }, 403)
  }

  return runSetup(c)
})

setupRoutes.post('/', async (c) => {
  const secret = c.req.header('X-Setup-Secret')

  if (!c.env.SETUP_SECRET || secret !== c.env.SETUP_SECRET) {
    return c.json({ error: 'Invalid setup secret' }, 403)
  }

  return runSetup(c)
})

async function runSetup(c: any) {
  const prefix = c.env.TABLE_PREFIX || ''
  if (prefix && !/^[a-z0-9_]+$/.test(prefix)) {
    return c.json({ error: 'Invalid TABLE_PREFIX: only lowercase alphanumeric and underscore allowed' }, 400)
  }
  const db = c.env.DB

  const schemaSQL = getSchema()
  const resolvedSQL = schemaSQL.replace(/\{prefix\}/g, prefix)

  const statements = resolvedSQL
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const tablesCreated: string[] = []

  for (const stmt of statements) {
    await db.prepare(stmt).run()
    const match = stmt.match(/CREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+(\S+)/i)
    if (match) {
      tablesCreated.push(match[1])
    }
  }

  const now = new Date().toISOString()
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${prefix}system_settings (key, value, updated_at) VALUES (?, ?, ?)`
      )
      .bind(key, value, now)
      .run()
  }

  return c.json({ success: true, tablesCreated })
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

CREATE TABLE IF NOT EXISTS {prefix}subscriptions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES {prefix}users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  subscription_mode TEXT NOT NULL DEFAULT 'cycle',
  custom_type       TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT '',
  start_date        TEXT,
  expiry_date       TEXT NOT NULL,
  period_value      INTEGER NOT NULL DEFAULT 1,
  period_unit       TEXT NOT NULL DEFAULT 'month',
  reminder_unit     TEXT NOT NULL DEFAULT 'day',
  reminder_value    INTEGER NOT NULL DEFAULT 7,
  notes             TEXT NOT NULL DEFAULT '',
  amount            REAL,
  currency          TEXT NOT NULL DEFAULT 'CNY',
  last_payment_date TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  auto_renew        INTEGER NOT NULL DEFAULT 1,
  use_lunar         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}subscriptions_user_id
  ON {prefix}subscriptions(user_id);

CREATE TABLE IF NOT EXISTS {prefix}payment_history (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES {prefix}subscriptions(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_{prefix}payment_history_subscription_id
  ON {prefix}payment_history(subscription_id);
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
)`
}
