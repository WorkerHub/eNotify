import { getTablePrefix } from '../types'
import type { Env, Item } from '../types'
import { listUsers } from '../db/queries/users'
import { getActiveItemsByUser } from '../db/queries/items'
import { getNotificationConfig } from '../db/queries/notifications'
import { createPayment } from '../db/queries/payments'
import { sendNotifications, type NotifyMessage } from './notify/index'
import { addPeriod, nowISO, diffInHours, diffInDays, nowInTimezone } from '../core/time'
import { addLunarMonths, addLunarYears } from '../core/lunar'
import { generateId } from '../core/auth'

export async function handleScheduled(env: Env): Promise<void> {
  const prefix = getTablePrefix(env)
  const db = env.DB
  const kv = env.KV

  const users = await listUsers(db, prefix)
  const activeUsers = users.filter(u => u.is_active)

  const BATCH_SIZE = 10
  for (let i = 0; i < activeUsers.length; i += BATCH_SIZE) {
    const batch = activeUsers.slice(i, i + BATCH_SIZE)
    await Promise.allSettled(batch.map(user => processUser(env, prefix, db, kv, user)))
  }
}

async function processUser(env: Env, prefix: string, db: D1Database, kv: KVNamespace, user: { id: string; timezone?: string; language?: string }): Promise<void> {
  try {
    const subscriptions = await getActiveItemsByUser(db, prefix, user.id)
    const notifyConfig = await getNotificationConfig(db, prefix, user.id)

    if (!notifyConfig) return

    const allowedHours: number[] = JSON.parse(notifyConfig.notification_hours || '[]')
    const userTime = nowInTimezone(user.timezone || 'UTC')
    const currentHour = userTime.getHours()

    if (allowedHours.length > 0 && !allowedHours.includes(currentHour)) return

    const lang = user.language || 'en'
    for (const sub of subscriptions) {
      await processSubscription(env, prefix, user.id, sub, notifyConfig, kv, lang)
    }

    await kv.put(`scheduler_status:${user.id}`, JSON.stringify({
      lastRun: nowISO(),
      subscriptionsChecked: subscriptions.length,
    }), { expirationTtl: 86400 * 7 })
  } catch (err) {
    console.error(`Scheduler error for user ${user.id}:`, err)
  }
}

async function processSubscription(
  env: Env,
  prefix: string,
  userId: string,
  sub: Item,
  notifyConfig: any,
  kv: KVNamespace,
  lang: string
): Promise<void> {
  const now = new Date()
  const expiryDate = new Date(sub.expiry_date)

  if (expiryDate <= now && sub.auto_renew) {
    if (!sub.period_value || sub.period_value <= 0) return

    const renewDedupeKey = `renew_dedupe:${userId}:${sub.id}`
    const alreadyRenewed = await kv.get(renewDedupeKey)
    if (alreadyRenewed) return

    let prevExpiry = sub.expiry_date
    let newExpiry = prevExpiry
    let iterations = 0
    const maxIterations = 1000

    while (new Date(newExpiry) <= now && iterations < maxIterations) {
      prevExpiry = newExpiry
      if (sub.use_lunar && sub.period_unit === 'month') {
        newExpiry = addLunarMonths(prevExpiry, sub.period_value)
      } else if (sub.use_lunar && sub.period_unit === 'year') {
        newExpiry = addLunarYears(prevExpiry, sub.period_value)
      } else {
        newExpiry = addPeriod(prevExpiry, sub.period_value, sub.period_unit)
      }
      if (newExpiry === prevExpiry) return
      iterations++
    }

    const renewedAt = nowISO()

    await env.DB.prepare(
      `UPDATE ${prefix}items SET expiry_date = ?, last_payment_date = ?, updated_at = ? WHERE id = ?`
    ).bind(newExpiry, renewedAt, renewedAt, sub.id).run()

    if (sub.amount) {
      await createPayment(env.DB, prefix, {
        id: generateId(),
        item_id: sub.id,
        user_id: userId,
        date: renewedAt,
        amount: sub.amount,
        currency: sub.currency,
        type: 'auto',
        note: 'Auto-renewal',
        period_start: prevExpiry,
        period_end: newExpiry,
      })
    }

    await kv.put(renewDedupeKey, '1', { expirationTtl: 3600 })

    return
  }

  const hoursUntilExpiry = diffInHours(nowISO(), sub.expiry_date)
  const daysUntilExpiry = diffInDays(nowISO(), sub.expiry_date)

  let shouldNotify = false
  if (sub.reminder_unit === 'hour') {
    shouldNotify = hoursUntilExpiry <= sub.reminder_value && hoursUntilExpiry > 0
  } else {
    shouldNotify = daysUntilExpiry <= sub.reminder_value && daysUntilExpiry > 0
  }

  if (!shouldNotify) return

  const hourBucket = Math.floor(now.getTime() / 3600000)
  const dedupeKey = `notify_dedupe:${userId}:${sub.id}:${hourBucket}`
  const existing = await kv.get(dedupeKey)
  if (existing) return

  const message: NotifyMessage = lang === 'zh'
    ? {
        title: `📅 ${sub.name} 即将到期`,
        body: sub.reminder_unit === 'hour'
          ? `将在 ${Math.round(hoursUntilExpiry)} 小时后到期 (${sub.expiry_date})`
          : `将在 ${Math.round(daysUntilExpiry)} 天后到期 (${sub.expiry_date})`,
      }
    : {
        title: `📅 ${sub.name} expiring soon`,
        body: sub.reminder_unit === 'hour'
          ? `Expires in ${Math.round(hoursUntilExpiry)} hours (${sub.expiry_date})`
          : `Expires in ${Math.round(daysUntilExpiry)} days (${sub.expiry_date})`,
      }

  await sendNotifications(notifyConfig, message, env)
  await kv.put(dedupeKey, '1', { expirationTtl: 172800 })
}
