export interface User {
  id: string
  email: string
  role: 'admin' | 'user'
  email_verified: boolean
  is_active: boolean
  base_currency: string
  timezone: string
  language: string
  theme: 'light' | 'dark' | 'system'
  show_lunar: boolean
  created_at: string
  twofa?: {
    totp_enabled: boolean
    passkey_enabled: boolean
    email_otp_enabled: boolean
    preferred_method: string | null
  }
}

export interface Item {
  id: string
  user_id: string
  name: string
  item_mode: 'cycle' | 'reset'
  custom_type: string
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
  created_at: string
  updated_at: string
}

export interface Payment {
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

export interface DashboardStats {
  monthly_expense: number
  monthly_trend: number
  yearly_expense: number
  monthly_average: number
  active_count: number
  expiring_soon: number
  upcoming_renewals: Item[]
  recent_payments: Payment[]
  category_ranking: { name: string; amount: number }[]
  type_ranking: { name: string; amount: number }[]
  base_currency: string
}

export interface NotificationConfig {
  enabled_channels: string[]
  notification_hours: number[]
  [key: string]: unknown
}

export interface SystemSettings {
  email_verification_enabled: string
  require_2fa: string
  registration_enabled: string
  smtp_config: string
  resend_config: string
  email_provider: string
  app_name?: string
}

export interface NotificationHistory {
  id: string
  user_id: string
  item_id: string | null
  item_name?: string
  channel: string
  title: string
  success: number
  error: string | null
  created_at: string
}
