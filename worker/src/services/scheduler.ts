import { getTablePrefix } from '../types'
import type { Env, Item } from '../types'
import { listActiveUsersForScheduler } from '../db/queries/users'
import { getActiveItemsByUser } from '../db/queries/items'
import { getNotificationConfig } from '../db/queries/notifications'
import { createPayment } from '../db/queries/payments'
import { sendNotifications, type NotifyMessage } from './notify/index'
import { addPeriod, nowISO, diffInHours, diffInDays, nowInTimezone } from '../core/time'
import { addLunarMonths, addLunarYears, solarToLunar } from '../core/lunar'
import { generateId } from '../core/auth'

export async function handleScheduled(env: Env): Promise<void> {
  const prefix = getTablePrefix(env)
  const db = env.DB
  const kv = env.KV

  const activeUsers = await listActiveUsersForScheduler(db, prefix)

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

    const lang = user.language || 'en'
    for (const sub of subscriptions) {
      // Per-item notification_hours override (same pattern as channels)
      let itemHours: number[] = []
      try { itemHours = JSON.parse(sub.notification_hours || '[]') } catch { itemHours = [] }
      const effectiveHours = itemHours.length > 0 ? itemHours : allowedHours

      if (effectiveHours.length > 0 && !effectiveHours.includes(currentHour)) continue

      await processSubscription(env, prefix, user.id, sub, notifyConfig, kv, lang, user.timezone || 'UTC')
    }

    await kv.put(`scheduler_status:${user.id}`, JSON.stringify({
      lastRun: nowISO(),
      subscriptionsChecked: subscriptions.length,
    }), { expirationTtl: 86400 * 7 })
  } catch (err) {
    console.error(`Scheduler error for user ${user.id}:`, err)
  }
}


function lunarLabel(solarDate: string): string | null {
  const [y, m, d] = solarDate.split('-').map(Number)
  const lunar = solarToLunar(y, m, d)
  if (!lunar) return null
  return `${lunar.monthStr}${lunar.dayStr}`
}

