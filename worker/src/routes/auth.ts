import { Hono, type Context } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { getTablePrefix } from '../types'
import type { HonoEnv, JWTPayload } from '../types'
import { hashPassword, verifyPassword, signJWT, verifyJWT, generateId, generateJti } from '../core/auth'
import { createUser, findUserByEmail, countUsers, findUserById, updateUser } from '../db/queries/users'
import { upsertNotificationConfig } from '../db/queries/notifications'
import { getSetting } from '../db/queries/settings'
import { get2FAConfig } from '../db/queries/twofa'
import { getAvailable2FAMethods } from '../services/twofa'
import { sendEmail } from '../services/email'
import { rateLimit } from '../middleware/ratelimit'

export const authRoutes = new Hono<HonoEnv>()

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

authRoutes.use('/login', rateLimit({ max: 10, window: 300, keyPrefix: 'login' }))
authRoutes.use('/register', rateLimit({ max: 5, window: 300, keyPrefix: 'register' }))
authRoutes.use('/refresh', rateLimit({ max: 20, window: 300, keyPrefix: 'refresh' }))
authRoutes.use('/email/resend', rateLimit({ max: 3, window: 300, keyPrefix: 'email_resend' }))
authRoutes.use('/password/forgot', rateLimit({ max: 3, window: 300, keyPrefix: 'pwd_forgot' }))
authRoutes.use('/password/reset', rateLimit({ max: 5, window: 300, keyPrefix: 'pwd_reset' }))

authRoutes.post('/register', async (c) => {
  const prefix = getTablePrefix(c.env)
  const { email, password } = await c.req.json<{ email: string; password: string }>()

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400)
  }

  if (!EMAIL_RE.test(email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }

  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const registrationEnabled = await getSetting(c.env.DB, prefix, 'registration_enabled')
  if (registrationEnabled === 'false') {
    return c.json({ error: 'Registration is disabled' }, 403)
  }

  const existing = await findUserByEmail(c.env.DB, prefix, email)
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  const userCount = await countUsers(c.env.DB, prefix)
  let role = 'user'
  if (userCount === 0) {
    const lockAcquired = await c.env.KV.get('first_user_lock')
    if (!lockAcquired) {
      await c.env.KV.put('first_user_lock', '1', { expirationTtl: 60 })
      const recheck = await countUsers(c.env.DB, prefix)
      if (recheck === 0) role = 'admin'
    }
  }

  const id = generateId()
  const passwordHash = await hashPassword(password)

  await createUser(c.env.DB, prefix, { id, email, password_hash: passwordHash, role })
  await upsertNotificationConfig(c.env.DB, prefix, id, {})

  const emailVerificationEnabled = await getSetting(c.env.DB, prefix, 'email_verification_enabled')

  if (emailVerificationEnabled === 'true') {
    const verifyToken = generateId()
    await c.env.KV.put(`email_verify:${verifyToken}`, id, { expirationTtl: 86400 })

    await sendEmail(c.env, {
      to: email,
      subject: 'Verify your email - eNotify',
      html: `<p>Click <a href="${new URL(c.req.url).origin}/verify-email?token=${verifyToken}">here</a> to verify your email.</p>`,
    })

    return c.json({ success: true, requiresVerification: true })
  }

  await updateUser(c.env.DB, prefix, id, { email_verified: 1 })

  return c.json({ success: true, message: 'Registration successful' }, 201)
})

