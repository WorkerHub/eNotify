import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Plus, Eye, Trash2, ToggleLeft, ToggleRight, AlertCircle, CreditCard, Bell } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Item } from '@/types'
import { formatLunarDate } from '@/lib/lunar'

type StatusKey = 'active' | 'expiringSoon' | 'expired' | 'inactive'

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getStatus(item: Item): StatusKey {
  if (!item.is_active) return 'inactive'
  const today = localToday()
  if (item.expiry_date < today) return 'expired'
  const diff = Math.ceil((new Date(item.expiry_date).getTime() - new Date(today).getTime()) / 86400000)
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

export function ItemListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<Item[]>('/items')
      setItems(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const handleToggle = async (item: Item) => {
    try {
      const res = await api.post<{ success: boolean; is_active: number }>(`/items/${item.id}/toggle-status`)
      setItems((prev) => prev.map((s) => s.id === item.id ? { ...s, is_active: res.is_active } : s))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleTestNotify = async (item: Item) => {
    setTestingId(item.id)
    try {
      await api.post(`/items/${item.id}/test-notify`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = async (item: Item) => {
    if (!window.confirm(t('common.confirmDelete', { name: item.name }))) return
    try {
      await api.delete(`/items/${item.id}`)
      setItems((prev) => prev.filter((s) => s.id !== item.id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('items.title')}</h1>
        <button
          onClick={() => navigate('/items/new')}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('items.add')}
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
      ) : items.length === 0 ? (
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
                    t('items.name'),
                    t('items.type'),
                    t('items.category'),
                    t('items.expiryDate'),
                    t('common.status'),
                    t('items.amount'),
                    t('common.actions'),
                  ].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const status = getStatus(item)
                  const days = getDaysRemaining(item.expiry_date)
                  return (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{item.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.custom_type || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.category || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div>
                            <span>{item.expiry_date}</span>
                            {!!item.use_lunar && (
                              <span className="text-xs text-muted-foreground block">{formatLunarDate(item.expiry_date)}</span>
                            )}
                          </div>
                          <DaysBadge days={days} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[status])}>
                          {t(`items.status.${status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums whitespace-nowrap">
                        {item.item_kind === 'subscription' && item.amount != null
                          ? `${item.currency} ${item.amount.toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => navigate(`/items/${item.id}`)}
                            className="p-1.5 rounded hover:bg-accent transition-colors"
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggle(item)}
                            className="p-1.5 rounded hover:bg-accent transition-colors"
                            title={item.is_active ? t('admin.deactivate') : t('admin.activate')}
                            aria-label={item.is_active ? t('admin.deactivate') : t('admin.activate')}
                          >
                            {item.is_active ? (
                              <ToggleRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            onClick={() => handleTestNotify(item)}
                            disabled={testingId === item.id}
                            className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
                            title={t('items.testNotify')}
                            aria-label={t('items.testNotify')}
                          >
                            <Bell className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
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
            {items.map((item) => {
              const status = getStatus(item)
              const days = getDaysRemaining(item.expiry_date)
              return (
                <div key={item.id} className="bg-card rounded-xl border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{item.name}</p>
                      {(item.custom_type || item.category) && (
                        <p className="text-xs text-muted-foreground">
                          {[item.custom_type, item.category].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', STATUS_STYLES[status])}>
                      {t(`items.status.${status}`)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="text-muted-foreground">{item.expiry_date}</span>
                        {item.use_lunar && (
                          <span className="text-xs text-muted-foreground block">{formatLunarDate(item.expiry_date)}</span>
                        )}
                      </div>
                      <DaysBadge days={days} />
                    </div>
                    {item.item_kind === 'subscription' && item.amount != null && (
                      <span className="font-medium tabular-nums">
                        {item.currency} {item.amount.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t">
                    <button
                      onClick={() => navigate(`/items/${item.id}`)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      <Eye className="w-3 h-3" />
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => handleToggle(item)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      {item.is_active ? (
                        <ToggleRight className="w-3 h-3 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-3 h-3" />
                      )}
                      {item.is_active ? t('admin.deactivate') : t('admin.activate')}
                    </button>
                    <button
                      onClick={() => handleTestNotify(item)}
                      disabled={testingId === item.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 disabled:opacity-50 transition-colors"
                    >
                      <Bell className="w-3 h-3" />
                      {t('items.testNotify')}
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
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
