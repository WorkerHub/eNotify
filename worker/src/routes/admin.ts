import { Hono } from 'hono'
import { getTablePrefix } from '../types'
import type { HonoEnv } from '../types'
import { authMiddleware } from '../middleware/auth'
import { adminMiddleware } from '../middleware/admin'
import { listUsers, findUserById, findUserByEmail, createUser, updateUser, deleteUser } from '../db/queries/users'
import { listSubscriptionsByUser, createSubscription, updateSubscription, deleteSubscription, getSubscription } from '../db/queries/subscriptions'
import { getAllSettings, setSetting } from '../db/queries/settings'
import { upsertNotificationConfig } from '../db/queries/notifications'
import { generateId, hashPassword } from '../core/auth'

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

export const adminRoutes = new Hono<HonoEnv>()

adminRoutes.use('*', authMiddleware)
adminRoutes.use('*', adminMiddleware)

// User management
adminRoutes.post('/users', async (c) => {
  const prefix = getTablePrefix(c.env)
  const body = await c.req.json<{ email: string; password: string; role?: string }>()

  if (!body.email || !body.password) return c.json({ error: 'Email and password required' }, 400)
  if (!EMAIL_RE.test(body.email)) return c.json({ error: 'Invalid email format' }, 400)
  if (body.password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)

  const existing = await findUserByEmail(c.env.DB, prefix, body.email)
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const id = generateId()
  const passwordHash = await hashPassword(body.password)
  const role = body.role === 'admin' ? 'admin' : 'user'

  await createUser(c.env.DB, prefix, { id, email: body.email, password_hash: passwordHash, role })
  await upsertNotificationConfig(c.env.DB, prefix, id, {})
  await updateUser(c.env.DB, prefix, id, { email_verified: 1 })

  const user = await findUserById(c.env.DB, prefix, id)
  return c.json({
    id: user!.id,
    email: user!.email,
    role: user!.role,
    is_active: !!user!.is_active,
    email_verified: !!user!.email_verified,
    created_at: user!.created_at,
  }, 201)
})

adminRoutes.get('/users', async (c) => {
  const prefix = getTablePrefix(c.env)
  const users = await listUsers(c.env.DB, prefix)
  return c.json(users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    is_active: !!u.is_active,
    email_verified: !!u.email_verified,
    created_at: u.created_at,
  })))
})

adminRoutes.get('/users/:uid', async (c) => {
  const prefix = getTablePrefix(c.env)
  const uid = c.req.param('uid')
  const user = await findUserById(c.env.DB, prefix, uid)
  if (!user) return c.json({ error: 'User not found' }, 404)

  return c.json({
    id: user.id,
    email: user.email,
    role: user.role,
    is_active: !!user.is_active,
    email_verified: !!user.email_verified,
    base_currency: user.base_currency,
    timezone: user.timezone,
    language: user.language,
    theme: user.theme,
    created_at: user.created_at,
  })
})

adminRoutes.put('/users/:uid', async (c) => {
  const prefix = getTablePrefix(c.env)
  const uid = c.req.param('uid')
  const body = await c.req.json<{ role?: string; is_active?: number; email?: string; password?: string }>()

  const user = await findUserById(c.env.DB, prefix, uid)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const updates: Record<string, any> = {}
  if (body.role !== undefined && ['admin', 'user'].includes(body.role)) updates.role = body.role
  if (body.is_active !== undefined) updates.is_active = body.is_active ? 1 : 0
  if (body.email !== undefined) {
    if (!EMAIL_RE.test(body.email)) return c.json({ error: 'Invalid email format' }, 400)
    const existing = await findUserByEmail(c.env.DB, prefix, body.email)
    if (existing && existing.id !== uid) return c.json({ error: 'Email already in use' }, 409)
    updates.email = body.email
  }
  if (body.password !== undefined) {
    if (body.password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
    updates.password_hash = await hashPassword(body.password)
  }

  await updateUser(c.env.DB, prefix, uid, updates)
  return c.json({ success: true })
})

adminRoutes.delete('/users/:uid', async (c) => {
  const prefix = getTablePrefix(c.env)
  const uid = c.req.param('uid')
  const currentUserId = c.get('userId')

  if (uid === currentUserId) {
    return c.json({ error: 'Cannot delete yourself' }, 400)
  }

  const user = await findUserById(c.env.DB, prefix, uid)
  if (!user) return c.json({ error: 'User not found' }, 404)

  await deleteUser(c.env.DB, prefix, uid)
  return c.json({ success: true })
})

// Admin manage user subscriptions
adminRoutes.get('/users/:uid/subscriptions', async (c) => {
  const prefix = getTablePrefix(c.env)
  const uid = c.req.param('uid')

  const user = await findUserById(c.env.DB, prefix, uid)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const subs = await listSubscriptionsByUser(c.env.DB, prefix, uid)
  return c.json(subs)
})

adminRoutes.post('/users/:uid/subscriptions', async (c) => {
  const prefix = getTablePrefix(c.env)
  const uid = c.req.param('uid')

  const user = await findUserById(c.env.DB, prefix, uid)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const body = await c.req.json()

  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Subscription name is required' }, 400)
  }
  if (!body.expiry_date || isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: 'Valid expiry date is required' }, 400)
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
  if (body.amount !== undefined && body.amount !== null && (typeof body.amount !== 'number' || body.amount < 0)) {
    return c.json({ error: 'Amount must be a non-negative number' }, 400)
  }

  const id = generateId()
  await createSubscription(c.env.DB, prefix, {
    id,
    user_id: uid,
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
  })

  return c.json({ id }, 201)
})

