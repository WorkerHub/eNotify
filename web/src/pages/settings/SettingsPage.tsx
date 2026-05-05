import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  User, Shield, Bell, Sliders,
  CheckCircle, XCircle, ChevronDown, ChevronUp,
  QrCode, Key,
} from 'lucide-react'
import QRCode from 'qrcode'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/components/theme-provider'
import { cn, serializeRegistrationCredential, prepareRegistrationOptions } from '@/lib/utils'
import type { NotificationConfig, NotificationHistory } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'account' | 'security' | 'notifications' | 'preferences'

interface ChannelFieldDef {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea' | 'select'
  options?: string[]
  placeholder?: string
}

interface ChannelDef {
  id: string
  label: string
  fields: ChannelFieldDef[]
}

// ---------------------------------------------------------------------------
// Channel definitions
// ---------------------------------------------------------------------------

const CHANNELS: ChannelDef[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    fields: [
      { key: 'bot_token', label: 'Bot Token', type: 'password' },
      { key: 'chat_id', label: 'Chat ID', type: 'text' },
    ],
  },
  {
    id: 'webhook',
    label: 'Webhook',
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://' },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'GET', 'PUT'] },
      { key: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Authorization": "Bearer ..."}' },
      { key: 'template', label: 'Body Template', type: 'textarea' },
    ],
  },
  {
    id: 'wechatbot',
    label: 'WeCom Bot',
    fields: [{ key: 'webhook', label: 'Webhook URL', type: 'text', placeholder: 'https://' }],
  },
  {
    id: 'email',
    label: 'Email',
    fields: [{ key: 'to', label: 'To Address', type: 'text', placeholder: 'you@example.com' }],
  },
  {
    id: 'bark',
    label: 'Bark',
    fields: [
      { key: 'device_key', label: 'Device Key', type: 'text' },
      { key: 'server', label: 'Server (optional)', type: 'text', placeholder: 'https://api.day.app' },
    ],
  },
  {
    id: 'gotify',
    label: 'Gotify',
    fields: [
      { key: 'server_url', label: 'Server URL', type: 'text', placeholder: 'https://' },
      { key: 'app_token', label: 'App Token', type: 'password' },
    ],
  },
  {
    id: 'serverchan',
    label: 'ServerChan',
    fields: [{ key: 'sendkey', label: 'SendKey', type: 'text' }],
  },
  {
    id: 'pushplus',
    label: 'PushPlus',
    fields: [
      { key: 'token', label: 'Token', type: 'text' },
      { key: 'topic', label: 'Topic (optional)', type: 'text' },
      { key: 'channel', label: 'Channel (optional)', type: 'text' },
    ],
  },
  {
    id: 'notifyx',
    label: 'NotifyX',
    fields: [{ key: 'api_key', label: 'API Key', type: 'password' }],
  },
]

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function FormField({
  def,
  value,
  onChange,
}: {
  def: ChannelFieldDef
  value: string
  onChange: (v: string) => void
}) {
  const base =
    'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring'

  if (def.type === 'textarea') {
    return (
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(base, 'resize-none')}
        placeholder={def.placeholder}
      />
    )
  }
  if (def.type === 'select' && def.options) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      type={def.type === 'password' ? 'password' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={base}
      placeholder={def.placeholder}
    />
  )
}

