import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { getTablePrefix } from '../types'
import type { HonoEnv } from '../types'
import { verifyJWT } from '../core/auth'
import { findUserById } from '../db/queries/users'

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  const token = getCookie(c, 'access_token')

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET)
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  const blacklisted = await c.env.KV.get(`bl:${payload.jti}`)
  if (blacklisted) {
    return c.json({ error: 'Token revoked' }, 401)
  }

  c.set('userId', payload.sub)
  c.set('role', payload.role)

  if (payload.needs_2fa_setup) {
    const path = new URL(c.req.url).pathname
    const allowed2faPaths = ['/api/me', '/api/auth/2fa/totp/', '/api/auth/2fa/passkey/', '/api/auth/logout']
    if (!allowed2faPaths.some((p) => path.startsWith(p) || path === p.replace(/\/$/, ''))) {
      return c.json({ error: '2FA setup required', needs2faSetup: true }, 403)
    }
  }

  // Handle admin impersonation
  const impersonateHeader = c.req.header('X-Impersonate-User')
  if (impersonateHeader && payload.role === 'admin') {
    const prefix = getTablePrefix(c.env)
    const targetUser = await findUserById(c.env.DB, prefix, impersonateHeader)
    if (!targetUser) {
      return c.json({ error: 'Impersonation target not found' }, 404)
    }
    c.set('impersonating', impersonateHeader)
  }

  await next()
}

export function getEffectiveUserId(c: Context<HonoEnv>): string {
  return c.get('impersonating') || c.get('userId')
}
