import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Env, HonoEnv } from './types'
import { getTablePrefix } from './types'
import { authRoutes } from './routes/auth'
import { auth2faRoutes } from './routes/auth2fa'
import { meRoutes } from './routes/me'
import { itemRoutes } from './routes/items'
import { dashboardRoutes } from './routes/dashboard'
import { adminRoutes } from './routes/admin'
import { notifyRoutes } from './routes/notify'
import { setupRoutes } from './routes/setup'
import { handleScheduled } from './services/scheduler'
import { getAllSettings } from './db/queries/settings'

const app = new Hono<HonoEnv>()

app.use('*', logger())
app.use('*', async (c, next) => {
  const prefix = c.env.TABLE_PREFIX || ''
  if (prefix && !/^[a-zA-Z0-9_]+$/.test(prefix)) {
    return c.json({ error: 'Invalid TABLE_PREFIX configuration' }, 500)
  }
  await next()
})
app.use('/api/*', cors({
  origin: (origin, c) => {
    if (!origin) return ''
    const url = new URL(c.req.url)
    return origin === url.origin ? origin : ''
  },
  credentials: true,
}))

app.route('/api/auth', authRoutes)
app.route('/api/auth/2fa', auth2faRoutes)
app.route('/api/me', meRoutes)
app.route('/api/items', itemRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/notify', notifyRoutes)
app.route('/api/setup', setupRoutes)

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.get('/api/system/info', async (c) => {
  const prefix = getTablePrefix(c.env)
  try {
    const settings = await getAllSettings(c.env.DB, prefix)
    return c.json({
      app_name: settings.app_name || 'eNotify',
      version: '1.0.0',
      registration_enabled: settings.registration_enabled !== 'false',
    })
  } catch {
    return c.json({ app_name: 'eNotify', version: '1.0.0', registration_enabled: true })
  }
})

// SPA fallback: serve static assets, fall back to index.html for client-side routing
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw)
  if (res.status !== 404) return res
  return c.env.ASSETS.fetch(new Request(new URL('/', c.req.url), c.req.raw))
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env))
  },
}
