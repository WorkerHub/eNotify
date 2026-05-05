import type { Env, User2FA } from '../types'
import { get2FAConfig, upsert2FAConfig } from '../db/queries/twofa'
import { sendEmail } from './email'

export async function generateTOTPSecret(email: string): Promise<{ secret: string; uri: string }> {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  const secret = base32Encode(bytes)
  const uri = `otpauth://totp/enotify:${encodeURIComponent(email)}?secret=${secret}&issuer=enotify&algorithm=SHA1&digits=6&period=30`
  return { secret, uri }
}

export async function verifyTOTPAsync(secret: string, code: string, env?: Env, userId?: string): Promise<boolean> {
  const time = Math.floor(Date.now() / 1000 / 30)
  for (let i = -1; i <= 1; i++) {
    const expected = await generateTOTPCodeAsync(secret, time + i)
    if (expected === code) {
      if (env && userId) {
        const usedKey = `totp_used:${userId}:${code}`
        const used = await env.KV.get(usedKey)
        if (used) return false
        await env.KV.put(usedKey, '1', { expirationTtl: 90 })
      }
      return true
    }
  }
  return false
}

async function generateTOTPCodeAsync(secret: string, counter: number): Promise<string> {
  const key = base32Decode(secret)
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setBigUint64(0, BigInt(counter))

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, buffer)
  const hash = new Uint8Array(signature)

  const offset = hash[hash.length - 1] & 0x0f
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)

  const otp = binary % 1000000
  return otp.toString().padStart(6, '0')
}

export async function generateEmailOTP(env: Env, userId: string, sessionId?: string): Promise<string> {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  const code = (100000 + (buf[0] % 900000)).toString()
  const key = sessionId ? `otp:${userId}:${sessionId}` : `otp:${userId}`
  await env.KV.put(key, code, { expirationTtl: 300 })
  return code
}

export async function verifyEmailOTP(env: Env, userId: string, code: string, sessionId?: string): Promise<boolean> {
  const key = sessionId ? `otp:${userId}:${sessionId}` : `otp:${userId}`
  const stored = await env.KV.get(key)
  if (!stored || stored !== code) return false
  await env.KV.delete(key)
  return true
}

export async function sendOTPEmail(env: Env, email: string, code: string, language: string): Promise<void> {
  const subject = language === 'zh' ? 'eNotify 验证码' : 'eNotify Verification Code'
  const html = language === 'zh'
    ? `<p>您的验证码是：<strong>${code}</strong></p><p>有效期 5 分钟。</p>`
    : `<p>Your verification code is: <strong>${code}</strong></p><p>Valid for 5 minutes.</p>`

  await sendEmail(env, { to: email, subject, html })
}

export function getAvailable2FAMethods(config: User2FA | null): string[] {
  if (!config) return []
  const methods: string[] = []
  if (config.totp_enabled) methods.push('totp')
  if (config.passkey_enabled) methods.push('passkey')
  if (config.email_otp_enabled) methods.push('email_otp')
  return methods
}

// Base32 encode/decode utilities
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(data: Uint8Array): string {
  let result = ''
  let bits = 0
  let value = 0

  for (const byte of data) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += BASE32_CHARS[(value >>> bits) & 0x1f]
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f]
  }

  return result
}

function base32Decode(encoded: string): ArrayBuffer {
  const cleaned = encoded.replace(/[=\s]/g, '').toUpperCase()
  const bytes: number[] = []
  let bits = 0
  let value = 0

  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }

  return new Uint8Array(bytes).buffer
}
