import { Hono } from 'hono'
import { getTablePrefix, VALID_CHANNELS } from '../types'
import type { HonoEnv, JWTPayload } from '../types'
import { authMiddleware, getEffectiveUserId } from '../middleware/auth'
import { rateLimit } from '../middleware/ratelimit'
import { findUserById, updateUser } from '../db/queries/users'
import { getNotificationConfig, upsertNotificationConfig } from '../db/queries/notifications'
import { insertNotificationHistory, listNotificationHistory } from '../db/queries/notification-history'
import { get2FAConfig } from '../db/queries/twofa'
import { hashPassword, verifyPassword, generateJti, signJWT, verifyJWT } from '../core/auth'
import { getSessionIndex, removeSessionIndex, addSessionIndex } from './auth'
import { sendToChannel, type NotifyMessage } from '../services/notify/index'
import { getCookie, setCookie } from 'hono/cookie'

export const meRoutes = new Hono<HonoEnv>()

meRoutes.use('*', authMiddleware)
meRoutes.use('/password', rateLimit({ max: 5, window: 300, keyPrefix: 'pwd_change' }))

meRoutes.get('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const twoFA = await get2FAConfig(c.env.DB, prefix, userId)

  return c.json({
    id: user.id,
    email: user.email,
    role: user.role,
    email_verified: !!user.email_verified,
    base_currency: user.base_currency,
    timezone: user.timezone,
    language: user.language,
    theme: user.theme,
    created_at: user.created_at,
    twofa: {
      totp_enabled: !!twoFA?.totp_enabled,
      passkey_enabled: !!twoFA?.passkey_enabled,
      email_otp_enabled: !!twoFA?.email_otp_enabled,
      preferred_method: twoFA?.preferred_method || null,
    },
  })
})

meRoutes.put('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const body = await c.req.json<{ base_currency?: string; timezone?: string; language?: string; theme?: string }>()

  const updates: Record<string, any> = {}
  if (body.base_currency) updates.base_currency = body.base_currency
  if (body.timezone) updates.timezone = body.timezone
  if (body.language) updates.language = body.language
  if (body.theme && ['light', 'dark', 'system'].includes(body.theme)) updates.theme = body.theme
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  await updateUser(c.env.DB, prefix, userId, updates)
  return c.json({ success: true })
})

meRoutes.put('/password', async (c) => {
  const userId = c.get('userId') // Can't change password via impersonation
  const prefix = getTablePrefix(c.env)
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword: string; newPassword: string }>()

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'Current and new password required' }, 400)
  }

  if (newPassword.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const valid = await verifyPassword(currentPassword, user.password_hash)
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 401)

  const hash = await hashPassword(newPassword)
  await updateUser(c.env.DB, prefix, userId, { password_hash: hash })

  // Invalidate current access token
  const accessTokenStr = getCookie(c, 'access_token')
  if (accessTokenStr) {
    const payload = await verifyJWT(accessTokenStr, c.env.JWT_SECRET)
    if (payload) {
      const remaining = payload.exp - Math.floor(Date.now() / 1000)
      if (remaining > 0) {
        await c.env.KV.put(`bl:${payload.jti}`, '1', { expirationTtl: Math.max(remaining, 60) })
      }
    }
  }

  // Invalidate current refresh token
  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (refreshTokenStr) {
    const rtPayload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
    if (rtPayload) {
      await c.env.KV.delete(`rt:${rtPayload.jti}`)
      await removeSessionIndex(c.env.KV, userId, rtPayload.jti)
    }
  }

  // Issue new tokens
  const now = Math.floor(Date.now() / 1000)
  const newAccessJti = generateJti()
  const newRefreshJti = generateJti()

  const accessPayload: JWTPayload = { sub: userId, role: user.role, jti: newAccessJti, iat: now, exp: now + 86400 }
  const refreshPayload: JWTPayload = { sub: userId, role: user.role, jti: newRefreshJti, iat: now, exp: now + 604800 }

  const newAccessToken = await signJWT(accessPayload, c.env.JWT_SECRET)
  const newRefreshToken = await signJWT(refreshPayload, c.env.JWT_SECRET)

  await c.env.KV.put(`rt:${newRefreshJti}`, userId, { expirationTtl: 604800 })
  // Track new session in KV index
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ua = c.req.header('user-agent') || 'unknown'
  await addSessionIndex(c.env.KV, userId, { jti: newRefreshJti, iat: now, exp: now + 604800, ip, ua })

  setCookie(c, 'access_token', newAccessToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 86400 })
  setCookie(c, 'refresh_token', newRefreshToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 604800 })

  return c.json({ success: true })
})

