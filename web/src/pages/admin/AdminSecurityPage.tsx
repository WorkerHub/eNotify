import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { SystemSettings } from '@/types'

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
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
            'absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </div>
  )
}

export function AdminSecurityPage() {
  const { t } = useTranslation()
  const [emailVerification, setEmailVerification] = useState(false)
  const [require2fa, setRequire2fa] = useState(false)
  const [registration, setRegistration] = useState(true)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    api
      .get<SystemSettings>('/admin/system/settings')
      .then((s) => {
        setEmailVerification(s.email_verification_enabled === 'true')
        setRequire2fa(s.require_2fa === 'true')
        setRegistration(s.registration_enabled !== 'false')
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaveMsg('')
    try {
      await api.put('/admin/system/settings', {
        email_verification_enabled: String(emailVerification),
        require_2fa: String(require2fa),
        registration_enabled: String(registration),
      })
      setSaveMsg(t('common.success'))
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse max-w-xl">
        <div className="h-40 bg-muted rounded-xl" />
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-6">
      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
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
