import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Clock, Radio } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { NotificationHoursSelector } from '@/components/NotificationHoursSelector'
import type { NotificationConfig } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    fields: [
      { key: 'webhook', label: 'Webhook URL', type: 'text', placeholder: 'https://' },
      { key: 'msg_type', label: 'Message Type', type: 'select', options: ['markdown', 'text'] },
      { key: 'at_all', label: 'At All', type: 'select', options: ['false', 'true'] },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    fields: [{ key: 'to', label: 'To Address', type: 'text', placeholder: '<EMAIL_ADDRESS>' }],
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

// ---------------------------------------------------------------------------
// ChannelCard
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
  // API returns channel config under `${channel.id}_config` key
  const configKey = `${channel.id}_config` as keyof NotificationConfig
  const channelConfig = (config[configKey] as Record<string, string>) ?? {}

  const [expanded, setExpanded] = useState(false)
  const [localFields, setLocalFields] = useState<Record<string, string>>(channelConfig)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // Sync if parent config changes (only from server, not local edits)
  const configJson = JSON.stringify((config[configKey] as Record<string, string>) ?? {})
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
    try {
      await api.put('/me/notifications', { enabled_channels: next.enabled_channels })
      onConfigChange(next)
    } catch {
      // no state change on error
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFeedback(null)
    try {
      await api.put('/me/notifications', { [configKey]: localFields })
      const next: NotificationConfig = { ...config, [configKey]: localFields }
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
                'pointer-events-none absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
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

// ---------------------------------------------------------------------------
// NotificationHoursTab
// ---------------------------------------------------------------------------

type ChannelTabId = 'hours' | 'channels'

function NotificationHoursTab({
  config,
  onConfigChange,
}: {
  config: NotificationConfig
  onConfigChange: (updated: NotificationConfig) => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [localHours, setLocalHours] = useState<number[]>(config.notification_hours ?? [])
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    setLocalHours(config.notification_hours ?? [])
  }, [config.notification_hours])

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      await api.put('/me/notifications', { notification_hours: localHours })
      onConfigChange({ ...config, notification_hours: localHours })
      setFeedback({ ok: true, msg: t('common.success') })
    } catch (err: any) {
      setFeedback({ ok: false, msg: err.message || t('common.error') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg p-5 space-y-4">
        <p className="text-xs text-muted-foreground">{t('channels.notificationHoursHint')}</p>

        <NotificationHoursSelector
          selected={localHours}
          onChange={setLocalHours}
          showTimezone={true}
        />

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

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChannelsTab
// ---------------------------------------------------------------------------

function ChannelsTab({
  config,
  onConfigChange,
}: {
  config: NotificationConfig
  onConfigChange: (updated: NotificationConfig) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('channels.description')}</p>
      {CHANNELS.map((ch) => (
        <ChannelCard
          key={ch.id}
          channel={ch}
          config={config}
          onConfigChange={onConfigChange}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChannelPage
// ---------------------------------------------------------------------------

export function ChannelPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<ChannelTabId>('hours')

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

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  }
  if (error || !config) {
    return <p className="text-sm text-destructive">{error || t('common.error')}</p>
  }

  const tabs: { id: ChannelTabId; label: string; icon: React.ReactNode }[] = [
    { id: 'hours', label: t('channels.notificationHours'), icon: <Clock className="w-4 h-4" /> },
    { id: 'channels', label: t('channels.title'), icon: <Radio className="w-4 h-4" /> },
  ]

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-foreground mb-6">{t('channels.title')}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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
      {activeTab === 'hours' && <NotificationHoursTab config={config} onConfigChange={setConfig} />}
      {activeTab === 'channels' && <ChannelsTab config={config} onConfigChange={setConfig} />}
    </div>
  )
}