function StatusBadge({ ok }: { ok: boolean }) {
  const { t } = useTranslation()
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">
      <CheckCircle className="w-3 h-3" />
      {t('common.enabled')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
      <XCircle className="w-3 h-3" />
      {t('common.disabled')}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Account Tab
// ---------------------------------------------------------------------------

function AccountTab() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess(false)
    setPwLoading(true)
    try {
      await api.put('/me/password', { currentPassword, newPassword })
      setPwSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
    } catch (err: any) {
      setPwError(err.message || t('common.error'))
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile info */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('settings.account')}</h3>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{user?.email}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
          </div>
          {user?.email_verified && (
            <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
          )}
        </div>
      </div>

      {/* Change password */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">{t('settings.changePassword')}</h3>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t('settings.currentPassword')}
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t('settings.newPassword')}
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {pwError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{pwError}</p>
          )}
          {pwSuccess && (
            <p className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-md">
              {t('common.success')}
            </p>
          )}
          <button
            type="submit"
            disabled={pwLoading}
            className="py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
          >
            {pwLoading ? t('common.loading') : t('common.save')}
          </button>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Security Tab
// ---------------------------------------------------------------------------

function SecurityTab() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()

  const twofa = user?.twofa

  // TOTP setup state
  const [totpSetupData, setTotpSetupData] = useState<{ qrCode: string; secret: string } | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpError, setTotpError] = useState('')
  const [totpLoading, setTotpLoading] = useState(false)

  // Passkey
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [passkeyError, setPasskeyError] = useState('')

  // Email OTP
  const [emailOtpLoading, setEmailOtpLoading] = useState(false)
  const [emailOtpError, setEmailOtpError] = useState('')

  const startTotpSetup = async () => {
    setTotpError('')
    setTotpLoading(true)
    try {
      const res = await api.post<any>('/auth/2fa/totp/setup')
      const qrCode = await QRCode.toDataURL(res.uri)
      setTotpSetupData({ qrCode, secret: res.secret })
      setTotpCode('')
    } catch (err: any) {
      setTotpError(err.message || t('common.error'))
    } finally {
      setTotpLoading(false)
    }
  }

  const confirmTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setTotpError('')
    setTotpLoading(true)
    try {
      await api.post('/auth/2fa/totp/enable', { code: totpCode })
      setTotpSetupData(null)
      setTotpCode('')
      await refreshUser()
    } catch (err: any) {
      setTotpError(err.message || t('common.error'))
    } finally {
      setTotpLoading(false)
    }
  }

  const disableTotp = async () => {
    setTotpLoading(true)
    try {
      await api.post('/auth/2fa/totp/disable')
      await refreshUser()
    } catch (err: any) {
      setTotpError(err.message || t('common.error'))
    } finally {
      setTotpLoading(false)
    }
  }

  const registerPasskey = async () => {
    setPasskeyError('')
    setPasskeyLoading(true)
    try {
      const opts = await api.post<any>('/auth/2fa/passkey/register/options')
      const credential = await navigator.credentials.create({
        publicKey: prepareRegistrationOptions(opts),
      })
      if (!credential) throw new Error('No credential returned')
      const serialized = serializeRegistrationCredential(credential as PublicKeyCredential)
      await api.post('/auth/2fa/passkey/register/verify', serialized)
      await refreshUser()
    } catch (err: any) {
      setPasskeyError(err.message || t('common.error'))
    } finally {
      setPasskeyLoading(false)
    }
  }

  const disablePasskey = async () => {
    setPasskeyLoading(true)
    try {
      await api.post('/auth/2fa/passkey/disable')
      await refreshUser()
    } catch (err: any) {
      setPasskeyError(err.message || t('common.error'))
    } finally {
      setPasskeyLoading(false)
    }
  }

  const toggleEmailOtp = async () => {
    setEmailOtpError('')
    setEmailOtpLoading(true)
    try {
      if (twofa?.email_otp_enabled) {
        await api.post('/auth/2fa/email-otp/disable')
      } else {
        await api.post('/auth/2fa/email-otp/enable')
      }
      await refreshUser()
    } catch (err: any) {
      setEmailOtpError(err.message || t('common.error'))
    } finally {
      setEmailOtpLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* TOTP */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{t('auth.totp')}</h3>
          </div>
          <StatusBadge ok={!!twofa?.totp_enabled} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t('settings.totpDescription')}
        </p>

        {totpError && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-3">{totpError}</p>
        )}

        {!twofa?.totp_enabled && !totpSetupData && (
          <button
            onClick={startTotpSetup}
            disabled={totpLoading}
            className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
          >
            {totpLoading ? t('common.loading') : t('auth.setup2fa')}
          </button>
        )}

        {totpSetupData && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <img
                src={totpSetupData.qrCode}
                alt="TOTP QR code"
                className="w-40 h-40 rounded-md border"
              />
            </div>
            <p className="text-xs text-center text-muted-foreground break-all bg-muted px-3 py-2 rounded-md font-mono">
              {totpSetupData.secret}
            </p>
            <form onSubmit={confirmTotpSetup} className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={totpLoading || totpCode.length < 6}
                className="py-2 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
              >
                {t('common.confirm')}
              </button>
            </form>
          </div>
        )}

        {twofa?.totp_enabled && (
          <button
            onClick={disableTotp}
            disabled={totpLoading}
            className="py-1.5 px-3 bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 text-destructive text-xs font-medium rounded-md transition-colors"
          >
            {totpLoading ? t('common.loading') : t('common.disable')}
          </button>
        )}
      </div>

      {/* Email OTP */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{t('auth.emailOtp')}</h3>
          </div>
          <StatusBadge ok={!!twofa?.email_otp_enabled} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t('settings.emailOtpDescription')}
        </p>

        {emailOtpError && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-3">{emailOtpError}</p>
        )}

        <button
          onClick={toggleEmailOtp}
          disabled={emailOtpLoading}
          className={cn(
            'py-1.5 px-3 text-xs font-medium rounded-md transition-colors disabled:opacity-50',
            twofa?.email_otp_enabled
              ? 'bg-destructive/10 hover:bg-destructive/20 text-destructive'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          )}
        >
          {emailOtpLoading
            ? t('common.loading')
            : twofa?.email_otp_enabled
            ? t('common.disable')
            : t('common.enable')}
        </button>
      </div>

      {/* Passkey */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{t('auth.passkey')}</h3>
          </div>
          <StatusBadge ok={!!twofa?.passkey_enabled} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t('settings.passkeyDescription')}
        </p>

        {passkeyError && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-3">{passkeyError}</p>
        )}

        {!twofa?.passkey_enabled ? (
          <button
            onClick={registerPasskey}
            disabled={passkeyLoading}
            className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
          >
            {passkeyLoading ? t('common.loading') : t('common.registerPasskey')}
          </button>
        ) : (
          <button
            onClick={disablePasskey}
            disabled={passkeyLoading}
            className="py-1.5 px-3 bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 text-destructive text-xs font-medium rounded-md transition-colors"
          >
            {passkeyLoading ? t('common.loading') : t('common.disable')}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notifications Tab
// ---------------------------------------------------------------------------

function ChannelCard({
  channel,
  config,
  onConfigChange,
}: {
  channel: ChannelDef
  config: NotificationConfig
  onConfigChange: (updated: NotificationConfig) => void
}) {
  const { t } = useTranslation()

  const isEnabled = config.enabled_channels.includes(channel.id)
  const channelConfig = (config[channel.id] as Record<string, string>) ?? {}

  const [expanded, setExpanded] = useState(false)
  const [localFields, setLocalFields] = useState<Record<string, string>>(channelConfig)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // Sync if parent config changes (only from server, not local edits)
  const configJson = JSON.stringify((config[channel.id] as Record<string, string>) ?? {})
  useEffect(() => {
    setLocalFields(JSON.parse(configJson))
  }, [configJson])

  const toggleEnabled = async () => {
    const next: NotificationConfig = {
      ...config,
      enabled_channels: isEnabled
        ? config.enabled_channels.filter((c) => c !== channel.id)
        : [...config.enabled_channels, channel.id],
    }
    onConfigChange(next)
    try {
      await api.put('/me/notifications', next)
    } catch {
      // revert on error
      onConfigChange(config)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFeedback(null)
    const next: NotificationConfig = { ...config, [channel.id]: localFields }
    try {
      await api.put('/me/notifications', next)
      onConfigChange(next)
      setFeedback({ ok: true, msg: t('common.success') })
    } catch (err: any) {
      setFeedback({ ok: false, msg: err.message || t('common.error') })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setFeedback(null)
    try {
      await api.post('/me/notifications/test', { channel: channel.id })
      setFeedback({ ok: true, msg: t('common.success') })
    } catch (err: any) {
      setFeedback({ ok: false, msg: err.message || t('common.error') })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Toggle switch */}
          <button
            onClick={toggleEnabled}
            className={cn(
              'relative shrink-0 w-10 h-6 cursor-pointer rounded-full transition-colors',
              isEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
            )}
            role="switch"
            aria-checked={isEnabled}
          >
            <span
              className={cn(
                'pointer-events-none absolute top-1/2 -translate-y-1/2 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
                isEnabled ? 'translate-x-4' : 'translate-x-0'
              )}
            />
          </button>
          <span className="text-sm font-medium text-foreground">{channel.label}</span>
        </div>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-3">
          <form onSubmit={handleSave} className="space-y-3">
            {channel.fields.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-foreground mb-1">{field.label}</label>
                <FormField
                  def={field}
                  value={localFields[field.key] ?? ''}
                  onChange={(v) => setLocalFields((p) => ({ ...p, [field.key]: v }))}
                />
              </div>
            ))}

            {feedback && (
              <p
                className={cn(
                  'text-xs px-3 py-2 rounded-md',
                  feedback.ok
                    ? 'text-green-600 bg-green-50 dark:bg-green-900/20'
                    : 'text-destructive bg-destructive/10'
                )}
              >
                {feedback.msg}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="py-1.5 px-3 bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-secondary-foreground text-xs font-medium rounded-md transition-colors"
              >
                {testing ? t('common.loading') : t('common.test')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function NotificationsTab() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<NotificationHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.get<NotificationConfig>('/me/notifications')
      setConfig(data)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await api.get<NotificationHistory[]>('/me/notification-history?limit=50')
      setHistory(data)
    } catch {
      // ignore history errors
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchHistory()
  }, [fetchConfig, fetchHistory])

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  }
  if (error || !config) {
    return <p className="text-sm text-destructive">{error || t('common.error')}</p>
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('settings.notificationChannels')}</p>
        {CHANNELS.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            config={config}
            onConfigChange={setConfig}
          />
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('settings.notificationHistory')}</p>
        <div className="bg-card border rounded-lg overflow-hidden">
          {historyLoading ? (
            <p className="text-sm text-muted-foreground p-4">{t('common.loading')}</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">{t('settings.noHistory')}</p>
          ) : (
            <div className="divide-y">
              {history.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{h.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {h.item_name && <span className="mr-2">{h.item_name}</span>}
                      <span className="uppercase">{h.channel}</span>
                      {' · '}
                      {new Date(h.created_at).toLocaleString()}
                    </p>
                    {h.error && <p className="text-xs text-destructive mt-0.5 truncate">{h.error}</p>}
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${h.success ? 'text-green-600' : 'text-destructive'}`}>
                    {h.success ? t('settings.historySuccess') : t('settings.historyFailed')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preferences Tab
// ---------------------------------------------------------------------------

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  { value: 'America/Anchorage', label: 'Anchorage (AKST)' },
  { value: 'Pacific/Honolulu', label: 'Honolulu (HST)' },
  { value: 'America/Toronto', label: 'Toronto (EST/EDT)' },
  { value: 'America/Vancouver', label: 'Vancouver (PST/PDT)' },
  { value: 'America/Mexico_City', label: 'Mexico City (CST/CDT)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (ART)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
  { value: 'Europe/Rome', label: 'Rome (CET/CEST)' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/Stockholm', label: 'Stockholm (CET/CEST)' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
  { value: 'Europe/Istanbul', label: 'Istanbul (TRT)' },
  { value: 'Africa/Cairo', label: 'Cairo (EET)' },
  { value: 'Africa/Lagos', label: 'Lagos (WAT)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Karachi', label: 'Karachi (PKT)' },
  { value: 'Asia/Kolkata', label: 'Mumbai / Kolkata (IST)' },
  { value: 'Asia/Dhaka', label: 'Dhaka (BST)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Shanghai', label: '上海 / Shanghai (CST)' },
  { value: 'Asia/Hong_Kong', label: '香港 / Hong Kong (HKT)' },
  { value: 'Asia/Taipei', label: '台北 / Taipei (CST)' },
  { value: 'Asia/Tokyo', label: '東京 / Tokyo (JST)' },
  { value: 'Asia/Seoul', label: '서울 / Seoul (KST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
]

const CURRENCIES = ['USD', 'EUR', 'CNY', 'JPY', 'GBP', 'HKD', 'CAD', 'AUD', 'SGD', 'KRW']

function PreferencesTab() {
  const { t, i18n } = useTranslation()
  const { user, refreshUser } = useAuth()
  const { theme, setTheme } = useTheme()

  const [timezone, setTimezone] = useState(user?.timezone ?? 'UTC')
  const [baseCurrency, setBaseCurrency] = useState(user?.base_currency ?? 'USD')
  const [showLunar, setShowLunar] = useState(user?.show_lunar ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (user) {
      setTimezone(user.timezone ?? 'UTC')
      setBaseCurrency(user.base_currency ?? 'USD')
      setShowLunar(user.show_lunar ?? false)
    }
  }, [user])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setSaving(true)
    try {
      await api.put('/me', {
        timezone,
        base_currency: baseCurrency,
        language: i18n.language,
        theme,
        show_lunar: showLunar,
      })
      await refreshUser()
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Theme */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('settings.theme')}</h3>
        <div className="flex flex-wrap gap-2">
          {(['light', 'dark', 'system'] as const).map((t_) => (
            <label key={t_} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="theme"
                value={t_}
                checked={theme === t_}
                onChange={() => setTheme(t_)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">
                {t(`settings.theme${t_.charAt(0).toUpperCase() + t_.slice(1)}`)}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('settings.language')}</h3>
        <div className="flex gap-4">
          {[
            { code: 'en', label: 'English' },
            { code: 'zh', label: '中文' },
          ].map(({ code, label }) => (
            <label key={code} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="language"
                value={code}
                checked={i18n.language === code}
                onChange={() => i18n.changeLanguage(code)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Timezone */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('settings.timezone')}</h3>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className={inputCls}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </div>

      {/* Base currency */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('settings.baseCurrency')}</h3>
        <select
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value)}
          className={inputCls}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Show lunar */}
      <div className="bg-card border rounded-lg p-5">
        <label className="flex items-center justify-between cursor-pointer">
          <h3 className="text-sm font-semibold text-foreground">{t('settings.showLunar')}</h3>
          <button
            type="button"
            onClick={() => setShowLunar((p) => !p)}
            className={cn(
              'relative shrink-0 w-10 h-6 cursor-pointer rounded-full transition-colors',
              showLunar ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
            )}
            role="switch"
            aria-checked={showLunar}
          >
            <span
              className={cn(
                'pointer-events-none absolute top-1/2 -translate-y-1/2 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
                showLunar ? 'translate-x-4' : 'translate-x-0'
              )}
            />
          </button>
        </label>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}
      {success && (
        <p className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-md">
          {t('common.success')}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
      >
        {saving ? t('common.loading') : t('common.save')}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Main SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const validTabs: TabId[] = ['account', 'security', 'notifications', 'preferences']
  const rawTab = searchParams.get('tab') as TabId | null
  const activeTab: TabId = rawTab && validTabs.includes(rawTab) ? rawTab : 'account'

  const setTab = (tab: TabId) => {
    setSearchParams({ tab })
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'account', label: t('settings.account'), icon: <User className="w-4 h-4" /> },
    { id: 'security', label: t('settings.security'), icon: <Shield className="w-4 h-4" /> },
    { id: 'notifications', label: t('settings.notifications'), icon: <Bell className="w-4 h-4" /> },
    { id: 'preferences', label: t('settings.preferences'), icon: <Sliders className="w-4 h-4" /> },
  ]

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-foreground mb-6">{t('settings.title')}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground font-medium hover:text-foreground'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'account' && <AccountTab />}
      {activeTab === 'security' && <SecurityTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'preferences' && <PreferencesTab />}
    </div>
  )
}