authRoutes.post('/login', async (c) => {
  const prefix = getTablePrefix(c.env)
  const { email, password } = await c.req.json<{ email: string; password: string }>()

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400)
  }

  const user = await findUserByEmail(c.env.DB, prefix, email)
  if (!user) {
    await verifyPassword(password, '0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000')
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  if (!user.is_active) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const emailVerificationEnabled = await getSetting(c.env.DB, prefix, 'email_verification_enabled')
  if (emailVerificationEnabled === '1' && !user.email_verified) {
    return c.json({ error: 'Email not verified', requiresVerification: true }, 403)
  }

  const require2FA = await getSetting(c.env.DB, prefix, 'require_2fa')
  if (require2FA === 'true') {
    const twoFAConfig = await get2FAConfig(c.env.DB, prefix, user.id)
    const methods = getAvailable2FAMethods(twoFAConfig)

    if (methods.length > 0) {
      const tempToken = generateId()
      await c.env.KV.put(`2fa:${tempToken}`, user.id, { expirationTtl: 300 })
      return c.json({ requires2fa: true, tempToken, availableMethods: methods })
    }

    await issueTokens(c, user.id, user.role, true)
    return c.json({
      success: true,
      needs2faSetup: true,
      user: { id: user.id, email: user.email, role: user.role },
    })
  }

  await issueTokens(c, user.id, user.role)
  return c.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role },
  })
})

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, 'access_token')
  if (token) {
    const payload = await verifyJWT(token, c.env.JWT_SECRET)
    if (payload) {
      const remaining = payload.exp - Math.floor(Date.now() / 1000)
      if (remaining > 0) {
        await c.env.KV.put(`bl:${payload.jti}`, '1', { expirationTtl: Math.max(remaining, 60) })
      }
    }
  }

  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (refreshTokenStr) {
    const payload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
    if (payload) {
      await c.env.KV.delete(`rt:${payload.jti}`)
      // Remove from session index
      if (payload.sub) {
        await removeSessionIndex(c.env.KV, payload.sub, payload.jti)
      }
    }
  }

  deleteCookie(c, 'access_token', { path: '/' })
  deleteCookie(c, 'refresh_token', { path: '/' })

  return c.json({ success: true })
})

authRoutes.post('/refresh', async (c) => {
  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (!refreshTokenStr) {
    return c.json({ error: 'No refresh token' }, 401)
  }

  const payload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
  if (!payload) {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }

  const stored = await c.env.KV.get(`rt:${payload.jti}`)
  if (!stored) {
    return c.json({ error: 'Refresh token revoked' }, 401)
  }

  await c.env.KV.delete(`rt:${payload.jti}`)

  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, payload.sub)
  if (!user || !user.is_active) {
    return c.json({ error: 'User not found or disabled' }, 401)
  }

  await issueTokens(c, user.id, user.role)
  return c.json({ success: true })
})

authRoutes.post('/email/verify', async (c) => {
  const { token } = await c.req.json<{ token: string }>()
  if (!token) return c.json({ error: 'Token required' }, 400)

  const userId = await c.env.KV.get(`email_verify:${token}`)
  if (!userId) return c.json({ error: 'Invalid or expired token' }, 400)

  const prefix = getTablePrefix(c.env)
  await updateUser(c.env.DB, prefix, userId, { email_verified: 1 })
  await c.env.KV.delete(`email_verify:${token}`)

  return c.json({ success: true })
})

authRoutes.post('/email/resend', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  if (!email) return c.json({ error: 'Email required' }, 400)

  const prefix = getTablePrefix(c.env)
  const user = await findUserByEmail(c.env.DB, prefix, email)
  if (!user) return c.json({ success: true }) // Don't reveal whether email exists

  if (user.email_verified || !user.is_active) return c.json({ success: true })

  const verifyToken = generateId()
  await c.env.KV.put(`email_verify:${verifyToken}`, user.id, { expirationTtl: 86400 })

  await sendEmail(c.env, {
    to: email,
    subject: 'Verify your email - eNotify',
    html: `<p>Click <a href="${new URL(c.req.url).origin}/verify-email?token=${verifyToken}">here</a> to verify your email.</p>`,
  })

  return c.json({ success: true })
})

authRoutes.post('/password/forgot', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  if (!email) return c.json({ error: 'Email required' }, 400)

  // Per-email cooldown: 60s between resend
  // Check & set cooldown before user lookup to avoid email enumeration
  const cooldownKey = `pwd_reset_cd:${email}`
  const onCooldown = await c.env.KV.get(cooldownKey)
  if (onCooldown) {
    return c.json({ success: true })
  }
  await c.env.KV.put(cooldownKey, '1', { expirationTtl: 60 })

  const prefix = getTablePrefix(c.env)
  const user = await findUserByEmail(c.env.DB, prefix, email)

  // Always return success to avoid email enumeration
  if (!user || !user.is_active) return c.json({ success: true })

  const code = String(Math.floor(100000 + Math.random() * 900000))
  await c.env.KV.put(`pwd_reset:${user.id}`, code, { expirationTtl: 900 }) // 15 min

  const appName = 'eNotify'
  await sendEmail(c.env, {
    to: email,
    subject: `Reset your password - ${appName}`,
    html: `<p>Your password reset code is: <strong>${code}</strong></p><p>This code expires in 15 minutes.</p>`,
  })

  return c.json({ success: true })
})

