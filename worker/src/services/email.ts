import { getTablePrefix } from '../types'
import type { Env } from '../types'
import { getSetting } from '../db/queries/settings'
import { connect } from 'cloudflare:sockets'

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && !email.includes('\r') && !email.includes('\n')
}

interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
  fromName?: string
}

interface SMTPConfig {
  host: string
  port: number
  username: string
  password: string
  from: string
  from_name: string
  secure: boolean
}

interface ResendConfig {
  api_key: string
  from: string
  from_name: string
}

export async function sendEmail(env: Env, options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  if (!isValidEmail(options.to)) {
    return { success: false, error: 'Invalid recipient email address' }
  }

  const prefix = getTablePrefix(env)
  const provider = await getSetting(env.DB, prefix, 'email_provider')

  if (!provider || provider === 'none') {
    return { success: false, error: 'No email provider configured' }
  }

  if (provider === 'resend') {
    return sendViaResend(env, options)
  }

  if (provider === 'smtp') {
    return sendViaSMTP(env, options)
  }

  return { success: false, error: `Unknown email provider: ${provider}` }
}

async function sendViaResend(env: Env, options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const prefix = getTablePrefix(env)
  const configStr = await getSetting(env.DB, prefix, 'resend_config')
  if (!configStr) return { success: false, error: 'Resend not configured' }

  const config: ResendConfig = JSON.parse(configStr)
  if (!config.api_key) return { success: false, error: 'Resend API key not configured' }

  const from = options.from || config.from || 'noreply@example.com'
  const fromName = (options.fromName || config.from_name || 'eNotify').replace(/[\r\n]/g, '')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${from}>`,
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return { success: false, error: `Resend error: ${err}` }
  }

  return { success: true }
}

async function sendViaSMTP(env: Env, options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const prefix = getTablePrefix(env)
  const configStr = await getSetting(env.DB, prefix, 'smtp_config')
  if (!configStr) return { success: false, error: 'SMTP not configured' }

  const config: SMTPConfig = JSON.parse(configStr)
  if (!config.host) return { success: false, error: 'SMTP host not configured' }

  const from = options.from || config.from || 'noreply@example.com'
  const fromName = (options.fromName || config.from_name || 'eNotify').replace(/[\r\n]/g, '')

  try {
    const socket = connect({ hostname: config.host, port: config.port }, { secureTransport: config.secure ? 'on' : 'starttls', allowHalfOpen: false })

    const writer = socket.writable.getWriter()
    const reader = socket.readable.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    let buffer = ''

    const readResponse = async (): Promise<string> => {
      while (true) {
        const { value } = await reader.read()
        if (!value) return buffer
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\r\n')
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]
          if (line.length >= 4 && line[3] === ' ') {
            buffer = lines.slice(i + 1).join('\r\n')
            return line
          }
        }
        buffer = lines[lines.length - 1]
      }
    }

    const expectCode = async (expected: string): Promise<void> => {
      const line = await readResponse()
      if (!line.startsWith(expected)) {
        throw new Error(`Expected ${expected}, got: ${line.trim()}`)
      }
    }

    const writeLine = async (line: string): Promise<void> => {
      await writer.write(encoder.encode(line + '\r\n'))
    }

    await expectCode('220')
    await writeLine(`EHLO localhost`)
    await expectCode('250')

    if (config.username && config.password) {
      await writeLine('AUTH LOGIN')
      await expectCode('334')
      await writeLine(btoa(config.username))
      await expectCode('334')
      await writeLine(btoa(config.password))
      await expectCode('235')
    }

    await writeLine(`MAIL FROM:<${from}>`)
    await expectCode('250')
    await writeLine(`RCPT TO:<${options.to}>`)
    await expectCode('250')
    await writeLine('DATA')
    await expectCode('354')

    const dotStuffedHtml = options.html.replace(/^\./gm, '..').replace(/\r?\n/g, '\r\n')

    const sanitizedSubject = options.subject.replace(/[\r\n]/g, ' ')
    const encodedSubject = /^[\x20-\x7E]*$/.test(sanitizedSubject)
      ? sanitizedSubject
      : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(sanitizedSubject)))}?=`

    const message = [
      `From: ${fromName} <${from}>`,
      `To: ${options.to}`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      '',
      dotStuffedHtml,
      '.',
    ].join('\r\n')

    await writeLine(message)
    await expectCode('250')
    await writeLine('QUIT')

    await writer.close()
    await socket.close()

    return { success: true }
  } catch (err) {
    return { success: false, error: `SMTP error: ${err instanceof Error ? err.message : String(err)}` }
  }
}
