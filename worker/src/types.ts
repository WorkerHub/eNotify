export interface Env {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  SETUP_SECRET: string
  TABLE_PREFIX: string
  ASSETS: Fetcher
}

export interface User {
  id: string
  email: string
  password_hash: string
  role: 'admin' | 'user'
  is_active: number
  email_verified: number
  base_currency: string
  timezone: string
  language: string
  theme: 'light' | 'dark' | 'system'
  show_lunar: number
  created_at: string
  updated_at: string
}

export interface User2FA {
  user_id: string
  totp_secret: string | null
  totp_enabled: number
  passkey_credentials: string | null
  passkey_enabled: number
  email_otp_enabled: number
  preferred_method: 'totp' | 'passkey' | 'email_otp' | null
  updated_at: string
}

export interface Item {
  id: string
  user_id: string
  name: string
  item_mode: 'cycle' | 'reset'
  type: string
  category: string
  start_date: string | null
  expiry_date: string
  period_value: number
  period_unit: 'day' | 'month' | 'year'
  reminder_unit: 'day' | 'hour'
  reminder_value: number
  notes: string
  amount: number | null
  currency: string
  last_payment_date: string | null
  is_active: number
  auto_renew: number
  use_lunar: number
  channels: string
  notification_hours: string
  item_kind: 'regular' | 'subscription'
  created_at: string
  updated_at: string
}

export interface PaymentHistory {
  id: string
  item_id: string
  user_id: string
  date: string
  amount: number
  currency: string
  type: 'initial' | 'manual' | 'auto'
  note: string
  period_start: string | null
  period_end: string | null
  created_at: string
}

export interface NotificationConfig {
  user_id: string
  enabled_channels: string
  telegram_config: string
  webhook_config: string
  wechatbot_config: string
  email_config: string
  bark_config: string
  gotify_config: string
  serverchan_config: string
  pushplus_config: string
  notifyx_config: string
  notification_hours: string
  updated_at: string
}

export interface SystemSetting {
  key: string
  value: string
  updated_at: string
}

export interface JWTPayload {
  sub: string
  role: string
  jti: string
  exp: number
  iat: number
  needs_2fa_setup?: boolean
}

export type HonoEnv = { Bindings: Env; Variables: { userId: string; role: string; impersonating?: string } }

export function getTablePrefix(env: Env): string {
  const raw = env.TABLE_PREFIX || ''
  if (!raw) return ''
  return raw.endsWith('_') ? raw : raw + '_'
}

export const VALID_CHANNELS: string[] = ['telegram', 'webhook', 'wechatbot', 'email', 'bark', 'gotify', 'serverchan', 'pushplus', 'notifyx']
