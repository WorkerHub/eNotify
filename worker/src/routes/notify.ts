import { Hono } from 'hono'
import { getTablePrefix } from '../types'
import type { Env } from '../types'
import { getNotificationConfig } from '../db/queries/notifications'
import { findUserById } from '../db/queries/users'
import { sendNotifications, type NotifyMessage } from '../services/notify/index'
import { rateLimit } from '../middleware/ratelimit'

type HonoEnv = { Bindings: Env; Variables: Record<string, any> }

export const notifyRoutes = new Hono<HonoEnv>()

notifyRoutes.use('/:token', rateLimit({ max: 30, window: 60, keyPrefix: 'notify_trigger' }))

// Third-party trigger — authenticate via token in URL, header, or query param
notifyRoutes.post('/:token', async (c) => {
  const token = c.req.param('token')
  const prefix = getTablePrefix(c.env)

  // Find user by their third-party API token stored in notification_configs
  // Token format: userId:secret stored in KV
  const userId = await c.env.KV.get(`notify_token:${token}`)
  if (!userId) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user || !user.is_active) {
    return c.json({ error: 'User not found or disabled' }, 401)
  }

  const notifyConfig = await getNotificationConfig(c.env.DB, prefix, userId)
  if (!notifyConfig) {
    return c.json({ error: 'No notification channels configured' }, 400)
  }

  const body = await c.req.json<{ title?: string; body?: string; url?: string }>()

  const message: NotifyMessage = {
    title: body.title || 'Notification',
    body: body.body || '',
    url: body.url,
  }

  const results = await sendNotifications(notifyConfig, message, c.env)
  return c.json({ success: true, results })
})
