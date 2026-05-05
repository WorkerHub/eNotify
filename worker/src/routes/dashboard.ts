import { Hono } from 'hono'
import { getTablePrefix } from '../types'
import type { HonoEnv } from '../types'
import { authMiddleware, getEffectiveUserId } from '../middleware/auth'
import { getActiveSubscriptionsByUser } from '../db/queries/subscriptions'
import { listPaymentsByUserSince } from '../db/queries/payments'
import { getExchangeRates, convertAmount } from '../core/currency'
import { findUserById } from '../db/queries/users'
import { diffInDays, nowISO } from '../core/time'

export const dashboardRoutes = new Hono<HonoEnv>()

dashboardRoutes.use('*', authMiddleware)

dashboardRoutes.get('/stats', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const baseCurrency = user.base_currency || 'CNY'
  const activeSubscriptions = await getActiveSubscriptionsByUser(c.env.DB, prefix, userId)

  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1
  const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear

  const sinceDate = `${lastMonthYear}-01-01`
  const payments = await listPaymentsByUserSince(c.env.DB, prefix, userId, sinceDate)

  let rates: Record<string, number> = {}
  try {
    rates = await getExchangeRates(c.env.KV, baseCurrency)
  } catch {
    // Fallback: no conversion
  }

  let monthlyExpense = 0
  let lastMonthExpense = 0
  let yearlyExpense = 0

  for (const payment of payments) {
    const payDate = new Date(payment.date)
    const converted = payment.currency === baseCurrency
      ? payment.amount
      : convertAmount(payment.amount, payment.currency, baseCurrency, rates)

    if (payDate.getFullYear() === currentYear) {
      yearlyExpense += converted
      if (payDate.getMonth() === currentMonth) {
        monthlyExpense += converted
      }
    }
    if (payDate.getFullYear() === lastMonthYear && payDate.getMonth() === lastMonth) {
      lastMonthExpense += converted
    }
  }

  const monthlyTrend = lastMonthExpense > 0
    ? ((monthlyExpense - lastMonthExpense) / lastMonthExpense * 100)
    : 0

  const today = nowISO().split('T')[0]
  const upcomingRenewals = activeSubscriptions
    .filter((s) => {
      const days = diffInDays(today, s.expiry_date)
      return days >= 0 && days <= 7
    })
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))

  const expiringSoon = activeSubscriptions.filter((s) => {
    const days = diffInDays(today, s.expiry_date)
    return days >= 0 && days <= 7
  }).length

  const recentPayments = payments
    .filter((p) => {
      const days = diffInDays(p.date, today)
      return days >= 0 && days <= 7
    })
    .slice(0, 10)

  // Category & type rankings
  const categoryExpense: Record<string, number> = {}
  const typeExpense: Record<string, number> = {}

  for (const sub of activeSubscriptions) {
    if (!sub.amount) continue
    const converted = sub.currency === baseCurrency
      ? sub.amount
      : convertAmount(sub.amount, sub.currency, baseCurrency, rates)

    // Normalize to monthly
    let monthly = converted
    if (sub.period_unit === 'year') monthly = converted / 12
    else if (sub.period_unit === 'day') monthly = converted * 30

    if (sub.category) {
      const cats = sub.category.split(/[,/\s]+/).filter(Boolean)
      for (const cat of cats) {
        categoryExpense[cat] = (categoryExpense[cat] || 0) + monthly / cats.length
      }
    }

    if (sub.custom_type) {
      typeExpense[sub.custom_type] = (typeExpense[sub.custom_type] || 0) + monthly
    }
  }

  const categoryRanking = Object.entries(categoryExpense)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)

  const typeRanking = Object.entries(typeExpense)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)

  return c.json({
    monthly_expense: Math.round(monthlyExpense * 100) / 100,
    monthly_trend: Math.round(monthlyTrend * 10) / 10,
    yearly_expense: Math.round(yearlyExpense * 100) / 100,
    monthly_average: Math.round((yearlyExpense / (currentMonth + 1)) * 100) / 100,
    active_count: activeSubscriptions.length,
    expiring_soon: expiringSoon,
    upcoming_renewals: upcomingRenewals,
    recent_payments: recentPayments,
    category_ranking: categoryRanking,
    type_ranking: typeRanking,
    base_currency: baseCurrency,
  })
})
