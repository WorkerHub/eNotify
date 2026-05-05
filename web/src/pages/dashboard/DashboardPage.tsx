import { useEffect, useState, type ElementType } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, CreditCard, AlertCircle } from 'lucide-react'
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

function ProgressBar({ name, amount, max }: { name: string; amount: number; max: number }) {
  const pct = max > 0 ? Math.round((amount / max) * 100) : 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 truncate text-muted-foreground shrink-0">{name}</span>
      <div className="flex-1 bg-muted rounded-full h-2">
        <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right font-medium tabular-nums">{amount.toFixed(2)}</span>
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

  const currency = stats.base_currency
  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`

  const categoryMax = stats.category_ranking[0]?.amount ?? 0
  const typeMax = stats.type_ranking[0]?.amount ?? 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={t('dashboard.monthlyExpense')}
          value={fmt(stats.monthly_expense)}
          trend={stats.monthly_trend}
          sub={t('dashboard.trend')}
          icon={CreditCard}
        />
        <StatCard
          label={t('dashboard.yearlyExpense')}
          value={fmt(stats.yearly_expense)}
          sub={`${t('dashboard.monthlyAverage')}: ${fmt(stats.monthly_average)}`}
          icon={CreditCard}
        />
        <StatCard
          label={t('dashboard.activeCount')}
          value={String(stats.active_count)}
          icon={CreditCard}
        />
        <StatCard
          label={t('dashboard.expiringSoon')}
          value={String(stats.expiring_soon)}
          icon={AlertCircle}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming renewals */}
        <div className="bg-card rounded-xl border p-4 space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            {t('dashboard.upcomingRenewals')}
          </h2>
          {stats.upcoming_renewals.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <ul className="divide-y">
              {stats.upcoming_renewals.map((sub) => (
                <li key={sub.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium truncate max-w-[140px]">{sub.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground">{sub.expiry_date}</span>
                    {sub.amount != null && (
                      <span className="font-medium tabular-nums">
                        {sub.currency} {sub.amount.toFixed(2)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent payments */}
        <div className="bg-card rounded-xl border p-4 space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            {t('dashboard.recentPayments')}
          </h2>
          {stats.recent_payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <ul className="divide-y">
              {stats.recent_payments.map((p) => (
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
        {/* Category ranking */}
        <div className="bg-card rounded-xl border p-4 space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            {t('dashboard.categoryRanking')}
          </h2>
          {stats.category_ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <div className="space-y-2">
              {stats.category_ranking.slice(0, 8).map((item) => (
                <ProgressBar key={item.name} name={item.name} amount={item.amount} max={categoryMax} />
              ))}
            </div>
          )}
        </div>

        {/* Type ranking */}
        <div className="bg-card rounded-xl border p-4 space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            {t('dashboard.typeRanking')}
          </h2>
          {stats.type_ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <div className="space-y-2">
              {stats.type_ranking.slice(0, 8).map((item) => (
                <ProgressBar key={item.name} name={item.name} amount={item.amount} max={typeMax} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