function formatUserTime(timezone: string): string {
  const d = nowInTimezone(timezone)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${day} ${h}:${mi}`
}

async function processSubscription(
  env: Env,
  prefix: string,
  userId: string,
  sub: Item,
  notifyConfig: any,
  kv: KVNamespace,
  lang: string,
  timezone: string
): Promise<void> {
  const now = new Date()
  const nowISOStr = nowISO()

  // ── Auto-renew logic ────────────────────────────────────────────────────
  const expiryDate = new Date(sub.expiry_date)

  if (expiryDate <= now && sub.auto_renew) {
    if (!sub.period_value || sub.period_value <= 0) return

    const renewDedupeKey = `renew_dedupe:${userId}:${sub.id}`
    const alreadyRenewed = await kv.get(renewDedupeKey)
    if (alreadyRenewed) return

    let prevExpiry = sub.expiry_date
    let newExpiry = prevExpiry
    let newLunarExpiry = sub.lunar_expiry_date ?? sub.expiry_date
    let iterations = 0
    const maxIterations = 1000

    while (new Date(newExpiry) <= now && iterations < maxIterations) {
      prevExpiry = newExpiry
      if (sub.calendar_mode === 'both') {
        const nextSolar = addPeriod(newExpiry, sub.period_value, sub.period_unit)
        const nextLunar = sub.period_unit === 'month'
          ? addLunarMonths(newLunarExpiry, sub.period_value)
          : sub.period_unit === 'year'
            ? addLunarYears(newLunarExpiry, sub.period_value)
            : addPeriod(newLunarExpiry, sub.period_value, sub.period_unit)
        newLunarExpiry = nextLunar
        newExpiry = nextSolar <= nextLunar ? nextSolar : nextLunar
      } else if (sub.calendar_mode === 'lunar' && sub.period_unit === 'month') {
        newExpiry = addLunarMonths(prevExpiry, sub.period_value)
      } else if (sub.calendar_mode === 'lunar' && sub.period_unit === 'year') {
        newExpiry = addLunarYears(prevExpiry, sub.period_value)
      } else {
        newExpiry = addPeriod(prevExpiry, sub.period_value, sub.period_unit)
      }
      if (newExpiry === prevExpiry) return
      iterations++
    }

    const renewedAt = nowISOStr

    if (sub.calendar_mode === 'both') {
      await env.DB.prepare(
        `UPDATE ${prefix}items SET expiry_date = ?, lunar_expiry_date = ?, last_payment_date = ?, updated_at = ? WHERE id = ?`
      ).bind(newExpiry, newLunarExpiry, renewedAt, renewedAt, sub.id).run()
    } else {
      await env.DB.prepare(
        `UPDATE ${prefix}items SET expiry_date = ?, last_payment_date = ?, updated_at = ? WHERE id = ?`
      ).bind(newExpiry, renewedAt, renewedAt, sub.id).run()
    }

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

  // ── Reminder logic ──────────────────────────────────────────────────────
  // For 'both' mode, we check both solar and lunar expiry dates independently
  const checkDates: { date: string; label: 'solar' | 'lunar' }[] = []

  if (sub.calendar_mode === 'both') {
    checkDates.push({ date: sub.expiry_date, label: 'solar' })
    if (sub.lunar_expiry_date) {
      checkDates.push({ date: sub.lunar_expiry_date, label: 'lunar' })
    }
  } else if (sub.calendar_mode === 'lunar') {
    // For lunar-only, the expiry_date is already stored as solar,
    // but the date was computed using lunar arithmetic.
    // We treat the stored expiry_date as the primary date.
    checkDates.push({ date: sub.expiry_date, label: 'solar' })
  } else {
    // solar mode
    checkDates.push({ date: sub.expiry_date, label: 'solar' })
  }

  // Filter channels if item has specific channels configured
  let itemChannels: string[] | undefined
  try { itemChannels = JSON.parse(sub.channels || '[]') } catch { itemChannels = [] }
  const channels = itemChannels?.length ? itemChannels : undefined

  for (const { date: checkDate, label } of checkDates) {
    const hoursUntil = diffInHours(nowISOStr, checkDate)
    const daysUntil = diffInDays(nowISOStr, checkDate)

    let shouldNotify = false
    if (sub.reminder_unit === 'hour') {
      shouldNotify = hoursUntil <= sub.reminder_value && hoursUntil > 0
    } else {
      shouldNotify = daysUntil <= sub.reminder_value && daysUntil > 0
    }

    if (!shouldNotify) continue

    // Dedup: include label in key so solar and lunar reminders are deduplicated independently
    // If they happen on the same day, the hour-bucket dedup will naturally merge them
    const hourBucket = Math.floor(now.getTime() / 3600000)
    const dedupeKey = `notify_dedupe:${userId}:${sub.id}:${label}:${hourBucket}`
    const existing = await kv.get(dedupeKey)
    if (existing) continue

    const isBoth = sub.calendar_mode === 'both'
    const lunarSuffix = label === 'lunar'
      ? (lang === 'zh' ? ' (农历)' : ' (Lunar)')
      : (isBoth ? (lang === 'zh' ? ' (阳历)' : ' (Solar)') : '')

    const sentAt = formatUserTime(timezone)
    const lunarStr = sub.calendar_mode !== 'solar' ? lunarLabel(checkDate) : null

    let message: NotifyMessage
    if (lang === 'zh') {
      const modeLabel = sub.item_mode === 'cycle' ? '周期' : '重置'
      const autoRenewLabel = sub.auto_renew ? '是' : '否'
      const timeLabel = sub.reminder_unit === 'hour'
        ? `将在 ${Math.round(hoursUntil)} 小时后到期`
        : `将在 ${Math.round(daysUntil)} 天后到期`
      const lines = [
        `名称：${sub.name}`,
        `模式：${modeLabel}`,
      ]
      if (isBoth && label === 'lunar' && lunarStr) {
        lines.push(`农历到期：${lunarStr}`)
        lines.push(`对应阳历：${checkDate}`)
      } else if (isBoth && label === 'solar') {
        lines.push(`阳历到期：${checkDate}`)
        if (lunarStr) lines.push(`对应农历：${lunarStr}`)
      } else {
        lines.push(`到期日期：${checkDate}`)
        if (lunarStr) lines.push(`农历日期：${lunarStr}`)
      }
      lines.push(`自动续期：${autoRenewLabel}`)
      if (sub.notes) lines.push(`备注：${sub.notes}`)
      lines.push(``, timeLabel, `发送时间：${sentAt}`, `当前时区：${timezone}`)
      message = { title: `📅 ${sub.name} 即将到期${lunarSuffix}`, body: lines.join('\n') }
    } else {
      const modeLabel = sub.item_mode === 'cycle' ? 'Cycle' : 'Reset'
      const autoRenewLabel = sub.auto_renew ? 'Yes' : 'No'
      const timeLabel = sub.reminder_unit === 'hour'
        ? `Expires in ${Math.round(hoursUntil)} hours`
        : `Expires in ${Math.round(daysUntil)} days`
      const lines = [
        `Name: ${sub.name}`,
        `Mode: ${modeLabel}`,
      ]
      if (isBoth && label === 'lunar' && lunarStr) {
        lines.push(`Lunar expiry: ${lunarStr}`)
        lines.push(`Solar equivalent: ${checkDate}`)
      } else if (isBoth && label === 'solar') {
        lines.push(`Solar expiry: ${checkDate}`)
        if (lunarStr) lines.push(`Lunar equivalent: ${lunarStr}`)
      } else {
        lines.push(`Expiry date: ${checkDate}`)
        if (lunarStr) lines.push(`Lunar date: ${lunarStr}`)
      }
      lines.push(`Auto-renew: ${autoRenewLabel}`)
      if (sub.notes) lines.push(`Notes: ${sub.notes}`)
      lines.push(``, timeLabel, `Sent at: ${sentAt}`, `Timezone: ${timezone}`)
      message = { title: `📅 ${sub.name} expiring soon${lunarSuffix}`, body: lines.join('\n') }
    }

    await sendNotifications(notifyConfig, message, env, {
      db: env.DB, prefix, userId, itemId: sub.id,
    }, channels)
    await kv.put(dedupeKey, '1', { expirationTtl: 172800 })
  }
}
