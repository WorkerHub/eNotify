import { Hono } from 'hono'
import { getTablePrefix } from '../types'
import type { HonoEnv } from '../types'
import { authMiddleware, getEffectiveUserId } from '../middleware/auth'
import { getActiveItemsByUser } from '../db/queries/items'
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
  const allActiveItems = await getActiveItemsByUser(c.env.DB, prefix, userId)

  const subscriptionItems = allActiveItems.filter((s) => s.item_kind === 'subscription')
  const regularItems = allActiveItems.filter((s) => s.item_kind !== 'subscription')

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

  // --- Subscription financial stats ---
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

  // Subscription: upcoming renewals and expiring soon
  const subUpcomingRenewals = subscriptionItems
    .filter((s) => {
      const days = diffInDays(today, s.expiry_date)
      return days >= 0 && days <= 7
    })
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))

  const subExpiringSoon = subUpcomingRenewals.length

  const recentPayments = payments
    .filter((p) => {
      const days = diffInDays(p.date, today)
      return days >= 0 && days <= 7
    })
    .slice(0, 10)

  // Subscription: category & type rankings by amount
  const categoryExpense: Record<string, number> = {}
  const typeExpense: Record<string, number> = {}

  for (const sub of subscriptionItems) {
    if (!sub.amount) continue
    const converted = sub.currency === baseCurrency
      ? sub.amount
      : convertAmount(sub.amount, sub.currency, baseCurrency, rates)

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

  const subCategoryRanking = Object.entries(categoryExpense)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)

  const subTypeRanking = Object.entries(typeExpense)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)

  // --- Regular reminder stats ---
  const regExpiringSoon = regularItems.filter((s) => {
    const days = diffInDays(today, s.expiry_date)
    return days >= 0 && days <= 7
  }).length

  const regUpcomingReminders = regularItems
    .filter((s) => {
      const days = diffInDays(today, s.expiry_date)
      return days >= 0 && days <= 7
    })
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
    .map((s) => ({ id: s.id, name: s.name, expiry_date: s.expiry_date }))

  // Regular: category ranking by count
  const categoryCount: Record<string, number> = {}
  for (const item of regularItems) {
    if (item.category) {
      const cats = item.category.split(/[,/\s]+/).filter(Boolean)
      for (const cat of cats) {
        categoryCount[cat] = (categoryCount[cat] || 0) + 1
      }
    }
  }

  const regCategoryRanking = Object.entries(categoryCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return c.json({
    subscription: {
      monthly_expense: Math.round(monthlyExpense * 100) / 100,
      monthly_trend: Math.round(monthlyTrend * 10) / 10,
      yearly_expense: Math.round(yearlyExpense * 100) / 100,
      monthly_average: Math.round((yearlyExpense / (currentMonth + 1)) * 100) / 100,
      active_count: subscriptionItems.length,
      expiring_soon: subExpiringSoon,
      upcoming_renewals: subUpcomingRenewals,
      recent_payments: recentPayments,
      category_ranking: subCategoryRanking,
      type_ranking: subTypeRanking,
      base_currency: baseCurrency,
    },
    regular: {
      active_count: regularItems.length,
      expiring_soon: regExpiringSoon,
      upcoming_reminders: regUpcomingReminders,
      category_ranking: regCategoryRanking,
    },
  })
})