adminRoutes.put('/users/:uid/subscriptions/:sid', async (c) => {
  const prefix = getTablePrefix(c.env)
  const uid = c.req.param('uid')
  const sid = c.req.param('sid')
  const body = await c.req.json()

  const sub = await getSubscription(c.env.DB, prefix, sid)
  if (!sub || sub.user_id !== uid) return c.json({ error: 'Not found' }, 404)

  if (body.period_value !== undefined && (typeof body.period_value !== 'number' || body.period_value < 1)) {
    return c.json({ error: 'Period value must be >= 1' }, 400)
  }
  if (body.expiry_date && isNaN(Date.parse(body.expiry_date))) {
    return c.json({ error: 'Invalid expiry date' }, 400)
  }
  if (body.period_unit && !['day', 'month', 'year'].includes(body.period_unit)) {
    return c.json({ error: 'Invalid period unit' }, 400)
  }
  if (body.reminder_unit && !['day', 'hour'].includes(body.reminder_unit)) {
    return c.json({ error: 'Invalid reminder unit' }, 400)
  }
  if (body.amount !== undefined && body.amount !== null && typeof body.amount !== 'number') {
    return c.json({ error: 'Amount must be a number' }, 400)
  }

  await updateSubscription(c.env.DB, prefix, sid, body)
  return c.json({ success: true })
})

adminRoutes.delete('/users/:uid/subscriptions/:sid', async (c) => {
  const prefix = getTablePrefix(c.env)
  const uid = c.req.param('uid')
  const sid = c.req.param('sid')

  const sub = await getSubscription(c.env.DB, prefix, sid)
  if (!sub || sub.user_id !== uid) return c.json({ error: 'Not found' }, 404)

  await deleteSubscription(c.env.DB, prefix, sid)
  return c.json({ success: true })
})

// System settings
adminRoutes.get('/system/settings', async (c) => {
  const prefix = getTablePrefix(c.env)
  const settings = await getAllSettings(c.env.DB, prefix)

  // Redact sensitive values
  const safe = { ...settings }
  if (safe.smtp_config) {
    try {
      const smtp = JSON.parse(safe.smtp_config)
      if (smtp.password) smtp.password = '••••••'
      safe.smtp_config = JSON.stringify(smtp)
    } catch { /* ignore malformed */ }
  }
  if (safe.resend_config) {
    try {
      const resend = JSON.parse(safe.resend_config)
      if (resend.api_key) resend.api_key = '••••••'
      safe.resend_config = JSON.stringify(resend)
    } catch { /* ignore malformed */ }
  }

  return c.json(safe)
})

adminRoutes.put('/system/settings', async (c) => {
  const prefix = getTablePrefix(c.env)
  const body = await c.req.json<Record<string, string>>()

  const allowedKeys = [
    'email_verification_enabled', 'require_2fa', 'registration_enabled',
    'smtp_config', 'resend_config', 'email_provider',
  ]

  const existingSettings = await getAllSettings(c.env.DB, prefix)

  for (const [key, value] of Object.entries(body)) {
    if (!allowedKeys.includes(key)) continue

    // Don't overwrite secrets with redacted values
    if (key === 'smtp_config') {
      let newConfig: Record<string, any>
      try { newConfig = JSON.parse(value) } catch { continue }
      if (!newConfig.password) {
        let existingSmtp: Record<string, any> = {}
        try { existingSmtp = existingSettings.smtp_config ? JSON.parse(existingSettings.smtp_config) : {} } catch { /* */ }
        newConfig.password = existingSmtp.password || ''
      }
      await setSetting(c.env.DB, prefix, key, JSON.stringify(newConfig))
    } else if (key === 'resend_config') {
      let newConfig: Record<string, any>
      try { newConfig = JSON.parse(value) } catch { continue }
      if (!newConfig.api_key) {
        let existingResend: Record<string, any> = {}
        try { existingResend = existingSettings.resend_config ? JSON.parse(existingSettings.resend_config) : {} } catch { /* */ }
        newConfig.api_key = existingResend.api_key || ''
      }
      await setSetting(c.env.DB, prefix, key, JSON.stringify(newConfig))
    } else {
      await setSetting(c.env.DB, prefix, key, value)
    }
  }

  return c.json({ success: true })
})
