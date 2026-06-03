import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Plus, Trash2, ToggleLeft, ToggleRight, AlertCircle, CreditCard, Bell, RotateCcw, HelpCircle, ArrowUpDown, ArrowUp, ArrowDown, Filter, RefreshCw, Pencil, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Item } from '@/types'
import { formatLunarDate } from '@/lib/lunar'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Portal } from '@/components/Portal'

type StatusKey = 'active' | 'expiringSoon' | 'expired' | 'inactive'

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getEffectiveExpiry(item: Item): string {
  if (item.calendar_mode === 'both' && item.lunar_expiry_date) {
    return item.lunar_expiry_date <= item.expiry_date ? item.lunar_expiry_date : item.expiry_date
  }
  return item.expiry_date
}

function getStatus(item: Item): StatusKey {
  if (!item.is_active) return 'inactive'
  const today = localToday()
  const expiry = getEffectiveExpiry(item)
  if (expiry < today) return 'expired'
  const diff = Math.ceil((new Date(expiry).getTime() - new Date(today).getTime()) / 86400000)
  if (diff <= 7) return 'expiringSoon'
  return 'active'
}

function getDaysRemaining(item: Item): number {
  const today = localToday()
  const expiry = getEffectiveExpiry(item)
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

function HelpIcon({ tooltip }: { tooltip: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const updatePos = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({ x: rect.left + rect.width / 2, y: rect.top })
  }

  return (
    <span
      ref={ref}
      className="inline-flex ml-0.5"
      onMouseEnter={updatePos}
      onMouseLeave={() => setPos(null)}
    >
      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
      {pos && (
        <Portal>
          <div
            className="fixed px-3 py-2 rounded-lg text-xs bg-popover text-popover-foreground border shadow-lg pointer-events-none z-[100] w-80 whitespace-normal"
            style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, calc(-100% - 8px))' }}
          >
            {tooltip.split('\n').map((line, i) => (
              <span key={i}>{i > 0 && <br />}{line}</span>
            ))}
          </div>
        </Portal>
      )}
    </span>
  )
}

