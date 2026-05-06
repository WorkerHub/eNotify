import { Hono } from 'hono'
import { getTablePrefix, VALID_CHANNELS } from '../types'
import type { Item, HonoEnv } from '../types'
import { authMiddleware, getEffectiveUserId } from '../middleware/auth'
import {
  createItem, getItem, listItemsByUser,
  updateItem, deleteItem, toggleItemStatus
} from '../db/queries/items'
import { createPayment, listPaymentsByItem, updatePayment, deletePayment, getPayment } from '../db/queries/payments'
import { getNotificationConfig } from '../db/queries/notifications'
import { generateId } from '../core/auth'
import { nowISO, addPeriod } from '../core/time'
import { sendNotifications, type NotifyMessage } from '../services/notify/index'

export const itemRoutes = new Hono<HonoEnv>()

itemRoutes.use('*', authMiddleware)

itemRoutes.get('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const items = await listItemsByUser(c.env.DB, prefix, userId)
  return c.json(items)
})

itemRoutes.post('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const body = await c.req.json()

  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Name is required' }, 400)
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
  if (body.item_mode && !['cycle', 'reset'].includes(body.item_mode)) {
    return c.json({ error: 'Invalid item mode' }, 400)
  }
  if (body.amount !== undefined && body.amount !== null && (typeof body.amount !== 'number' || body.amount < 0)) {
    return c.json({ error: 'Amount must be a non-negative number' }, 400)
  }
  const validChannels = VALID_CHANNELS
  if (body.channels !== undefined && !Array.isArray(body.channels)) {
    return c.json({ error: 'channels must be an array' }, 400)
  }
  if (body.channels && body.channels.some((ch: string) => !validChannels.includes(ch))) {
    return c.json({ error: 'Invalid channel name' }, 400)
  }

  const id = generateId()
  const now = nowISO()

  const item: Omit<Item, 'created_at' | 'updated_at'> = {
    id,
    user_id: userId,
    name: body.name,
    item_mode: body.item_mode || 'cycle',
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
    channels: JSON.stringify(body.channels || []),
  }

  await createItem(c.env.DB, prefix, item)

  if (item.amount && item.start_date) {
    await createPayment(c.env.DB, prefix, {
      id: generateId(),
      item_id: id,
      user_id: userId,
      date: item.start_date || now,
      amount: item.amount,
      currency: item.currency,
      type: 'initial',
      note: '',
      period_start: item.start_date,
      period_end: item.expiry_date,
    })
  }

  return c.json(item, 201)
})

itemRoutes.get('/:id', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  return c.json(item)
})

itemRoutes.put('/:id', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
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
  if (body.item_mode && !['cycle', 'reset'].includes(body.item_mode)) {
    return c.json({ error: 'Invalid item mode' }, 400)
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
  const validChannels = VALID_CHANNELS
  if (body.channels !== undefined) {
    if (!Array.isArray(body.channels)) {
      return c.json({ error: 'channels must be an array' }, 400)
    }
    if (body.channels.some((ch: string) => !validChannels.includes(ch))) {
      return c.json({ error: 'Invalid channel name' }, 400)
    }
  }

  const updates: Record<string, any> = {}
  const allowedFields = [
    'name', 'item_mode', 'custom_type', 'category', 'start_date',
    'expiry_date', 'period_value', 'period_unit', 'reminder_unit', 'reminder_value',
    'notes', 'amount', 'currency', 'is_active', 'auto_renew', 'use_lunar',
  ]
  for (const key of allowedFields) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  // channels is stored as JSON string
  if (body.channels !== undefined) updates.channels = JSON.stringify(body.channels)

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  await updateItem(c.env.DB, prefix, id, updates)
  return c.json({ success: true })
})

itemRoutes.delete('/:id', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  await deleteItem(c.env.DB, prefix, id)
  return c.json({ success: true })
})

itemRoutes.post('/:id/toggle-status', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  await toggleItemStatus(c.env.DB, prefix, id)
  return c.json({ success: true, is_active: item.is_active ? 0 : 1 })
})

itemRoutes.post('/:id/renew', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json<{ amount?: number; date?: string; multiplier?: number; note?: string }>()
  const multiplier = Math.min(Math.max(body.multiplier || 1, 1), 120)
  let newExpiry = item.expiry_date

  for (let i = 0; i < multiplier; i++) {
    newExpiry = addPeriod(newExpiry, item.period_value, item.period_unit)
  }

  const paymentDate = body.date || nowISO()
  const paymentAmount = body.amount ?? item.amount ?? 0

  await updateItem(c.env.DB, prefix, id, {
    expiry_date: newExpiry,
    last_payment_date: paymentDate,
  })

  await createPayment(c.env.DB, prefix, {
    id: generateId(),
    item_id: id,
    user_id: userId,
    date: paymentDate,
    amount: paymentAmount,
    currency: item.currency,
    type: 'manual',
    note: body.note || '',
    period_start: item.expiry_date,
    period_end: newExpiry,
  })

  return c.json({ success: true, new_expiry_date: newExpiry })
})

itemRoutes.post('/:id/test-notify', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const notifyConfig = await getNotificationConfig(c.env.DB, prefix, userId)
  if (!notifyConfig) {
    return c.json({ error: 'No notification channels configured' }, 400)
  }

  const message: NotifyMessage = {
    title: `🔔 ${item.name} - Test Notification`,
    body: `This is a test notification for "${item.name}" expiring on ${item.expiry_date}.`,
  }

  // Filter channels if item has specific channels configured
  let itemChannels: string[] | undefined
  try { itemChannels = JSON.parse(item.channels || '[]') } catch { itemChannels = [] }

  const results = await sendNotifications(notifyConfig, message, c.env, {
    db: c.env.DB, prefix, userId, itemId: id,
  }, itemChannels?.length ? itemChannels : undefined)
  return c.json({ results })
})

// Payment history
itemRoutes.get('/:id/payments', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const payments = await listPaymentsByItem(c.env.DB, prefix, id)
  return c.json(payments)
})

itemRoutes.put('/:id/payments/:pid', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')
  const pid = c.req.param('pid')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const payment = await getPayment(c.env.DB, prefix, pid)
  if (!payment || payment.item_id !== id) {
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

itemRoutes.delete('/:id/payments/:pid', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const id = c.req.param('id')
  const pid = c.req.param('pid')

  const item = await getItem(c.env.DB, prefix, id)
  if (!item || item.user_id !== userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const payment = await getPayment(c.env.DB, prefix, pid)
  if (!payment || payment.item_id !== id) {
    return c.json({ error: 'Payment not found' }, 404)
  }

  await deletePayment(c.env.DB, prefix, pid)

  if (payment.period_start) {
    const remaining = await listPaymentsByItem(c.env.DB, prefix, id)
    const hasLaterPayment = remaining.some((p) => p.period_end && p.period_end > (payment.period_start as string))
    if (!hasLaterPayment) {
      await updateItem(c.env.DB, prefix, id, { expiry_date: payment.period_start })
    }
  }

  return c.json({ success: true })
})