authRoutes.post('/password/reset', async (c) => {
  const { email, code, new_password } = await c.req.json<{ email: string; code: string; new_password: string }>()

  if (!email || !code || !new_password) {
    return c.json({ error: 'Email, code and new password required' }, 400)
  }
  if (new_password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const prefix = getTablePrefix(c.env)
  const user = await findUserByEmail(c.env.DB, prefix, email)
  if (!user || !user.is_active) {
    return c.json({ error: 'Invalid or expired code' }, 400)
  }

  const stored = await c.env.KV.get(`pwd_reset:${user.id}`)
  if (!stored || stored !== code) {
    return c.json({ error: 'Invalid or expired code' }, 400)
  }

  await c.env.KV.delete(`pwd_reset:${user.id}`)
  const passwordHash = await hashPassword(new_password)
  await updateUser(c.env.DB, prefix, user.id, { password_hash: passwordHash })

  return c.json({ success: true })
})

async function issueTokens(c: Context<HonoEnv>, userId: string, role: string, needs2faSetup = false) {
  const now = Math.floor(Date.now() / 1000)
  const accessJti = generateJti()
  const refreshJti = generateJti()

  const accessPayload: JWTPayload = {
    sub: userId,
    role,
    jti: accessJti,
    iat: now,
    exp: now + 86400, // 24h
    ...(needs2faSetup ? { needs_2fa_setup: true } : {}),
  }

  const refreshPayload: JWTPayload = {
    sub: userId,
    role,
    jti: refreshJti,
    iat: now,
    exp: now + 604800, // 7d
  }

  const accessToken = await signJWT(accessPayload, c.env.JWT_SECRET)
  const refreshTokenStr = await signJWT(refreshPayload, c.env.JWT_SECRET)

  await c.env.KV.put(`rt:${refreshJti}`, userId, { expirationTtl: 604800 })

  // Track session in KV index
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ua = c.req.header('user-agent') || 'unknown'
  await addSessionIndex(c.env.KV, userId, { jti: refreshJti, iat: now, exp: now + 604800, ip, ua })

  setCookie(c, 'access_token', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 86400,
  })

  setCookie(c, 'refresh_token', refreshTokenStr, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 604800,
  })
}

// ── Session index helpers ──────────────────────────────────────────────────

interface SessionEntry {
  jti: string
  iat: number
  exp: number
  ip?: string
  ua?: string
}

export async function addSessionIndex(kv: KVNamespace, userId: string, entry: SessionEntry): Promise<void> {
  const key = `sessions:${userId}`
  const raw = await kv.get(key)
  const sessions: SessionEntry[] = raw ? JSON.parse(raw) : []
  sessions.push(entry)
  // TTL matches refresh token lifetime
  await kv.put(key, JSON.stringify(sessions), { expirationTtl: 604800 })
}

export async function removeSessionIndex(kv: KVNamespace, userId: string, jti: string): Promise<void> {
  const key = `sessions:${userId}`
  const raw = await kv.get(key)
  if (!raw) return
  const sessions: SessionEntry[] = JSON.parse(raw)
  const filtered = sessions.filter(s => s.jti !== jti)
  if (filtered.length === 0) {
    await kv.delete(key)
  } else {
    await kv.put(key, JSON.stringify(filtered), { expirationTtl: 604800 })
  }
}

export async function getSessionIndex(kv: KVNamespace, userId: string): Promise<SessionEntry[]> {
  const key = `sessions:${userId}`
  const raw = await kv.get(key)
  if (!raw) return []
  const sessions: SessionEntry[] = JSON.parse(raw)
  const now = Math.floor(Date.now() / 1000)
  // Filter out expired entries
  return sessions.filter(s => s.exp > now)
}
