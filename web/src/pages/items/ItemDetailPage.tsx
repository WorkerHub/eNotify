import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, AlertCircle, Bell, Trash2, Pencil, Check, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Item, Payment } from '@/types'
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
        className={cn('relative w-10 h-6 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600')}
      >
        <span
          className={cn(
            'absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
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

export function ItemDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [item, setItem] = useState<Item | null>(null)
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
      api.get<Item>(`/items/${id}`),
      api.get<Payment[]>(`/items/${id}/payments`),
    ])
      .then(([s, p]) => {
        setItem(s)
        setPayments(p)
        setRenewAmount(String(s.amount ?? ''))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!item) return
    setSaving(true)
    setSaveMsg('')
    try {
      await api.put(`/items/${id}`, {
        name: item.name,
        item_mode: item.item_mode,
        custom_type: item.custom_type,
        category: item.category,
        start_date: item.start_date,
        expiry_date: item.expiry_date,
        period_value: item.period_value,
        period_unit: item.period_unit,
        reminder_unit: item.reminder_unit,
        reminder_value: item.reminder_value,
        notes: item.notes,
        amount: item.amount,
        currency: item.currency,
        is_active: item.is_active ? 1 : 0,
        auto_renew: item.auto_renew ? 1 : 0,
        use_lunar: item.use_lunar ? 1 : 0,
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
    if (!window.confirm(t('common.confirmDelete', { name: item?.name }))) return
    try {
      await api.delete(`/items/${id}`)
      navigate('/items')
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleRenew = async (e: FormEvent) => {
    e.preventDefault()
    setRenewing(true)
    try {
      const res = await api.post<{ new_expiry_date: string }>(`/items/${id}/renew`, {
        amount: renewAmount ? Number(renewAmount) : undefined,
        date: renewDate || undefined,
        multiplier: Number(renewMultiplier) || 1,
        note: renewNote || undefined,
      })
      setItem((prev) => prev ? { ...prev, expiry_date: res.new_expiry_date } : prev)
      const updated = await api.get<Payment[]>(`/items/${id}/payments`)
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
      await api.post(`/items/${id}/test-notify`)
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
      await api.put(`/items/${id}/payments/${editingPayment.id}`, {
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
      await api.delete(`/items/${id}/payments/${pid}`)
      setPayments((prev) => prev.filter((p) => p.id !== pid))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const setField = <K extends keyof Item>(key: K, val: Item[K]) =>
    setItem((prev) => prev ? { ...prev, [key]: val } : prev)

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {error || t('items.notFound')}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/items')} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold truncate">{item.name}</h1>
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
            <Field label={t('items.name')}>
              <input className={INPUT} value={item.name} onChange={(e) => setField('name', e.target.value)} required />
            </Field>

            <Field label={t('items.mode.label')}>
              <select
                className={SELECT}
                value={item.item_mode}
                onChange={(e) => setField('item_mode', e.target.value as any)}
              >
                <option value="cycle">{t('items.mode.cycle')}</option>
                <option value="reset">{t('items.mode.reset')}</option>
              </select>
            </Field>

            <Field label={t('items.type')}>
              <input className={INPUT} value={item.custom_type} onChange={(e) => setField('custom_type', e.target.value)} />
            </Field>

            <Field label={t('items.category')}>
              <input className={INPUT} value={item.category} onChange={(e) => setField('category', e.target.value)} />
            </Field>

            <Field label={t('items.startDate')}>
              <input
                type="date"
                className={INPUT}
                value={item.start_date ?? ''}
                onChange={(e) => setField('start_date', e.target.value || null)}
              />
              {!!item.use_lunar && item.start_date && (
                <p className="text-xs text-muted-foreground mt-1">{formatLunarDate(item.start_date)}</p>
              )}
            </Field>

            <Field label={t('items.expiryDate')}>
              <input
                type="date"
                className={INPUT}
                value={item.expiry_date}
                onChange={(e) => setField('expiry_date', e.target.value)}
                required
              />
              {!!item.use_lunar && item.expiry_date && (
                <p className="text-xs text-muted-foreground mt-1">{formatLunarDate(item.expiry_date)}</p>
              )}
            </Field>
          </div>

          <Field label={t('items.period')}>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                className={cn(INPUT, 'w-24')}
                value={item.period_value}
                onChange={(e) => setField('period_value', Number(e.target.value))}
              />
              <select
                className={SELECT}
                value={item.period_unit}
                onChange={(e) => setField('period_unit', e.target.value as any)}
              >
                <option value="day">{t('items.periodUnit.day')}</option>
                <option value="month">{t('items.periodUnit.month')}</option>
                <option value="year">{t('items.periodUnit.year')}</option>
              </select>
            </div>
          </Field>

          <Field label={t('items.reminderBefore')}>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                className={cn(INPUT, 'w-24')}
                value={item.reminder_value}
                onChange={(e) => setField('reminder_value', Number(e.target.value))}
              />
              <select
                className={SELECT}
                value={item.reminder_unit}
                onChange={(e) => setField('reminder_unit', e.target.value as any)}
              >
                <option value="day">{t('items.periodUnit.day')}</option>
                <option value="hour">{t('items.periodUnit.hour')}</option>
              </select>
            </div>
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('items.amount')}>
              <input
                type="number"
                min={0}
                step="0.01"
                className={INPUT}
                value={item.amount ?? ''}
                onChange={(e) => setField('amount', e.target.value ? Number(e.target.value) : null)}
              />
            </Field>

            <Field label={t('items.currency')}>
              <select className={SELECT} value={item.currency} onChange={(e) => setField('currency', e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex gap-6 flex-wrap">
            <Toggle
              checked={!!item.is_active}
              onChange={(v) => setField('is_active', v ? 1 : 0)}
              label={t('items.enableItem')}
            />
            <Toggle
              checked={!!item.auto_renew}
              onChange={(v) => setField('auto_renew', v ? 1 : 0)}
              label={t('items.autoRenew')}
            />
            <Toggle
              checked={!!item.use_lunar}
              onChange={(v) => setField('use_lunar', v ? 1 : 0)}
              label={t('items.useLunar')}
            />
          </div>

          <Field label={t('items.notes')}>
            <textarea
              rows={3}
              className={cn(INPUT, 'resize-none')}
              value={item.notes}
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
          {t('items.testNotify')}
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
        <h2 className="font-semibold text-base">{t('items.renew')}</h2>
        <form onSubmit={handleRenew} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('items.amount')}>
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

            <Field label={t('items.renewMultiplier')}>
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
            {renewing ? t('common.loading') : t('items.renew')}
          </button>
        </form>
      </section>

      {/* Payment history */}
      <section className="bg-card rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold text-base">{t('items.paymentHistory')}</h2>

        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block rounded-lg border overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    {[t('common.date'), t('items.amount'), t('items.type'), t('common.note'), t('common.period'), t('common.actions')].map((h) => (
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
                        <td className="px-3 py-2 text-muted-foreground">{t(`items.paymentType.${p.type}`)}</td>
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
                        <td className="px-3 py-2 text-muted-foreground">{t(`items.paymentType.${p.type}`)}</td>
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
                      <input type="number" step="0.01" className={cn(INPUT, 'py-1.5 w-full')} value={editingPayment.amount} onChange={(e) => setEditingPayment({ ...editingPayment, amount: e.target.value })} placeholder={t('items.amount')} />
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
                    <span>{t(`items.paymentType.${p.type}`)}{p.note ? ` · ${p.note}` : ''}</span>
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