function FilterIcon({ options, selected, onChange, allLabel }: { options: string[]; selected: string; onChange: (v: string) => void; allLabel: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos({ x: rect.left, y: rect.bottom + 4 })
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  if (options.length === 0) return null

  return (
    <span ref={ref} className="inline-flex">
      <Filter
        className={cn('w-3.5 h-3.5 cursor-pointer', selected ? 'text-primary' : 'text-muted-foreground opacity-40')}
        onClick={toggle}
      />
      {open && pos && (
        <Portal>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            className="fixed bg-popover border rounded-lg shadow-lg p-2 z-[101] min-w-[140px]"
            style={{ left: pos.x, top: pos.y }}
          >
            <label className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-accent rounded">
              <input
                type="radio"
                checked={selected === ''}
                onChange={() => { onChange(''); setOpen(false) }}
                className="accent-primary"
              />
              {allLabel}
            </label>
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-accent rounded">
                <input
                  type="radio"
                  checked={selected === opt}
                  onChange={() => { onChange(opt); setOpen(false) }}
                  className="accent-primary"
                />
                {opt}
              </label>
            ))}
          </div>
        </Portal>
      )}
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
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [renewingId, setRenewingId] = useState<string | null>(null)

  // Confirm dialog
  const [confirm, setConfirm] = useState<{
    message: string
    variant: 'danger' | 'primary'
    onConfirm: () => void
  } | null>(null)

  // Sort & filter
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<StatusKey | ''>('')

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

  const handleTestNotify = (item: Item) => {
    setConfirm({
      message: t('items.testNotifyConfirm'),
      variant: 'primary',
      onConfirm: async () => {
        setConfirm(null)
        setTestingId(item.id)
        try {
          await api.post(`/items/${item.id}/test-notify`)
        } catch (e: any) {
          setError(e.message)
        } finally {
          setTestingId(null)
        }
      },
    })
  }

  const handleDelete = (item: Item) => {
    setConfirm({
      message: t('common.confirmDelete', { name: item.name }),
      variant: 'danger',
      onConfirm: async () => {
        setConfirm(null)
        try {
          await api.delete(`/items/${item.id}`)
          setItems((prev) => prev.filter((s) => s.id !== item.id))
        } catch (e: any) {
          setError(e.message)
        }
      },
    })
  }

  const handleReset = (item: Item) => {
    setConfirm({
      message: t('items.resetConfirm'),
      variant: 'primary',
      onConfirm: async () => {
        setConfirm(null)
        setResettingId(item.id)
        try {
          const res = await api.post<{ new_expiry_date: string }>(`/items/${item.id}/reset`)
          setItems((prev) => prev.map((s) => s.id === item.id ? { ...s, expiry_date: res.new_expiry_date, last_payment_date: new Date().toISOString() } : s))
        } catch (e: any) {
          setError(e.message)
        } finally {
          setResettingId(null)
        }
      },
    })
  }

  const handleRenew = (item: Item) => {
    setConfirm({
      message: t('items.renewConfirm'),
      variant: 'primary',
      onConfirm: async () => {
        setConfirm(null)
        setRenewingId(item.id)
        try {
          const res = await api.post<{ new_expiry_date: string }>(`/items/${item.id}/renew`, {
            multiplier: 1,
          })
          setItems((prev) => prev.map((s) => s.id === item.id ? { ...s, expiry_date: res.new_expiry_date, last_payment_date: new Date().toISOString() } : s))
        } catch (e: any) {
          setError(e.message)
        } finally {
          setRenewingId(null)
        }
      },
    })
  }

  // Derived filter options
  const categoryOptions = [...new Set(items.map((i) => i.category).filter(Boolean))]

  // Filtered & sorted items
  const displayItems = items
    .filter((i) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!i.name.toLowerCase().includes(q)) return false
      }
      if (filterCategory && i.category !== filterCategory) return false
      if (filterStatus && getStatus(i) !== filterStatus) return false
      return true
    })
    .sort((a, b) => {
      if (!sortOrder) return 0
      const da = new Date(getEffectiveExpiry(a)).getTime()
      const db = new Date(getEffectiveExpiry(b)).getTime()
      return sortOrder === 'asc' ? da - db : db - da
    })

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
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[23%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('items.name')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap relative">
                    <span className="inline-flex items-center gap-1">
                      {t('items.category')}
                      <FilterIcon options={categoryOptions} selected={filterCategory} onChange={setFilterCategory} allLabel={t('items.filterAll')} />
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    {t('items.mode.label')} <HelpIcon tooltip={t('items.mode.tooltip')} />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 cursor-pointer select-none" onClick={() => setSortOrder((prev) => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}>
                      {t('items.expiryDate')}
                      {sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : sortOrder === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('common.status')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('items.reminder')}</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayItems.map((item) => {
                  const status = getStatus(item)
                  const days = getDaysRemaining(item)
                  return (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 overflow-hidden">
                        <div className="font-medium truncate">{item.name}</div>
                        {item.notes && <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.notes}</div>}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground overflow-hidden truncate">{item.category || '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        <div>{item.item_mode === 'reset' ? t('items.mode.reset') : t('items.mode.cycle')}</div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {item.item_mode === 'reset' ? <RotateCcw className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                          {item.period_value}{t(`items.periodUnit.${item.period_unit}`)}
                        </div>
                      </td>
                      <td className="px-4 py-2 overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span>{getEffectiveExpiry(item)}</span>
                          <DaysBadge days={days} />
                        </div>
                        {item.calendar_mode === 'both' && item.lunar_expiry_date && item.lunar_expiry_date !== item.expiry_date ? (
                          <>
                            <span className="text-xs text-muted-foreground block truncate">{t('items.calendarSolar')}：{item.expiry_date} {formatLunarDate(item.expiry_date)}</span>
                            <span className="text-xs text-muted-foreground block truncate">{t('items.calendarLunar')}：{item.lunar_expiry_date} {formatLunarDate(item.lunar_expiry_date)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground block truncate">{formatLunarDate(getEffectiveExpiry(item))}</span>
                        )}
                        {item.start_date && (
                          <span className="text-xs text-muted-foreground block truncate">{t('items.startDate')}：{item.start_date}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[status])}>
                          {t(`items.status.${status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        <div>
                          {item.reminder_unit === 'hour'
                            ? t('items.reminderHours', { value: item.reminder_value })
                            : t('items.reminderDays', { value: item.reminder_value })}
                        </div>
                        {days > 0 && item.reminder_unit !== 'hour' && (
                          <div className="text-xs mt-0.5">
                            {days > item.reminder_value
                              ? t('items.nextReminderIn', { value: days - item.reminder_value })
                              : t('items.nextReminderActive')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center flex-wrap gap-1">
                          <button
                            onClick={() => navigate(`/items/${item.id}`)}
                            className="p-1.5 rounded hover:bg-accent transition-colors"
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                          >
                            <Pencil className="w-4 h-4" />
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
                          {item.item_mode === 'reset' ? (
                            <button
                              onClick={() => handleReset(item)}
                              disabled={resettingId === item.id}
                              className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
                              title={t('items.resetCycle')}
                              aria-label={t('items.resetCycle')}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRenew(item)}
                              disabled={renewingId === item.id}
                              className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
                              title={t('items.renew')}
                              aria-label={t('items.renew')}
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(item)}
                            className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-destructive"
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

          {/* Mobile search & filter toolbar */}
          <div className="md:hidden space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('items.searchPlaceholder')}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {/* Category chips */}
              <button
                onClick={() => setFilterCategory('')}
                className={cn(
                  'shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  !filterCategory ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'
                )}
              >
                {t('items.filterAll')}
              </button>
              {categoryOptions.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? '' : cat)}
                  className={cn(
                    'shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    filterCategory === cat ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'
                  )}
                >
                  {cat}
                </button>
              ))}
              <span className="shrink-0 w-px bg-border" />
              {/* Status chips */}
              <button
                onClick={() => setFilterStatus('')}
                className={cn(
                  'shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  !filterStatus ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'
                )}
              >
                {t('items.statusAll')}
              </button>
              {(['active', 'expiringSoon', 'expired', 'inactive'] as StatusKey[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                  className={cn(
                    'shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    filterStatus === s ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'
                  )}
                >
                  {t(`items.status.${s}`)}
                </button>
              ))}
              <span className="shrink-0 w-px bg-border" />
              {/* Sort chip */}
              <button
                onClick={() => setSortOrder((prev) => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
                className={cn(
                  'shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1',
                  sortOrder ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'
                )}
              >
                {sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : sortOrder === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3" />}
                {t('items.sortExpiry')}
              </button>
            </div>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {displayItems.map((item) => {
              const status = getStatus(item)
              const days = getDaysRemaining(item)
              return (
                <div key={item.id} className="bg-card rounded-xl border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{item.name}</p>
                      {item.notes && <p className="text-xs text-muted-foreground mt-0.5">{item.notes}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted flex items-center gap-1">
                          {item.item_mode === 'reset' ? t('items.mode.reset') : t('items.mode.cycle')}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          {item.item_mode === 'reset' ? <RotateCcw className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                          {item.period_value}{t(`items.periodUnit.${item.period_unit}`)}
                        </span>
                        {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
                      </div>
                    </div>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', STATUS_STYLES[status])}>
                      {t(`items.status.${status}`)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-start gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{getEffectiveExpiry(item)}</span>
                          <DaysBadge days={days} />
                        </div>
                        {item.calendar_mode === 'both' && item.lunar_expiry_date && item.lunar_expiry_date !== item.expiry_date ? (
                          <>
                            <span className="text-xs text-muted-foreground block">{t('items.calendarSolar')}：{item.expiry_date} {formatLunarDate(item.expiry_date)}</span>
                            <span className="text-xs text-muted-foreground block">{t('items.calendarLunar')}：{item.lunar_expiry_date} {formatLunarDate(item.lunar_expiry_date)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground block">{formatLunarDate(getEffectiveExpiry(item))}</span>
                        )}
                        {item.start_date && (
                          <span className="text-xs text-muted-foreground block">{t('items.startDate')}：{item.start_date}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div>
                        {item.reminder_unit === 'hour'
                          ? t('items.reminderHours', { value: item.reminder_value })
                          : t('items.reminderDays', { value: item.reminder_value })}
                      </div>
                      {days > 0 && item.reminder_unit !== 'hour' && (
                        <div>
                          {days > item.reminder_value
                            ? t('items.nextReminderIn', { value: days - item.reminder_value })
                            : t('items.nextReminderActive')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-end justify-between pt-1 border-t gap-1.5">
                    <button
                      onClick={() => navigate(`/items/${item.id}`)}
                      className="flex flex-col items-center gap-0.5 text-xs py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors flex-1 min-w-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span className="truncate w-full text-center">{t('common.edit')}</span>
                    </button>
                    <button
                      onClick={() => handleToggle(item)}
                      className="flex flex-col items-center gap-0.5 text-xs py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors flex-1 min-w-0"
                    >
                      {item.is_active ? (
                        <ToggleRight className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-3.5 h-3.5" />
                      )}
                      <span className="truncate w-full text-center">{item.is_active ? t('admin.deactivate') : t('admin.activate')}</span>
                    </button>
                    <button
                      onClick={() => handleTestNotify(item)}
                      disabled={testingId === item.id}
                      className="flex flex-col items-center gap-0.5 text-xs py-1.5 rounded bg-accent hover:bg-accent/70 disabled:opacity-50 transition-colors flex-1 min-w-0"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span className="truncate w-full text-center">{t('items.testNotify')}</span>
                    </button>
                    {item.item_mode === 'reset' ? (
                      <button
                        onClick={() => handleReset(item)}
                        disabled={resettingId === item.id}
                        className="flex flex-col items-center gap-0.5 text-xs py-1.5 rounded bg-accent hover:bg-accent/70 disabled:opacity-50 transition-colors flex-1 min-w-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="truncate w-full text-center">{t('items.resetCycle')}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRenew(item)}
                        disabled={renewingId === item.id}
                        className="flex flex-col items-center gap-0.5 text-xs py-1.5 rounded bg-accent hover:bg-accent/70 disabled:opacity-50 transition-colors flex-1 min-w-0"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span className="truncate w-full text-center">{t('items.renew')}</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(item)}
                      className="flex flex-col items-center gap-0.5 text-xs py-1.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors flex-1 min-w-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="truncate w-full text-center">{t('common.delete')}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message || ''}
        variant={confirm?.variant || 'primary'}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirm?.onConfirm || (() => {})}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
