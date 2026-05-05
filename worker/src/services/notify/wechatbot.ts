import type { NotifyMessage } from './index'
import type { Env } from '../../types'

interface WechatBotConfig {
  webhook: string
  msg_type?: string
  at_mobiles?: string[]
  at_all?: boolean
}

export async function sendWechatBot(configJson: string, message: NotifyMessage, _env: Env): Promise<{ success: boolean; error?: string }> {
  const config: WechatBotConfig = JSON.parse(configJson)
  if (!config.webhook) {
    return { success: false, error: 'WeChat Bot webhook URL required' }
  }

  const msgType = config.msg_type || 'markdown'
  let body: Record<string, unknown>

  if (msgType === 'markdown') {
    let content = `## ${message.title}\n\n${message.body}`
    if (config.at_mobiles?.length) {
      content += '\n\n' + config.at_mobiles.map((m) => `<@${m}>`).join(' ')
    }
    body = { msgtype: 'markdown', markdown: { content } }
  } else {
    let content = `${message.title}\n\n${message.body}`
    const mentionedList: string[] = config.at_all ? ['@all'] : (config.at_mobiles || [])
    body = { msgtype: 'text', text: { content, mentioned_mobile_list: mentionedList } }
  }

  const response = await fetch(config.webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    return { success: false, error: `WeChat Bot error: ${err}` }
  }

  return { success: true }
}