meRoutes.get('/notifications', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)

  const config = await getNotificationConfig(c.env.DB, prefix, userId)
  if (!config) {
    return c.json({ enabled_channels: [], notification_hours: [] })
  }

  // Redact sensitive fields - return configured flags instead
  const safeConfig: Record<string, any> = {
    enabled_channels: (() => { try { return JSON.parse(config.enabled_channels) } catch { return [] } })(),
    notification_hours: (() => { try { return JSON.parse(config.notification_hours) } catch { return [] } })(),
  }

  const channels = VALID_CHANNELS
  for (const ch of channels) {
    const key = `${ch}_config` as keyof typeof config
    const raw = config[key] as string
    let parsed: Record<string, any>
    try { parsed = JSON.parse(raw || '{}') } catch { parsed = {} }
    safeConfig[`${ch}_configured`] = Object.entries(parsed).some(([_k, v]) => v !== '' && v !== null && v !== undefined && typeof v === 'string' && v.length > 0)
    // Return non-sensitive fields only
    const redacted: Record<string, any> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (['token', 'bot_token', 'api_key', 'sendkey', 'app_token', 'password', 'device_key'].some(s => k.includes(s))) {
        redacted[k] = v ? '••••••' : ''
      } else {
        redacted[k] = v
      }
    }
    safeConfig[`${ch}_config`] = redacted
  }

  return c.json(safeConfig)
})

meRoutes.put('/notifications', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const body = await c.req.json()

  const updates: Record<string, any> = {}

  if (body.enabled_channels !== undefined) {
    if (!Array.isArray(body.enabled_channels)) return c.json({ error: 'enabled_channels must be an array' }, 400)
    const validChannels = VALID_CHANNELS
    if (body.enabled_channels.some((ch: string) => !validChannels.includes(ch))) {
      return c.json({ error: 'Invalid channel name' }, 400)
    }
    updates.enabled_channels = JSON.stringify(body.enabled_channels)
  }
  if (body.notification_hours !== undefined) {
    if (!Array.isArray(body.notification_hours)) return c.json({ error: 'notification_hours must be an array' }, 400)
    if (body.notification_hours.some((h: any) => !Number.isInteger(h) || h < 0 || h > 23)) {
      return c.json({ error: 'notification_hours must contain integers 0-23' }, 400)
    }
    updates.notification_hours = JSON.stringify(body.notification_hours)
  }

  const channels = VALID_CHANNELS
  const existing = await getNotificationConfig(c.env.DB, prefix, userId)
  for (const ch of channels) {
    if (body[`${ch}_config`]) {
      const existingConfig = existing ? JSON.parse((existing as any)[`${ch}_config`] || '{}') : {}
      const newConfig = body[`${ch}_config`]

      const secretFields = ['token', 'bot_token', 'api_key', 'sendkey', 'app_token', 'password', 'device_key']
      for (const [k, v] of Object.entries(newConfig)) {
        if (secretFields.some(s => k.includes(s)) && (!v || v === '••••••')) {
          newConfig[k] = existingConfig[k] || ''
        }
      }

      updates[`${ch}_config`] = JSON.stringify(newConfig)
    }
  }

  await upsertNotificationConfig(c.env.DB, prefix, userId, updates)
  return c.json({ success: true })
})

