import { Hono } from 'hono'
import type { Subscription, HonoEnv } from '../types'
import { authMiddleware, getEffectiveUserId } from '../middleware/auth'
import {
  createSubscription, getSubscription, listSubscriptionsByUser,
  updateSubscription, deleteSubscription, toggleSubscriptionStatus
} from '../db/queries/subscriptions'
import { createPayment, listPaymentsBySubscription, updatePayment, deletePayment, getPayment } from '../db/queries/payments'
import { getNotificationConfig } from '../db/queries/notifications'
import { generateId } from '../core/auth'
import { nowISO, addPeriod } from '../core/time'
import { sendNotifications, type NotifyMessage } from '../services/notify/index'

export const subscriptionRoutes = new Hono<HonoEnv>()

subscriptionRoutes.use('*', authMiddleware)

subscriptionRoutes.get('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const subs = await listSubscriptionsByUser(c.env.DB, prefix, userId)
  return c.json(subs)
})

subscriptionRoutes.post('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const body = await c.req.json()

  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Subscription name is required' }, 400)
  }
  if (!body.expiry_date || typeof body.expiry_date !== 'string') {
    return c.json({ error: 'Expiry date is required' }, 400)
  }
  if (isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: 'Invalid expiry date' }, 400)
  }
  if (body.start_date && isNaN(Date.parse(body.start_date))) {
    return c.json({ error: 'Invalid start date' }, 400)
  }
  if (body.period_value !== undefined && (typeof body.period_value !== 'number' || body.period_value < 1)) {
    return c.json({ error: 'Period value must be >= 1' }, 400)
  }
  if (body.period_unit && !['day', 'month', 'year'].includes(body.period_unit)) {
    return c.json({ error: 'Invalid period unit' }, 400)
  }
  if (body.reminder_unit && !['day', 'hour'].includes(body.reminder_unit)) {
    return c.json({ error: 'Invalid reminder unit' }, 400)
  }
  if (body.subscription_mode && !['cycle', 'reset'].includes(body.subscription_mode)) {
    return c.json({ error: 'Invalid subscription mode' }, 400)
  }
  if (body.amount !== undefined && body.amount !== null && (typeof body.amount !== 'number' || body.amount < 0)) {
    return c.json({ error: 'Amount must be a non-negative number' }, 400)
  }

  const id = generateId()
  const now = nowISO()

  const sub: Omit<Subscription, 'created_at' | 'updated_at'> = {
    id,
    user_id: userId,
    name: body.name,
    subscription_mode: body.subscription_mode || 'cycle',
    custom_type: body.custom_type || '',
    category: body.category || '',
    start_date: body.start_date || null,
    expiry_date: body.expiry_date,
    period_value: body.period_value || 1,
    period_unit: body.period_unit || 'month',
    reminder_unit: body.reminder_unit || 'day',
    reminder_value: body.reminder_value ?? 7,
    notes: body.notes || '',
    amount: body.amount ?? null,
    currency: body.currency || 'CNY',
    last_payment_date: body.last_payment_date || null,
    is_active: body.is_active ?? 1,
    auto_renew: body.auto_renew ?? 1,
    use_lunar: body.use_lunar ?? 0,
  }

  await createSubscription(c.env.DB, prefix, sub)

  if (sub.amount && sub.start_date) {
    await createPayment(c.env.DB, prefix, {
      id: generateId(),
      subscription_id: id,
      user_id: userId,
      date: sub.start_date || now,
      amount: sub.amount,
      currency: sub.currency,
      type: 'initial',
      note: '',
      period_start: sub.start_date,
      period_end: sub.expiry_date,
    })
  }

  return c.json(sub, 201)
})

subscriptionRoutes.get('/:id', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  return c.json(sub)
})

subscriptionRoutes.put('/:id', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json()

  if (body.period_value !== undefined && (typeof body.period_value !== 'number' || body.period_value < 1)) {
    return c.json({ error: 'Period value must be >= 1' }, 400)
  }
  if (body.expiry_date && isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: 'Invalid expiry date' }, 400)
  }
  if (body.start_date && isNaN(Date.parse(body.start_date))) {
    return c.json({ error: 'Invalid start date' }, 400)
  }
  if (body.period_unit && !['day', 'month', 'year'].includes(body.period_unit)) {
    return c.json({ error: 'Invalid period unit' }, 400)
  }
  if (body.reminder_unit && !['day', 'hour'].includes(body.reminder_unit)) {
    return c.json({ error: 'Invalid reminder unit' }, 400)
  }
  if (body.subscription_mode && !['cycle', 'reset'].includes(body.subscription_mode)) {
    return c.json({ error: 'Invalid subscription mode' }, 400)
  }
  if (body.amount !== undefined && body.amount !== null && typeof body.amount !== 'number') {
    return c.json({ error: 'Amount must be a number' }, 400)
  }
  if (body.is_active !== undefined && ![0, 1].includes(body.is_active)) {
    return c.json({ error: 'is_active must be 0 or 1' }, 400)
  }
  if (body.auto_renew !== undefined && ![0, 1].includes(body.auto_renew)) {
    return c.json({ error: 'auto_renew must be 0 or 1' }, 400)
  }
  if (body.use_lunar !== undefined && ![0, 1].includes(body.use_lunar)) {
    return c.json({ error: 'use_lunar must be 0 or 1' }, 400)
  }
  if (body.reminder_value !== undefined && (typeof body.reminder_value !== 'number' || body.reminder_value < 0)) {
    return c.json({ error: 'reminder_value must be a non-negative number' }, 400)
  }

  const updates: Record<string, any> = {}
  const allowedFields = [
    'name', 'subscription_mode', 'custom_type', 'category', 'start_date',
    'expiry_date', 'period_value', 'period_unit', 'reminder_unit', 'reminder_value',
    'notes', 'amount', 'currency', 'is_active', 'auto_renew', 'use_lunar',
  ]
  for (const key of allowedFields) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  await updateSubscription(c.env.DB, prefix, id, updates)
  return c.json({ success: true })
})

