import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Plus, Eye, Trash2, ToggleLeft, ToggleRight, AlertCircle, CreditCard } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Subscription } from '@/types'
import { formatLunarDate } from '@/lib/lunar'

type StatusKey = 'active' | 'expiringSoon' | 'expired' | 'inactive'

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getStatus(sub: Subscription): StatusKey {
  if (!sub.is_active) return 'inactive'
  const today = localToday()
  if (sub.expiry_date < today) return 'expired'
  const diff = Math.ceil((new Date(sub.expiry_date).getTime() - new Date(today).getTime()) / 86400000)
  if (diff <= 7) return 'expiringSoon'
  return 'active'
}

function getDaysRemaining(expiry: string): number {
  const today = localToday()
  return Math.ceil((new Date(expiry).getTime() - new Date(today).getTime()) / 86400000)
}

const STATUS_STYLES: Record<StatusKey, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  expiringSoon: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

function DaysBadge({ days }: { days: number }) {
  const cls =
    days < 0
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      : days <= 7
        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', cls)}>
      {days < 0 ? `-${Math.abs(days)}d` : `${days}d`}
    </span>
  )
}

export function SubscriptionListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadSubs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<Subscription[]>('/subscriptions')
      setSubs(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSubs()
  }, [loadSubs])

  const handleToggle = async (sub: Subscription) => {
    try {
      const res = await api.post<{ success: boolean; is_active: number }>(`/subscriptions/${sub.id}/toggle-status`)
      setSubs((prev) => prev.map((s) => s.id === sub.id ? { ...s, is_active: res.is_active } : s))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDelete = async (sub: Subscription) => {
    if (!window.confirm(t('common.confirmDelete', { name: sub.name }))) return
    try {
      await api.delete(`/subscriptions/${sub.id}`)
      setSubs((prev) => prev.filter((s) => s.id !== sub.id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('subscriptions.title')}</h1>
        <button
          onClick={() => navigate('/subscriptions/new')}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('subscriptions.add')}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{t('dashboard.noData')}</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[
                    t('subscriptions.name'),
                    t('subscriptions.type'),
                    t('subscriptions.category'),
                    t('subscriptions.expiryDate'),
                    t('common.status'),
                    t('subscriptions.amount'),
                    t('common.actions'),
                  ].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {subs.map((sub) => {
                  const status = getStatus(sub)
                  const days = getDaysRemaining(sub.expiry_date)
                  return (
                    <tr key={sub.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{sub.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{sub.custom_type || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{sub.category || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div>
                            <span>{sub.expiry_date}</span>
                            {!!sub.use_lunar && (
                              <span className="text-xs text-muted-foreground block">{formatLunarDate(sub.expiry_date)}</span>
                            )}
                          </div>
                          <DaysBadge days={days} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[status])}>
                          {t(`subscriptions.status.${status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums whitespace-nowrap">
                        {sub.amount != null ? `${sub.currency} ${sub.amount.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => navigate(`/subscriptions/${sub.id}`)}
                            className="p-1.5 rounded hover:bg-accent transition-colors"
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggle(sub)}
                            className="p-1.5 rounded hover:bg-accent transition-colors"
                            title={sub.is_active ? t('admin.deactivate') : t('admin.activate')}
                            aria-label={sub.is_active ? t('admin.deactivate') : t('admin.activate')}
                          >
                            {sub.is_active ? (
                              <ToggleRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(sub)}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-destructive"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {subs.map((sub) => {
              const status = getStatus(sub)
              const days = getDaysRemaining(sub.expiry_date)
              return (
                <div key={sub.id} className="bg-card rounded-xl border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{sub.name}</p>
                      {(sub.custom_type || sub.category) && (
                        <p className="text-xs text-muted-foreground">
                          {[sub.custom_type, sub.category].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', STATUS_STYLES[status])}>
                      {t(`subscriptions.status.${status}`)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="text-muted-foreground">{sub.expiry_date}</span>
                        {sub.use_lunar && (
                          <span className="text-xs text-muted-foreground block">{formatLunarDate(sub.expiry_date)}</span>
                        )}
                      </div>
                      <DaysBadge days={days} />
                    </div>
                    {sub.amount != null && (
                      <span className="font-medium tabular-nums">
                        {sub.currency} {sub.amount.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t">
                    <button
                      onClick={() => navigate(`/subscriptions/${sub.id}`)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      <Eye className="w-3 h-3" />
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => handleToggle(sub)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      {sub.is_active ? (
                        <ToggleRight className="w-3 h-3 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-3 h-3" />
                      )}
                      {sub.is_active ? t('admin.deactivate') : t('admin.activate')}
                    </button>
                    <button
                      onClick={() => handleDelete(sub)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors ml-auto"
                    >
                      <Trash2 className="w-3 h-3" />
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

