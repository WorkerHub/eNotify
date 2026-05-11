import type { Context, Next } from 'hono'
import type { Env } from '../types'

type HonoEnv = { Bindings: Env; Variables: Record<string, any> }

export function rateLimit(opts: { max: number; window: number; keyPrefix: string }) {
  return async (c: Context<HonoEnv>, next: Next) => {
    const forwarded = c.req.header('x-forwarded-for')
    const ip = c.req.header('cf-connecting-ip') || (forwarded ? forwarded.split(',')[0].trim() : '') || 'unknown'
    const key = `rl:${opts.keyPrefix}:${ip}`

    const current = await c.env.KV.get(key)
    const count = current ? parseInt(current.split(':')[0], 10) : 0

    if (count >= opts.max) {
      return c.json({ error: 'Too many requests' }, 429)
    }

    const now = Math.floor(Date.now() / 1000)
    if (count === 0) {
      const expiresAt = now + opts.window
      await c.env.KV.put(key, `1:${expiresAt}`, { expirationTtl: Math.max(opts.window, 60) })
    } else {
      const parts = (current || '').split(':')
      const expiresAt = parts.length >= 2 ? parseInt(parts[1], 10) : now + opts.window
      const remainingTtl = Math.max(expiresAt - now, 60)
      await c.env.KV.put(key, `${count + 1}:${expiresAt}`, { expirationTtl: remainingTtl })
    }
    await next()
  }
}
