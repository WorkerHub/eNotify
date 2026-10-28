export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
  SETUP_SECRET: string;
  /**
   * Waker callback signing key. Injected only from GitHub Secrets through
   * `wrangler deploy --secrets-file`.
   *
   * Missing / blank / whitespace-only / `*_PLACEHOLDER` all mean "not
   * configured" → native cron only; the receiver stays mounted but fails closed.
   * See `wakerSigningKey()` in `services/scheduler-tick.ts` (the only gate).
   */
  WAKER_SIGNING_KEY?: string;
  /**
   * Table prefix, three states:
   * - undefined/null (unset) → DEFAULT_TABLE_PREFIX ("enotify"), normalized to "enotify_"
   * - non-empty custom value → used verbatim with a trailing "_" appended
   * - explicit empty string "" → no prefix at all
   */
  TABLE_PREFIX?: string;
  ASSETS: Fetcher;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: "admin" | "user";
  is_active: number;
  email_verified: number;
  base_currency: string;
  timezone: string;
  language: string;
  theme: "light" | "dark" | "system";
  created_at: string;
  updated_at: string;
}

export interface User2FA {
  user_id: string;
  totp_secret: string | null;
  totp_enabled: number;
  passkey_credentials: string | null;
  passkey_enabled: number;
  email_otp_enabled: number;
  preferred_method: "totp" | "passkey" | "email_otp" | null;
  updated_at: string;
}

export interface Item {
  id: string;
  user_id: string;
  name: string;
  item_mode: "cycle" | "reset";
  category: string;
  start_date: string | null;
  expiry_date: string;
  period_value: number;
  period_unit: "day" | "week" | "month" | "year";
  reminder_unit: "day" | "hour";
  reminder_value: number;
  notes: string;
  amount: number | null;
  currency: string;
  last_payment_date: string | null;
  is_active: number;
  auto_renew: number;
  calendar_mode: "solar" | "lunar" | "both";
  lunar_expiry_date: string | null;
  channels: string;
  notification_hours: string;
  item_kind: "regular" | "subscription";
  created_at: string;
  updated_at: string;
}

export interface PaymentHistory {
  id: string;
  item_id: string;
  user_id: string;
  date: string;
  amount: number;
  currency: string;
  type: "initial" | "manual" | "auto";
  note: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

export interface NotificationConfig {
  user_id: string;
  enabled_channels: string;
  default_channel: string;
  telegram_config: string;
  webhook_config: string;
  wechatbot_config: string;
  email_config: string;
  bark_config: string;
  slack_config: string;
  feishu_config: string;
  discord_config: string;
  notification_hours: string;
  updated_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
  updated_at: string;
}

export interface JWTPayload {
  sub: string;
  role: string;
  jti: string;
  sid: string;
  exp: number;
  iat: number;
  needs_2fa_setup?: boolean;
  typ?: "access" | "refresh";
}

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    userId: string;
    role: string;
    impersonating?: string;
    apiKeyId?: string;
  };
};

/** Default table prefix used when TABLE_PREFIX is not configured (no trailing underscore). */
export const DEFAULT_TABLE_PREFIX = "enotify";

export function getTablePrefix(env: Env): string {
  const raw = env.TABLE_PREFIX;
  // State 1: unset (undefined or null) → default prefix, normalized with trailing "_"
  if (raw === undefined || raw === null) {
    return ensureTrailingUnderscore(DEFAULT_TABLE_PREFIX);
  }
  // State 3: explicitly configured as empty string → no prefix
  if (raw === "") {
    return "";
  }
  // State 2: custom non-empty value → existing normalization (append trailing "_")
  return ensureTrailingUnderscore(raw);
}

export function ensureTrailingUnderscore(v: string): string {
  return v.endsWith("_") ? v : `${v}_`;
}

export const VALID_CHANNELS: string[] = [
  "telegram",
  "webhook",
  "wechatbot",
  "email",
  "bark",
  "slack",
  "feishu",
  "discord",
];
