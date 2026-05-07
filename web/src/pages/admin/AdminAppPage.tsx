import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import type { SystemSettings } from '@/types'

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

export function AdminAppPage() {
  const { t } = useTranslation()
  const [appName, setAppName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    api
      .get<SystemSettings>('/admin/system/settings')
      .then((s) => setAppName(s.app_name || 'eNotify'))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaveMsg('')
    try {
      await api.put('/admin/system/settings', { app_name: appName.trim() || 'eNotify' })
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