meRoutes.post('/notifications/test', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const { channel } = await c.req.json<{ channel: string }>()

  if (!channel) return c.json({ error: 'Channel required' }, 400)

  const validChannels = VALID_CHANNELS
  if (!validChannels.includes(channel)) return c.json({ error: 'Invalid channel' }, 400)

  const config = await getNotificationConfig(c.env.DB, prefix, userId)
  if (!config) return c.json({ error: 'Notification not configured' }, 400)

  const configKey = `${channel}_config` as keyof typeof config
  const channelConfig = config[configKey] as string

  const message: NotifyMessage = {
    title: '🔔 eNotify Test',
    body: 'This is a test notification from eNotify.',
  }

  const result = await sendToChannel(channel, channelConfig, message, c.env)

  try {
    await insertNotificationHistory(c.env.DB, prefix, {
      id: generateJti(),
      user_id: userId,
      channel,
      title: message.title,
      success: result.success,
      error: result.error,
    })
  } catch (err) {
    console.error('Failed to insert notification history:', err)
  }

  return c.json(result)
})

meRoutes.get('/notification-history', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const limit = Math.min(Number(c.req.query('limit') || 50), 200)
  const history = await listNotificationHistory(c.env.DB, prefix, userId, limit)
  return c.json(history)
})

meRoutes.post('/notifications/token', async (c) => {
  const userId = getEffectiveUserId(c)
  const token = generateJti()
  await c.env.KV.put(`notify_token:${token}`, userId, { expirationTtl: 31536000 })
  return c.json({ token })
})

meRoutes.delete('/notifications/token/:token', async (c) => {
  const userId = getEffectiveUserId(c)
  const token = c.req.param('token')
  const owner = await c.env.KV.get(`notify_token:${token}`)
  if (owner !== userId) return c.json({ error: 'Not found' }, 404)
  await c.env.KV.delete(`notify_token:${token}`)
  return c.json({ success: true })
})

// ── Sessions ──────────────────────────────────────────────────────────────

meRoutes.get('/sessions', async (c) => {
  const userId = c.get('userId') // Use real user, not impersonated
  const sessions = await getSessionIndex(c.env.KV, userId)

  // Identify current session from refresh token
  let currentJti: string | undefined
  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (refreshTokenStr) {
    const payload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
    if (payload) currentJti = payload.jti
  }

  // Verify each session's refresh token still exists in KV (may have been revoked)
  const validSessions = []
  for (const s of sessions) {
    const exists = await c.env.KV.get(`rt:${s.jti}`)
    if (exists) {
      validSessions.push({
        jti: s.jti,
        iat: s.iat,
        exp: s.exp,
        ip: s.ip,
        ua: s.ua,
        current: s.jti === currentJti,
      })
    }
  }

  // Clean up stale entries from the index
  const validJtis = new Set(validSessions.map(s => s.jti))
  const staleJtis = sessions.filter(s => !validJtis.has(s.jti))
  if (staleJtis.length > 0) {
    const key = `sessions:${userId}`
    const remaining = sessions.filter(s => validJtis.has(s.jti))
    if (remaining.length === 0) {
      await c.env.KV.delete(key)
    } else {
      await c.env.KV.put(key, JSON.stringify(remaining), { expirationTtl: 604800 })
    }
  }

  return c.json(validSessions)
})

meRoutes.delete('/sessions/:jti', async (c) => {
  const userId = c.get('userId')
  const jti = c.req.param('jti')

  // Don't allow revoking current session via this endpoint (use logout instead)
  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (refreshTokenStr) {
    const payload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
    if (payload && payload.jti === jti) {
      return c.json({ error: 'Use logout to end current session' }, 400)
    }
  }

  // Verify the session belongs to this user
  const sessions = await getSessionIndex(c.env.KV, userId)
  const target = sessions.find(s => s.jti === jti)
  if (!target) return c.json({ error: 'Session not found' }, 404)

  // Revoke: delete refresh token from KV
  await c.env.KV.delete(`rt:${jti}`)

  // Blacklist the access token associated with this session
  const now = Math.floor(Date.now() / 1000)
  const remaining = target.exp - now
  if (remaining > 0) {
    await c.env.KV.put(`bl:${jti}`, '1', { expirationTtl: Math.min(remaining, 86400) })
  }

  // Remove from session index
  await removeSessionIndex(c.env.KV, userId, jti)

  return c.json({ success: true })
})