subscriptionRoutes.delete('/:id', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  await deleteSubscription(c.env.DB, prefix, id)
  return c.json({ success: true })
})

subscriptionRoutes.post('/:id/toggle-status', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  await toggleSubscriptionStatus(c.env.DB, prefix, id)
  return c.json({ success: true, is_active: sub.is_active ? 0 : 1 })
})

subscriptionRoutes.post('/:id/renew', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json<{ amount?: number; date?: string; multiplier?: number; note?: string }>()
  const multiplier = Math.min(Math.max(body.multiplier || 1, 1), 120)
  let newExpiry = sub.expiry_date

  for (let i = 0; i < multiplier; i++) {
    newExpiry = addPeriod(newExpiry, sub.period_value, sub.period_unit)
  }

  const paymentDate = body.date || nowISO()
  const paymentAmount = body.amount ?? sub.amount ?? 0

  await updateSubscription(c.env.DB, prefix, id, {
    expiry_date: newExpiry,
    last_payment_date: paymentDate,
  })

  await createPayment(c.env.DB, prefix, {
    id: generateId(),
    subscription_id: id,
    user_id: userId,
    date: paymentDate,
    amount: paymentAmount,
    currency: sub.currency,
    type: 'manual',
    note: body.note || '',
    period_start: sub.expiry_date,
    period_end: newExpiry,
  })

  return c.json({ success: true, new_expiry_date: newExpiry })
})

subscriptionRoutes.post('/:id/test-notify', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const notifyConfig = await getNotificationConfig(c.env.DB, prefix, userId)
  if (!notifyConfig) {
    return c.json({ error: 'No notification channels configured' }, 400)
  }

  const message: NotifyMessage = {
    title: `🔔 ${sub.name} - Test Notification`,
    body: `This is a test notification for subscription "${sub.name}" expiring on ${sub.expiry_date}.`,
  }

  const results = await sendNotifications(notifyConfig, message, c.env)
  return c.json({ results })
})

// Payment history
subscriptionRoutes.get('/:id/payments', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const payments = await listPaymentsBySubscription(c.env.DB, prefix, id)
  return c.json(payments)
})

subscriptionRoutes.put('/:id/payments/:pid', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')
  const pid = c.req.param('pid')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const payment = await getPayment(c.env.DB, prefix, pid)
  if (!payment || payment.subscription_id !== id) {
    return c.json({ error: 'Payment not found' }, 404)
  }

  const body = await c.req.json()

  if (body.amount !== undefined && typeof body.amount !== 'number') {
    return c.json({ error: 'Amount must be a number' }, 400)
  }
  if (body.date && isNaN(Date.parse(body.date))) {
    return c.json({ error: 'Invalid date' }, 400)
  }
  if (body.period_start && isNaN(Date.parse(body.period_start))) {
    return c.json({ error: 'Invalid period_start' }, 400)
  }
  if (body.period_end && isNaN(Date.parse(body.period_end))) {
    return c.json({ error: 'Invalid period_end' }, 400)
  }

  await updatePayment(c.env.DB, prefix, pid, body)
  return c.json({ success: true })
})

subscriptionRoutes.delete('/:id/payments/:pid', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = c.env.TABLE_PREFIX || ''
  const id = c.req.param('id')
  const pid = c.req.param('pid')

  const sub = await getSubscription(c.env.DB, prefix, id)
  if (!sub || sub.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const payment = await getPayment(c.env.DB, prefix, pid)
  if (!payment || payment.subscription_id !== id) {
    return c.json({ error: 'Payment not found' }, 404)
  }

  await deletePayment(c.env.DB, prefix, pid)

  // Only roll back expiry if this was the latest payment
  if (payment.period_start) {
    const remaining = await listPaymentsBySubscription(c.env.DB, prefix, id)
    const hasLaterPayment = remaining.some((p) => p.period_end && p.period_end > (payment.period_start as string))
    if (!hasLaterPayment) {
      await updateSubscription(c.env.DB, prefix, id, { expiry_date: payment.period_start })
    }
  }

  return c.json({ success: true })
})
