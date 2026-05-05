import type { Context, Next } from 'hono'
import type { HonoEnv } from '../types'

export async function adminMiddleware(c: Context<HonoEnv>, next: Next) {
  const role = c.get('role')
  if (role !== 'admin') {
    return c.json({ error: 'Forbidden: admin access required' }, 403)
  }
  await next()
}
