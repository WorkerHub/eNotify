import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, AlertCircle, Bell, Trash2, Pencil, Check, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Subscription, Payment } from '@/types'
import { formatLunarDate } from '@/lib/lunar'

const CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'TWD', 'KRW', 'TRY']

const INPUT =
  'w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow'
const SELECT = cn(INPUT, 'cursor-pointer')

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative w-10 h-6 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted')}
      >
        <span
          className={cn(
            'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <span className="text-sm font-medium">{label}</span>
    </label>
  )
}

interface EditPaymentState {
  id: string
  date: string
  amount: string
  note: string
}

export function SubscriptionDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [sub, setSub] = useState<Subscription | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Renew form
  const [renewAmount, setRenewAmount] = useState('')
  const [renewDate, setRenewDate] = useState('')
  const [renewMultiplier, setRenewMultiplier] = useState('1')
  const [renewNote, setRenewNote] = useState('')
  const [renewing, setRenewing] = useState(false)

  // Test notify
  const [notifying, setNotifying] = useState(false)
  const [notifyMsg, setNotifyMsg] = useState('')
  const [notifyError, setNotifyError] = useState(false)

  // Inline payment edit
  const [editingPayment, setEditingPayment] = useState<EditPaymentState | null>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.get<Subscription>(`/subscriptions/${id}`),
      api.get<Payment[]>(`/subscriptions/${id}/payments`),
    ])
      .then(([s, p]) => {
        setSub(s)
        setPayments(p)
        setRenewAmount(String(s.amount ?? ''))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!sub) return
    setSaving(true)
    setSaveMsg('')
    try {
      await api.put(`/subscriptions/${id}`, {
        name: sub.name,
        subscription_mode: sub.subscription_mode,
        custom_type: sub.custom_type,
        category: sub.category,
        start_date: sub.start_date,
        expiry_date: sub.expiry_date,
        period_value: sub.period_value,
        period_unit: sub.period_unit,
        reminder_unit: sub.reminder_unit,
        reminder_value: sub.reminder_value,
        notes: sub.notes,
        amount: sub.amount,
        currency: sub.currency,
        is_active: sub.is_active ? 1 : 0,
        auto_renew: sub.auto_renew ? 1 : 0,
        use_lunar: sub.use_lunar ? 1 : 0,
      })
      setSaveMsg(t('common.success'))
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(t('common.confirmDelete', { name: sub?.name }))) return
    try {
      await api.delete(`/subscriptions/${id}`)
      navigate('/subscriptions')
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleRenew = async (e: FormEvent) => {
    e.preventDefault()
    setRenewing(true)
    try {
      const res = await api.post<{ new_expiry_date: string }>(`/subscriptions/${id}/renew`, {
        amount: renewAmount ? Number(renewAmount) : undefined,
        date: renewDate || undefined,
        multiplier: Number(renewMultiplier) || 1,
        note: renewNote || undefined,
      })
      setSub((prev) => prev ? { ...prev, expiry_date: res.new_expiry_date } : prev)
      const updated = await api.get<Payment[]>(`/subscriptions/${id}/payments`)
      setPayments(updated)
      setRenewNote('')
      setRenewDate('')
      setRenewMultiplier('1')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRenewing(false)
    }
  }

  const handleTestNotify = async () => {
    setNotifying(true)
    setNotifyMsg('')
    setNotifyError(false)
    try {
      await api.post(`/subscriptions/${id}/test-notify`)
      setNotifyMsg(t('common.notificationSent'))
      setTimeout(() => setNotifyMsg(''), 3000)
    } catch (e: any) {
      setNotifyMsg(e.message)
      setNotifyError(true)
    } finally {
      setNotifying(false)
    }
  }

  const handleSavePayment = async () => {
    if (!editingPayment) return
    try {
      await api.put(`/subscriptions/${id}/payments/${editingPayment.id}`, {
        date: editingPayment.date,
        amount: Number(editingPayment.amount),
        note: editingPayment.note,
      })
      setPayments((prev) =>
        prev.map((p) =>
          p.id === editingPayment.id
            ? { ...p, date: editingPayment.date, amount: Number(editingPayment.amount), note: editingPayment.note }
            : p,
        ),
      )
      setEditingPayment(null)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDeletePayment = async (pid: string) => {
    if (!window.confirm(t('common.confirmDeletePayment'))) return
    try {
      await api.delete(`/subscriptions/${id}/payments/${pid}`)
      setPayments((prev) => prev.filter((p) => p.id !== pid))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const setField = <K extends keyof Subscription>(key: K, val: Subscription[K]) =>
    setSub((prev) => prev ? { ...prev, [key]: val } : prev)

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    )
  }

  if (!sub) {
    return (
      <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {error || t('subscriptions.notFound')}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/subscriptions')} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold truncate">{sub.name}</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Edit form */}
      <section className="bg-card rounded-xl border p-5 space-y-5">
        <h2 className="font-semibold text-base">{t('common.edit')}</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('subscriptions.name')}>
              <input className={INPUT} value={sub.name} onChange={(e) => setField('name', e.target.value)} required />
            </Field>

            <Field label={t('subscriptions.mode.label')}>
              <select
                className={SELECT}
                value={sub.subscription_mode}
                onChange={(e) => setField('subscription_mode', e.target.value as any)}
              >
                <option value="cycle">{t('subscriptions.mode.cycle')}</option>
                <option value="reset">{t('subscriptions.mode.reset')}</option>
              </select>
            </Field>

            <Field label={t('subscriptions.type')}>
              <input className={INPUT} value={sub.custom_type} onChange={(e) => setField('custom_type', e.target.value)} />
            </Field>

            <Field label={t('subscriptions.category')}>
              <input className={INPUT} value={sub.category} onChange={(e) => setField('category', e.target.value)} />
            </Field>

            <Field label={t('subscriptions.startDate')}>
              <input
                type="date"
                className={INPUT}
                value={sub.start_date ?? ''}
                onChange={(e) => setField('start_date', e.target.value || null)}
              />
              {!!sub.use_lunar && sub.start_date && (
                <p className="text-xs text-muted-foreground mt-1">{formatLunarDate(sub.start_date)}</p>
              )}
            </Field>

            <Field label={t('subscriptions.expiryDate')}>
              <input
                type="date"
                className={INPUT}
                value={sub.expiry_date}
                onChange={(e) => setField('expiry_date', e.target.value)}
                required
              />
              {!!sub.use_lunar && sub.expiry_date && (
                <p className="text-xs text-muted-foreground mt-1">{formatLunarDate(sub.expiry_date)}</p>
              )}
            </Field>
          </div>

          <Field label={t('subscriptions.period')}>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                className={cn(INPUT, 'w-24')}
                value={sub.period_value}
                onChange={(e) => setField('period_value', Number(e.target.value))}
              />
              <select
                className={SELECT}
                value={sub.period_unit}
                onChange={(e) => setField('period_unit', e.target.value as any)}
              >
                <option value="day">{t('subscriptions.periodUnit.day')}</option>
                <option value="month">{t('subscriptions.periodUnit.month')}</option>
                <option value="year">{t('subscriptions.periodUnit.year')}</option>
              </select>
            </div>
          </Field>

          <Field label={t('subscriptions.reminderBefore')}>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                className={cn(INPUT, 'w-24')}
                value={sub.reminder_value}
                onChange={(e) => setField('reminder_value', Number(e.target.value))}
              />
              <select
                className={SELECT}
                value={sub.reminder_unit}
                onChange={(e) => setField('reminder_unit', e.target.value as any)}
              >
                <option value="day">{t('subscriptions.periodUnit.day')}</option>
                <option value="hour">{t('subscriptions.periodUnit.hour')}</option>
              </select>
            </div>
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('subscriptions.amount')}>
              <input
                type="number"
                min={0}
                step="0.01"
                className={INPUT}
                value={sub.amount ?? ''}
                onChange={(e) => setField('amount', e.target.value ? Number(e.target.value) : null)}
              />
            </Field>

            <Field label={t('subscriptions.currency')}>
              <select className={SELECT} value={sub.currency} onChange={(e) => setField('currency', e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex gap-6 flex-wrap">
            <Toggle
              checked={!!sub.auto_renew}
              onChange={(v) => setField('auto_renew', v ? 1 : 0)}
              label={t('subscriptions.autoRenew')}
            />
            <Toggle
              checked={!!sub.use_lunar}
              onChange={(v) => setField('use_lunar', v ? 1 : 0)}
              label={t('subscriptions.useLunar')}
            />
          </div>

          <Field label={t('subscriptions.notes')}>
            <textarea
              rows={3}
              className={cn(INPUT, 'resize-none')}
              value={sub.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
            {saveMsg && <span className="text-sm text-green-600">{saveMsg}</span>}
          </div>
        </form>
      </section>

      {/* Actions: Test notify + Delete */}
      <section className="flex flex-wrap gap-3">
        <button
          onClick={handleTestNotify}
          disabled={notifying}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <Bell className="w-4 h-4" />
          {t('subscriptions.testNotify')}
        </button>
        {notifyMsg && <span className={cn('text-sm self-center', notifyError ? 'text-destructive' : 'text-green-600')}>{notifyMsg}</span>}
        <button
          onClick={handleDelete}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors ml-auto"
        >
          <Trash2 className="w-4 h-4" />
          {t('common.delete')}
        </button>
      </section>

      {/* Renew */}
      <section className="bg-card rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold text-base">{t('subscriptions.renew')}</h2>
        <form onSubmit={handleRenew} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('subscriptions.amount')}>
              <input
                type="number"
                min={0}
                step="0.01"
                className={INPUT}
                value={renewAmount}
                onChange={(e) => setRenewAmount(e.target.value)}
              />
            </Field>

            <Field label={t('common.date')}>
              <input
                type="date"
                className={INPUT}
                value={renewDate}
                onChange={(e) => setRenewDate(e.target.value)}
              />
            </Field>

            <Field label={t('subscriptions.renewMultiplier')}>
              <input
                type="number"
                min={1}
                className={INPUT}
                value={renewMultiplier}
                onChange={(e) => setRenewMultiplier(e.target.value)}
              />
            </Field>

            <Field label={t('common.note')}>
              <input className={INPUT} value={renewNote} onChange={(e) => setRenewNote(e.target.value)} />
            </Field>
          </div>

          <button
            type="submit"
            disabled={renewing}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {renewing ? t('common.loading') : t('subscriptions.renew')}
          </button>
        </form>
      </section>

      {/* Payment history */}
      <section className="bg-card rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold text-base">{t('subscriptions.paymentHistory')}</h2>

        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block rounded-lg border overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    {[t('common.date'), t('subscriptions.amount'), t('subscriptions.type'), t('common.note'), t('common.period'), t('common.actions')].map((h) => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((p) =>
                    editingPayment?.id === p.id ? (
                      <tr key={p.id} className="bg-muted/20">
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            className={cn(INPUT, 'py-1')}
                            value={editingPayment.date}
                            onChange={(e) => setEditingPayment({ ...editingPayment, date: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            className={cn(INPUT, 'py-1 w-24')}
                            value={editingPayment.amount}
                            onChange={(e) => setEditingPayment({ ...editingPayment, amount: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{t(`subscriptions.paymentType.${p.type}`)}</td>
                        <td className="px-3 py-2">
                          <input
                            className={cn(INPUT, 'py-1')}
                            value={editingPayment.note}
                            onChange={(e) => setEditingPayment({ ...editingPayment, note: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {p.period_start && p.period_end ? `${p.period_start} → ${p.period_end}` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button onClick={handleSavePayment} className="p-1 rounded hover:bg-accent text-green-600">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditingPayment(null)} className="p-1 rounded hover:bg-accent">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2">{p.date.slice(0, 10)}</td>
                        <td className="px-3 py-2 font-medium tabular-nums">
                          {p.currency} {p.amount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{t(`subscriptions.paymentType.${p.type}`)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{p.note || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {p.period_start && p.period_end ? `${p.period_start} → ${p.period_end}` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              onClick={() =>
                                setEditingPayment({
                                  id: p.id,
                                  date: p.date.slice(0, 10),
                                  amount: String(p.amount),
                                  note: p.note,
                                })
                              }
                              className="p-1 rounded hover:bg-accent"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeletePayment(p.id)}
                              className="p-1 rounded hover:bg-accent text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-2">
              {payments.map((p) =>
                editingPayment?.id === p.id ? (
                  <div key={p.id} className="rounded-lg border border-primary/30 p-3 text-sm space-y-2 bg-muted/20">
                    <div className="space-y-2">
                      <input type="date" className={cn(INPUT, 'py-1.5 w-full')} value={editingPayment.date} onChange={(e) => setEditingPayment({ ...editingPayment, date: e.target.value })} />
                      <input type="number" step="0.01" className={cn(INPUT, 'py-1.5 w-full')} value={editingPayment.amount} onChange={(e) => setEditingPayment({ ...editingPayment, amount: e.target.value })} placeholder={t('subscriptions.amount')} />
                      <input className={cn(INPUT, 'py-1.5 w-full')} value={editingPayment.note} onChange={(e) => setEditingPayment({ ...editingPayment, note: e.target.value })} placeholder={t('common.note')} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleSavePayment} className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground">{t('common.save')}</button>
                      <button onClick={() => setEditingPayment(null)} className="text-xs px-3 py-1.5 rounded bg-accent">{t('common.cancel')}</button>
                    </div>
                  </div>
                ) : (
                <div key={p.id} className="rounded-lg border p-3 text-sm space-y-1">
                  <div className="flex justify-between font-medium">
                    <span>{p.date.slice(0, 10)}</span>
                    <span className="tabular-nums">{p.currency} {p.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground text-xs">
                    <span>{t(`subscriptions.paymentType.${p.type}`)}{p.note ? ` · ${p.note}` : ''}</span>
                    {p.period_start && p.period_end && (
                      <span>{p.period_start} → {p.period_end}</span>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() =>
                        setEditingPayment({ id: p.id, date: p.date.slice(0, 10), amount: String(p.amount), note: p.note })
                      }
                      className="text-xs px-2 py-1 rounded bg-accent hover:bg-accent/70"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => handleDeletePayment(p.id)}
                      className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
                ),
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
