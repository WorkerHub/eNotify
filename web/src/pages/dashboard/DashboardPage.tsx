import { useEffect, useState, type ElementType } from "react";
import { useTranslation } from "react-i18next";
import {
  TrendingUp,
  TrendingDown,
  CreditCard,
  AlertCircle,
  Bell,
  CalendarClock,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn, daysUntil } from "@/lib/utils";
import type { DashboardStats } from "@/types";
import { DueRing, getDueTier } from "@/components/DueRing";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";

function StatSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 md:p-6">
      <Skeleton className="h-3.5 w-1/2" />
      <Skeleton className="mt-3 h-8 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/3" />
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4 md:p-6">
      <Skeleton className="h-14 w-14 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-8 w-1/4" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  trend,
  icon: Icon,
  display = false,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: number;
  icon: ElementType;
  display?: boolean;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-1 md:p-6">
      <div className="flex items-center justify-between text-caption text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div
        className={cn(
          "tabular-nums",
          display ? "text-display-lg" : "text-display",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </div>
      <div className="flex items-center gap-1 text-caption">
        {trend !== undefined && (
          <span
            className={cn(
              "flex items-center gap-0.5 font-medium tabular-nums",
              trend > 0
                ? "text-destructive"
                : trend < 0
                  ? "text-success"
                  : "text-muted-foreground",
            )}
          >
            {trend > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : trend < 0 ? (
              <TrendingDown className="h-3 w-3" />
            ) : null}
            {trend > 0 ? "+" : ""}
            {trend.toFixed(1)}%
          </span>
        )}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function ProgressBar({
  name,
  value,
  max,
  unit,
}: {
  name: string;
  value: number;
  max: number;
  unit?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-body-sm">
      <span className="w-24 shrink-0 truncate text-muted-foreground">
        {name}
      </span>
      <div className="h-2 flex-1 rounded-xs bg-muted">
        <div
          className="h-2 rounded-xs bg-primary transition-all duration-(--duration-standard)"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-16 text-right font-medium tabular-nums">
        {unit ? `${value.toFixed(2)}` : value}
      </span>
    </div>
  );
}

function Panel({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-1 md:p-6">
      <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {empty ? (
        <p className="text-body-sm text-muted-foreground">
          {t("dashboard.noData")}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

/** Ledger row: name left, date + amount right-aligned tabular (§3.3). */
function LedgerRow({
  name,
  date,
  amount,
}: {
  name: string;
  date: string;
  amount?: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 text-body-sm">
      <span className="truncate text-body-strong">{name}</span>
      <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
        <span className="text-muted-foreground">{date}</span>
        {amount && <span className="text-body-strong">{amount}</span>}
      </span>
    </li>
  );
}

// Module-level cache so re-visiting the dashboard shows data instantly
let cachedStats: DashboardStats | null = null;

export function DashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats | null>(cachedStats);
  const [loading, setLoading] = useState(!cachedStats);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    api
      .get<DashboardStats>("/dashboard/stats")
      .then((data) => {
        cachedStats = data;
        setStats(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  if (loading) {
    return (
      <div className="space-y-8 stagger">
        <Skeleton className="h-7 w-32" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatSkeleton />
          <StatSkeleton />
          <StatSkeleton />
        </div>
        <HeroSkeleton />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border bg-card p-4 md:p-6">
            <Skeleton className="h-3.5 w-24" />
            {Array.from({ length: 4 }, (_, i) => `row-${i + 1}`).map((k) => (
              <Skeleton key={k} className="h-5 w-full" />
            ))}
          </div>
          <div className="space-y-3 rounded-lg border bg-card p-4 md:p-6">
            <Skeleton className="h-3.5 w-24" />
            {Array.from({ length: 4 }, (_, i) => `row-${i + 1}`).map((k) => (
              <Skeleton key={k} className="h-5 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <h1 className="text-heading">{t("dashboard.title")}</h1>
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            load();
          }}
          retryLabel={t("common.retry")}
        />
      </div>
    );
  }

  if (!stats) return null;

  const sub = stats.subscription;
  const reg = stats.regular;
  const currency = sub.base_currency;
  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;

  const subCategoryMax = sub.category_ranking[0]?.amount ?? 0;
  const regCategoryMax = reg.category_ranking[0]?.count ?? 0;

  // Hero: nearest upcoming renewal (countdown is first-class, §3.1)
  const next = [...sub.upcoming_renewals].sort((a, b) =>
    a.expiry_date.localeCompare(b.expiry_date),
  )[0];
  const nextDays = next ? daysUntil(next.expiry_date) : null;
  const periodDays = next
    ? next.period_value *
      { day: 1, week: 7, month: 30, year: 365 }[next.period_unit]
    : 1;
  const nextProgress =
    nextDays != null ? Math.max(0, Math.min(1, nextDays / periodDays)) : 0;

  const isEmpty =
    sub.active_count === 0 &&
    reg.active_count === 0 &&
    sub.upcoming_renewals.length === 0 &&
    reg.upcoming_reminders.length === 0;

  return (
    <div className="space-y-12">
      <h1 className="text-heading">{t("dashboard.title")}</h1>

      {isEmpty ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title={t("items.emptyTitle")}
          description={t("items.emptyDesc")}
        />
      ) : (
        <>
          {/* ── Hero: next due countdown (主数据锚点, §3.1) ── */}
          {next && nextDays != null && (
            <section className="flex items-center gap-4 rounded-lg border bg-card p-4 shadow-1 md:gap-6 md:p-6">
              <DueRing
                days={nextDays}
                progress={nextProgress}
                size={56}
                strokeWidth={4}
              />
              <div className="min-w-0 flex-1">
                <p className="text-caption text-muted-foreground">
                  {t("dashboard.nextDue")}
                </p>
                <p className="truncate text-title">{next.name}</p>
              </div>
              <div className="flex shrink-0 items-baseline gap-2">
                <span
                  className={cn(
                    "text-display-lg tabular-nums leading-none",
                    {
                      far: "text-due-far",
                      soon: "text-due-soon",
                      close: "text-due-close",
                      over: "text-due-over",
                    }[getDueTier(nextDays)],
                  )}
                >
                  {nextDays < 0 ? `-${Math.abs(nextDays)}` : nextDays}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("dashboard.daysUnit")}
                </span>
              </div>
            </section>
          )}

          {/* ── Primary stats: 3 display anchors (§5 dashboard) ── */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard
              label={t("dashboard.monthSpent")}
              value={fmt(sub.monthly_expense)}
              trend={sub.monthly_trend}
              sub={t("dashboard.trend")}
              icon={CreditCard}
              display
            />
            <StatCard
              label={t("dashboard.expiring7")}
              value={String(sub.expiring_soon + reg.expiring_soon)}
              icon={AlertCircle}
              display
              tone={
                sub.expiring_soon + reg.expiring_soon > 0
                  ? "warning"
                  : undefined
              }
            />
            <StatCard
              label={t("dashboard.activeTotal")}
              value={String(sub.active_count + reg.active_count)}
              icon={Bell}
              display
            />
          </section>

          {/* ── Section 1: Subscriptions ── */}
          <section className="space-y-6">
            <h2 className="text-title">{t("dashboard.subscriptionSection")}</h2>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                label={t("dashboard.yearlyExpense")}
                value={fmt(sub.yearly_expense)}
                sub={`${t("dashboard.monthlyAverage")}: ${fmt(sub.monthly_average)}`}
                icon={CreditCard}
              />
              <StatCard
                label={t("dashboard.activeCount")}
                value={String(sub.active_count)}
                icon={CreditCard}
              />
              <StatCard
                label={t("dashboard.expiringSoon")}
                value={String(sub.expiring_soon)}
                icon={AlertCircle}
              />
              <StatCard
                label={t("dashboard.monthlyExpense")}
                value={fmt(sub.monthly_expense)}
                icon={CreditCard}
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Panel
                title={t("dashboard.upcomingRenewals")}
                empty={sub.upcoming_renewals.length === 0}
              >
                <ul className="divide-y">
                  {sub.upcoming_renewals.map((item) => (
                    <LedgerRow
                      key={item.id}
                      name={item.name}
                      date={item.expiry_date}
                      amount={
                        item.amount != null
                          ? `${item.currency} ${item.amount.toFixed(2)}`
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </Panel>

              <Panel
                title={t("dashboard.recentPayments")}
                empty={sub.recent_payments.length === 0}
              >
                <ul className="divide-y">
                  {sub.recent_payments.map((p) => (
                    <LedgerRow
                      key={p.id}
                      name={p.date.slice(0, 10)}
                      date=""
                      amount={`${p.currency} ${p.amount.toFixed(2)}`}
                    />
                  ))}
                </ul>
              </Panel>

              <Panel
                title={t("dashboard.categoryRanking")}
                empty={sub.category_ranking.length === 0}
              >
                <div className="space-y-2">
                  {sub.category_ranking.slice(0, 8).map((item) => (
                    <ProgressBar
                      key={item.name}
                      name={item.name}
                      value={item.amount}
                      max={subCategoryMax}
                      unit={currency}
                    />
                  ))}
                </div>
              </Panel>
            </div>
          </section>

          {/* ── Section 2: Regular Reminders ── */}
          <section className="space-y-6">
            <h2 className="text-title">{t("dashboard.regularSection")}</h2>

            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label={t("dashboard.activeRegularCount")}
                value={String(reg.active_count)}
                icon={Bell}
              />
              <StatCard
                label={t("dashboard.expiringSoon")}
                value={String(reg.expiring_soon)}
                icon={AlertCircle}
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Panel
                title={t("dashboard.upcomingReminders")}
                empty={reg.upcoming_reminders.length === 0}
              >
                <ul className="divide-y">
                  {reg.upcoming_reminders.map((item) => (
                    <LedgerRow
                      key={item.id}
                      name={item.name}
                      date={item.expiry_date}
                    />
                  ))}
                </ul>
              </Panel>

              <Panel
                title={t("dashboard.regularCategoryRanking")}
                empty={reg.category_ranking.length === 0}
              >
                <div className="space-y-2">
                  {reg.category_ranking.slice(0, 8).map((item) => (
                    <ProgressBar
                      key={item.name}
                      name={item.name}
                      value={item.count}
                      max={regCategoryMax}
                    />
                  ))}
                </div>
              </Panel>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
