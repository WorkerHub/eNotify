import type { NotifyMessage } from './index'
import type { Env } from '../../types'

interface GotifyConfig {
  server_url: string
  app_token: string
}

export async function sendGotify(configJson: string, message: NotifyMessage, _env: Env): Promise<{ success: boolean; error?: string }> {
  const config: GotifyConfig = JSON.parse(configJson)
  if (!config.server_url || !config.app_token) {
    return { success: false, error: 'Gotify server URL and app token required' }
  }

  const url = `${config.server_url.replace(/\/$/, '')}/message?token=${config.app_token}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: message.title,
      message: message.body,
      extras: { 'client::notification': { click: { url: message.url } } },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return { success: false, error: `Gotify error: ${err}` }
  }

  return { success: true }
}
