import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { SystemSettings } from '@/types'
import { useAuth } from '@/hooks/useAuth'

type EmailProvider = 'none' | 'smtp' | 'resend'

interface SmtpConfig {
  host: string
  port: string
  username: string
  password: string
  from: string
  from_name: string
}

interface ResendConfig {
  api_key: string
  from: string
  from_name: string
}

const INPUT =
  'w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5', checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600')}
      >
        <span
          className={cn(
            'absolute top-1/2 -translate-y-1/2 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </div>
  )
}

const DEFAULT_SMTP: SmtpConfig = { host: '', port: '587', username: '', password: '', from: '', from_name: '' }
const DEFAULT_RESEND: ResendConfig = { api_key: '', from: '', from_name: '' }

export function AdminSystemPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [appName, setAppName] = useState('')
  const [emailProvider, setEmailProvider] = useState<EmailProvider>('none')
  const [smtp, setSmtp] = useState<SmtpConfig>(DEFAULT_SMTP)
  const [resend, setResend] = useState<ResendConfig>(DEFAULT_RESEND)
  const [emailVerification, setEmailVerification] = useState(false)
  const [require2fa, setRequire2fa] = useState(false)
  const [registration, setRegistration] = useState(true)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')

  const [testEmailTo, setTestEmailTo] = useState('')
  const [testEmailLoading, setTestEmailLoading] = useState(false)
  const [testEmailMsg, setTestEmailMsg] = useState('')
  const [testEmailError, setTestEmailError] = useState('')

  useEffect(() => {
    if (user?.email) setTestEmailTo(user.email)
  }, [user?.email])

  useEffect(() => {
    api
      .get<SystemSettings>('/admin/system/settings')
      .then((s) => {
        setAppName(s.app_name || 'eNotify')
        setEmailProvider((s.email_provider as EmailProvider) || 'none')
        setEmailVerification(s.email_verification_enabled === 'true')
        setRequire2fa(s.require_2fa === 'true')
        setRegistration(s.registration_enabled !== 'false')

        if (s.smtp_config) {
          try {
            const parsed = JSON.parse(s.smtp_config)
            const hasPassword = parsed.password && parsed.password !== ''
            setSmtp({ ...DEFAULT_SMTP, ...parsed, password: '', _hasExisting: hasPassword } as any)
          } catch {
            // ignore
          }
        }
        if (s.resend_config) {
          try {
            const parsed = JSON.parse(s.resend_config)
            const hasKey = parsed.api_key && parsed.api_key !== ''
            setResend({ ...DEFAULT_RESEND, ...parsed, api_key: '', _hasExisting: hasKey } as any)
          } catch {
            // ignore
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const setSmtpField = (key: keyof SmtpConfig, val: string) =>
    setSmtp((prev) => ({ ...prev, [key]: val }))

  const setResendField = (key: keyof ResendConfig, val: string) =>
    setResend((prev) => ({ ...prev, [key]: val }))

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaveMsg('')

    const payload: Record<string, string> = {
      app_name: appName.trim() || 'eNotify',
      email_provider: emailProvider,
      email_verification_enabled: String(emailVerification),
      require_2fa: String(require2fa),
      registration_enabled: String(registration),
    }

    if (emailProvider === 'smtp') {
      const smtpPayload: Record<string, any> = { ...smtp, port: Number(smtp.port) || 587 }
      delete smtpPayload._hasExisting
      if (!smtpPayload.password) delete smtpPayload.password
      payload.smtp_config = JSON.stringify(smtpPayload)
    }
    if (emailProvider === 'resend') {
      const resendPayload: Record<string, any> = { ...resend }
      delete resendPayload._hasExisting
      if (!resendPayload.api_key) delete resendPayload.api_key
      payload.resend_config = JSON.stringify(resendPayload)
    }

    try {
      await api.put('/admin/system/settings', payload)
      setSaveMsg(t('common.success'))
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleTestEmail = async () => {
    setTestEmailLoading(true)
    setTestEmailMsg('')
    setTestEmailError('')
    try {
      await api.post('/admin/system/settings/test-email', { to: testEmailTo })
      setTestEmailMsg(t('admin.testEmailSent'))
      setTimeout(() => setTestEmailMsg(''), 4000)
    } catch (e: any) {
      setTestEmailError(e.message || t('admin.testEmailFailed'))
    } finally {
      setTestEmailLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse max-w-xl">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-40 bg-muted rounded-xl" />
        <div className="h-40 bg-muted rounded-xl" />
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">{t('admin.system')}</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* App settings */}
        <section className="bg-card rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold">{t('admin.appSettings')}</h2>
          <Field label={t('admin.appName')}>
            <input
              className={INPUT}
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="eNotify"
              maxLength={64}
            />
          </Field>
        </section>

        {/* Email provider */}
        <section className="bg-card rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold">{t('admin.emailProvider')}</h2>

          <div className="flex gap-4">
            {(['none', 'smtp', 'resend'] as EmailProvider[]).map((p) => (
              <label key={p} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="email_provider"
                  value={p}
                  checked={emailProvider === p}
                  onChange={() => setEmailProvider(p)}
                  className="accent-primary"
                />
                <span className="text-sm font-medium capitalize">
                  {p === 'none' ? t('common.none') : p === 'smtp' ? t('admin.smtp') : t('admin.resend')}
                </span>
              </label>
            ))}
          </div>

          {emailProvider === 'smtp' && (
            <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t">
              <Field label={t('admin.smtpHost')}>
                <input className={INPUT} value={smtp.host} onChange={(e) => setSmtpField('host', e.target.value)} placeholder="smtp.example.com" />
              </Field>
              <Field label={t('admin.smtpPort')}>
                <input className={INPUT} type="number" value={smtp.port} onChange={(e) => setSmtpField('port', e.target.value)} />
              </Field>
              <Field label={t('admin.smtpUsername')}>
                <input className={INPUT} value={smtp.username} onChange={(e) => setSmtpField('username', e.target.value)} />
              </Field>
              <Field label={t('admin.smtpPassword')}>
                <input className={INPUT} type="password" value={smtp.password} onChange={(e) => setSmtpField('password', e.target.value)} placeholder="Leave blank to keep existing" />
              </Field>
              <Field label={t('admin.smtpFrom')}>
                <input className={INPUT} type="email" value={smtp.from} onChange={(e) => setSmtpField('from', e.target.value)} />
              </Field>
              <Field label={t('admin.smtpFromName')}>
                <input className={INPUT} value={smtp.from_name} onChange={(e) => setSmtpField('from_name', e.target.value)} />
              </Field>
            </div>
          )}

          {emailProvider === 'resend' && (
            <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t">
              <div className="sm:col-span-2">
                <Field label={t('admin.resendApiKey')}>
                  <input className={INPUT} type="password" value={resend.api_key} onChange={(e) => setResendField('api_key', e.target.value)} placeholder="Leave blank to keep existing" />
                </Field>
              </div>
              <Field label={t('admin.smtpFrom')}>
                <input className={INPUT} type="email" value={resend.from} onChange={(e) => setResendField('from', e.target.value)} />
              </Field>
              <Field label={t('admin.smtpFromName')}>
                <input className={INPUT} value={resend.from_name} onChange={(e) => setResendField('from_name', e.target.value)} />
              </Field>
            </div>
          )}
        </section>

        {/* Test email */}
        {emailProvider !== 'none' && (
          <section className="bg-card rounded-xl border p-5 space-y-4">
            <h2 className="font-semibold">{t('admin.testEmail')}</h2>
            <Field label={t('admin.testEmailAddress')}>
              <input
                className={INPUT}
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={testEmailLoading || !testEmailTo}
                onClick={handleTestEmail}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {testEmailLoading ? t('common.loading') : t('admin.testEmail')}
              </button>
              {testEmailMsg && <span className="text-sm text-green-600">{testEmailMsg}</span>}
              {testEmailError && <span className="text-sm text-destructive">{testEmailError}</span>}
            </div>
          </section>
        )}

        {/* Toggles */}
        <section className="bg-card rounded-xl border p-5 space-y-5">
          <h2 className="font-semibold">{t('admin.accessSecurity')}</h2>

          <Toggle
            checked={emailVerification}
            onChange={setEmailVerification}
            label={t('admin.emailVerification')}
            description={t('admin.emailVerificationDesc')}
          />

          <div className="border-t pt-4">
            <Toggle
              checked={require2fa}
              onChange={setRequire2fa}
              label={t('admin.require2fa')}
              description={t('admin.require2faDesc')}
            />
          </div>

          <div className="border-t pt-4">
            <Toggle
              checked={registration}
              onChange={setRegistration}
              label={t('admin.registration')}
              description={t('admin.registrationDesc')}
            />
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
          {saveMsg && <span className="text-sm text-green-600">{saveMsg}</span>}
        </div>
      </form>
    </div>
  )
}
