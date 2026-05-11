import { useEffect, useState, type ElementType } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, CreditCard, AlertCircle, Bell } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { DashboardStats } from '@/types'

function SkeletonCard() {
  return (
    <div className="bg-card rounded-xl border p-4 animate-pulse">
      <div className="h-4 bg-muted rounded w-1/2 mb-3" />
      <div className="h-8 bg-muted rounded w-3/4 mb-2" />
      <div className="h-3 bg-muted rounded w-1/3" />
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  trend,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  trend?: number
  icon: ElementType
}) {
  return (
    <div className="bg-card rounded-xl border p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between text-muted-foreground text-sm">
        <span>{label}</span>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="flex items-center gap-1 text-xs">
        {trend !== undefined && (
          <span
            className={cn(
              'flex items-center gap-0.5 font-medium',
              trend > 0 ? 'text-red-500' : trend < 0 ? 'text-green-500' : 'text-muted-foreground',
            )}
          >
            {trend > 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : trend < 0 ? (
              <TrendingDown className="w-3 h-3" />
            ) : null}
            {trend > 0 ? '+' : ''}
            {trend.toFixed(1)}%
          </span>
        )}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
    </div>
  )
}

function ProgressBar({ name, value, max, unit }: { name: string; value: number; max: number; unit?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 truncate text-muted-foreground shrink-0">{name}</span>
      <div className="flex-1 bg-muted rounded-full h-2">
        <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right font-medium tabular-nums">
        {unit ? `${value.toFixed(2)}` : value}
      </span>
    </div>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .get<DashboardStats>('/dashboard/stats')
      .then((data) => { if (!cancelled) setStats(data) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-7 bg-muted rounded w-32 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="bg-card rounded-xl border p-4 animate-pulse space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 bg-muted rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive p-4 rounded-xl border border-destructive/20 bg-destructive/5">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="text-sm">{error}</span>
      </div>
    )
  }

  if (!stats) return null

  const sub = stats.subscription
  const reg = stats.regular
  const currency = sub.base_currency
  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`

  const subCategoryMax = sub.category_ranking[0]?.amount ?? 0
  const regCategoryMax = reg.category_ranking[0]?.count ?? 0

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>

      {/* ── Section 1: Subscriptions ── */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-muted-foreground border-b pb-2">
          {t('dashboard.subscriptionSection')}
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label={t('dashboard.monthlyExpense')}
            value={fmt(sub.monthly_expense)}
            trend={sub.monthly_trend}
            sub={t('dashboard.trend')}
            icon={CreditCard}
          />
          <StatCard
            label={t('dashboard.yearlyExpense')}
            value={fmt(sub.yearly_expense)}
            sub={`${t('dashboard.monthlyAverage')}: ${fmt(sub.monthly_average)}`}
            icon={CreditCard}
          />
          <StatCard
            label={t('dashboard.activeCount')}
            value={String(sub.active_count)}
            icon={CreditCard}
          />
          <StatCard
            label={t('dashboard.expiringSoon')}
            value={String(sub.expiring_soon)}
            icon={AlertCircle}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              {t('dashboard.upcomingRenewals')}
            </h3>
            {sub.upcoming_renewals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
            ) : (
              <ul className="divide-y">
                {sub.upcoming_renewals.map((item) => (
                  <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium truncate max-w-[140px]">{item.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground">{item.expiry_date}</span>
                      {item.amount != null && (
                        <span className="font-medium tabular-nums">
                          {item.currency} {item.amount.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              {t('dashboard.recentPayments')}
            </h3>
            {sub.recent_payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
            ) : (
              <ul className="divide-y">
                {sub.recent_payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">{p.date.slice(0, 10)}</span>
                    <span className="font-medium tabular-nums">
                      {p.currency} {p.amount.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              {t('dashboard.categoryRanking')}
            </h3>
            {sub.category_ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
            ) : (
              <div className="space-y-2">
                {sub.category_ranking.slice(0, 8).map((item) => (
                  <ProgressBar key={item.name} name={item.name} value={item.amount} max={subCategoryMax} unit={currency} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Section 2: Regular Reminders ── */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-muted-foreground border-b pb-2">
          {t('dashboard.regularSection')}
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label={t('dashboard.activeRegularCount')}
            value={String(reg.active_count)}
            icon={Bell}
          />
          <StatCard
            label={t('dashboard.expiringSoon')}
            value={String(reg.expiring_soon)}
            icon={AlertCircle}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              {t('dashboard.upcomingReminders')}
            </h3>
            {reg.upcoming_reminders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
            ) : (
              <ul className="divide-y">
                {reg.upcoming_reminders.map((item) => (
                  <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium truncate max-w-[180px]">{item.name}</span>
                    <span className="text-muted-foreground shrink-0">{item.expiry_date}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              {t('dashboard.regularCategoryRanking')}
            </h3>
            {reg.category_ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
            ) : (
              <div className="space-y-2">
                {reg.category_ranking.slice(0, 8).map((item) => (
                  <ProgressBar key={item.name} name={item.name} value={item.count} max={regCategoryMax} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
