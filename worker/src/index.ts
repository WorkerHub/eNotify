import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Env, HonoEnv } from './types'
import { authRoutes } from './routes/auth'
import { auth2faRoutes } from './routes/auth2fa'
import { meRoutes } from './routes/me'
import { subscriptionRoutes } from './routes/subscriptions'
import { dashboardRoutes } from './routes/dashboard'
import { adminRoutes } from './routes/admin'
import { notifyRoutes } from './routes/notify'
import { setupRoutes } from './routes/setup'
import { handleScheduled } from './services/scheduler'

const app = new Hono<HonoEnv>()

app.use('*', logger())
app.use('*', async (c, next) => {
  const prefix = c.env.TABLE_PREFIX || ''
  if (prefix && !/^[a-z0-9_]+$/.test(prefix)) {
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
app.route('/api/subscriptions', subscriptionRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/notify', notifyRoutes)
app.route('/api/setup', setupRoutes)

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env))
  },
}
