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
  env: Env
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

    try {
      const result = await sender(channelConfig, message, env)
      results.push({ channel, ...result })
    } catch (err) {
      results.push({ channel, success: false, error: err instanceof Error ? err.message : String(err) })
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
