import type { NotificationConfig } from '../../types'
import { sendTelegram } from './telegram'
import { sendWebhook } from './webhook'
import { sendWechatBot } from './wechatbot'
import { sendBark } from './bark'
import { sendGotify } from './gotify'
import { sendServerChan } from './serverchan'
import { sendPushPlus } from './pushplus'
import { sendNotifyX } from './notifyx'
import { sendNotifyEmail } from './email-notify'
import type { Env } from '../../types'
import { insertNotificationHistory } from '../../db/queries/notification_history'
import { generateId } from '../../core/auth'

export interface NotifyMessage {
  title: string
  body: string
  url?: string
}

export interface NotifyResult {
  channel: string
  success: boolean
  error?: string
}

export interface NotifyContext {
  db: D1Database
  prefix: string
  userId: string
  itemId?: string | null
}

const CHANNEL_SENDERS: Record<string, (config: string, message: NotifyMessage, env: Env) => Promise<{ success: boolean; error?: string }>> = {
  telegram: sendTelegram,
  webhook: sendWebhook,
  wechatbot: sendWechatBot,
  email: sendNotifyEmail,
  bark: sendBark,
  gotify: sendGotify,
  serverchan: sendServerChan,
  pushplus: sendPushPlus,
  notifyx: sendNotifyX,
}

export async function sendNotifications(
  config: NotificationConfig,
  message: NotifyMessage,
  env: Env,
  context?: NotifyContext
): Promise<NotifyResult[]> {
  const enabledChannels: string[] = JSON.parse(config.enabled_channels || '[]')
  const results: NotifyResult[] = []

  for (const channel of enabledChannels) {
    const sender = CHANNEL_SENDERS[channel]
    if (!sender) {
      results.push({ channel, success: false, error: 'Unknown channel' })
      continue
    }

    const configKey = `${channel}_config` as keyof NotificationConfig
    const channelConfig = config[configKey] as string || '{}'

    let result: { success: boolean; error?: string }
    try {
      result = await sender(channelConfig, message, env)
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    results.push({ channel, ...result })

    if (context) {
      insertNotificationHistory(context.db, context.prefix, {
        id: generateId(),
        user_id: context.userId,
        item_id: context.itemId,
        channel,
        title: message.title,
        success: result.success,
        error: result.error,
      }).catch(() => {})
    }
  }

  return results
}

export async function sendToChannel(
  channel: string,
  configJson: string,
  message: NotifyMessage,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const sender = CHANNEL_SENDERS[channel]
  if (!sender) return { success: false, error: 'Unknown channel' }
  try {
    return await sender(configJson, message, env)
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
