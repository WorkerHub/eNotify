import { useState, type ReactNode, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { formatLunarDate } from '@/lib/lunar'
import { ChannelSelector } from '@/components/ChannelSelector'

const CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'TWD', 'KRW', 'TRY']

interface FormData {
  name: string
  item_kind: 'regular' | 'subscription'
  item_mode: 'cycle' | 'reset'
  custom_type: string
  category: string
  start_date: string
  expiry_date: string
  period_value: string
  period_unit: 'day' | 'month' | 'year'
  reminder_value: string
  reminder_unit: 'day' | 'hour'
  amount: string
  currency: string
  auto_renew: boolean
  use_lunar: boolean
  notes: string
  channels: string[]
}

const DEFAULT: FormData = {
  name: '',
  item_kind: 'regular',
  item_mode: 'cycle',
  custom_type: '',
  category: '',
  start_date: '',
  expiry_date: '',
  period_value: '1',
  period_unit: 'month',
  reminder_value: '7',
  reminder_unit: 'day',
  amount: '',
  currency: 'CNY',
  auto_renew: true,
  use_lunar: false,
  notes: '',
  channels: [],
}

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT =
  'w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow'
const SELECT = cn(INPUT, 'cursor-pointer')

export function ItemNewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [form, setForm] = useState<FormData>({ ...DEFAULT, currency: user?.base_currency || 'CNY' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof FormData>(key: K, val: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (!form.expiry_date) return

    setSubmitting(true)
    setError('')
    try {
      await api.post('/items', {
        ...form,
        period_value: Number(form.period_value) || 1,
        reminder_value: Number(form.reminder_value) || 7,
        amount: form.item_kind === 'subscription' && form.amount ? Number(form.amount) : null,
        start_date: form.start_date || null,
        auto_renew: form.item_kind === 'subscription' && form.auto_renew ? 1 : 0,
        use_lunar: form.use_lunar ? 1 : 0,
        channels: form.channels,
      })
      navigate('/items')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/items')}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">{t('items.add')}</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Kind selector */}
        <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
          <button
            type="button"
            onClick={() => set('item_kind', 'regular')}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              form.item_kind === 'regular'
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('items.kindRegular')}
          </button>
          <button
            type="button"
            onClick={() => set('item_kind', 'subscription')}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              form.item_kind === 'subscription'
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('items.kindSubscription')}
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('items.name')} required>
            <input
              className={INPUT}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </Field>

          <Field label={t('items.mode.label')}>
            <select className={SELECT} value={form.item_mode} onChange={(e) => set('item_mode', e.target.value as FormData['item_mode'])}>
              <option value="cycle">{t('items.mode.cycle')}</option>
              <option value="reset">{t('items.mode.reset')}</option>
            </select>
          </Field>

          <Field label={t('items.type')}>
            <input
              className={INPUT}
              value={form.custom_type}
              onChange={(e) => set('custom_type', e.target.value)}
            />
          </Field>

          <Field label={t('items.category')}>
            <input
              className={INPUT}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
            />
          </Field>

          <Field label={t('items.startDate')}>
            <input
              type="date"
              className={INPUT}
              value={form.start_date}
              onChange={(e) => set('start_date', e.target.value)}
            />
            {form.use_lunar && form.start_date && (
              <p className="text-xs text-muted-foreground mt-1">{formatLunarDate(form.start_date)}</p>
            )}
          </Field>

          <Field label={t('items.expiryDate')} required>
            <input
              type="date"
              className={INPUT}
              value={form.expiry_date}
              onChange={(e) => set('expiry_date', e.target.value)}
              required
            />
            {form.use_lunar && form.expiry_date && (
              <p className="text-xs text-muted-foreground mt-1">{formatLunarDate(form.expiry_date)}</p>
            )}
          </Field>
        </div>

        {/* Period */}
        <Field label={t('items.period')}>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              className={cn(INPUT, 'w-24')}
              value={form.period_value}
              onChange={(e) => set('period_value', e.target.value)}
            />
            <select className={SELECT} value={form.period_unit} onChange={(e) => set('period_unit', e.target.value as FormData['period_unit'])}>
              <option value="day">{t('items.periodUnit.day')}</option>
              <option value="month">{t('items.periodUnit.month')}</option>
              <option value="year">{t('items.periodUnit.year')}</option>
            </select>
          </div>
        </Field>

        {/* Reminder */}
        <Field label={t('items.reminderBefore')}>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              className={cn(INPUT, 'w-24')}
              value={form.reminder_value}
              onChange={(e) => set('reminder_value', e.target.value)}
            />
            <select className={SELECT} value={form.reminder_unit} onChange={(e) => set('reminder_unit', e.target.value as FormData['reminder_unit'])}>
              <option value="day">{t('items.periodUnit.day')}</option>
              <option value="hour">{t('items.periodUnit.hour')}</option>
            </select>
          </div>
        </Field>

        {/* Amount + currency (subscription only) */}
        {form.item_kind === 'subscription' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('items.amount')}>
              <input
                type="number"
                min={0}
                step="0.01"
                className={INPUT}
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
            </Field>

            <Field label={t('items.currency')}>
              <select className={SELECT} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {/* Toggles */}
        <div className="flex gap-6 flex-wrap">
          {form.item_kind === 'subscription' && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={form.auto_renew}
                onClick={() => set('auto_renew', !form.auto_renew)}
                className={cn(
                  'relative w-10 h-6 rounded-full transition-colors',
                  form.auto_renew ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
                )}
              >
                <span
                  className={cn(
                    'absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    form.auto_renew && 'translate-x-4',
                  )}
                />
              </button>
              <span className="text-sm font-medium">{t('items.autoRenew')}</span>
            </label>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={form.use_lunar}
              onClick={() => set('use_lunar', !form.use_lunar)}
              className={cn(
                'relative w-10 h-6 rounded-full transition-colors',
                form.use_lunar ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
              )}
            >
              <span
                className={cn(
                  'absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  form.use_lunar && 'translate-x-4',
                )}
              />
            </button>
            <span className="text-sm font-medium">{t('items.useLunar')}</span>
          </label>
        </div>

        {/* Notes */}
        <Field label={t('items.notes')}>
          <textarea
            rows={3}
            className={cn(INPUT, 'resize-none')}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>

        {/* Channel selector */}
        <ChannelSelector
          selected={form.channels}
          onChange={(channels) => set('channels', channels)}
        />

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? t('common.loading') : t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/items')}
            className="px-6 py-2 rounded-lg text-sm font-medium border hover:bg-accent transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}
