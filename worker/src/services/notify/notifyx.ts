import type { NotifyMessage } from './index'
import type { Env } from '../../types'

interface NotifyXConfig {
  api_key: string
}

export async function sendNotifyX(configJson: string, message: NotifyMessage, _env: Env): Promise<{ success: boolean; error?: string }> {
  const config: NotifyXConfig = JSON.parse(configJson)
  if (!config.api_key) {
    return { success: false, error: 'NotifyX API key required' }
  }

  const response = await fetch('https://notifyx.imshan.com/api/notification', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.api_key,
    },
    body: JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return { success: false, error: `NotifyX error: ${err}` }
  }

  return { success: true }
}
