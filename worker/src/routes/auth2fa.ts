import { Hono } from 'hono'
import type { HonoEnv, JWTPayload } from '../types'
import { authMiddleware } from '../middleware/auth'
import { get2FAConfig, upsert2FAConfig } from '../db/queries/twofa'
import { findUserById } from '../db/queries/users'

interface StoredCredential { id: string; publicKey: string; counter: number }
import { generateTOTPSecret, verifyTOTPAsync, generateEmailOTP, verifyEmailOTP, sendOTPEmail } from '../services/twofa'
import { verifyJWT, signJWT, generateId, generateJti } from '../core/auth'
import { setCookie } from 'hono/cookie'
import { rateLimit } from '../middleware/ratelimit'

export const auth2faRoutes = new Hono<HonoEnv>()

auth2faRoutes.use('/verify', rateLimit({ max: 5, window: 300, keyPrefix: '2fa' }))
auth2faRoutes.use('/otp/send', rateLimit({ max: 3, window: 300, keyPrefix: '2fa-otp' }))

// Verify 2FA during login (no auth middleware - uses tempToken)
auth2faRoutes.post('/verify', async (c) => {
  const { tempToken, method, code } = await c.req.json<{ tempToken: string; method: string; code: string }>()

  if (!tempToken || !method || !code) {
    return c.json({ error: 'tempToken, method, and code required' }, 400)
  }

  const userId = await c.env.KV.get(`2fa:${tempToken}`)
  if (!userId) {
    return c.json({ error: 'Invalid or expired 2FA session' }, 401)
  }

  const prefix = c.env.TABLE_PREFIX || ''
  const config = await get2FAConfig(c.env.DB, prefix, userId)
  if (!config) {
    return c.json({ error: '2FA not configured' }, 400)
  }

  let verified = false

  if (method === 'totp' && config.totp_enabled && config.totp_secret) {
    verified = await verifyTOTPAsync(config.totp_secret, code, c.env, userId)
  } else if (method === 'email_otp' && config.email_otp_enabled) {
    verified = await verifyEmailOTP(c.env, userId, code, tempToken)
  } else if (method === 'passkey') {
    // Passkey verification handled separately via WebAuthn flow
    return c.json({ error: 'Use passkey authenticate endpoint' }, 400)
  } else {
    return c.json({ error: 'Invalid 2FA method' }, 400)
  }

  if (!verified) {
    return c.json({ error: 'Invalid verification code' }, 401)
  }

  await c.env.KV.delete(`2fa:${tempToken}`)

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)
  if (!user.is_active) return c.json({ error: 'Account is disabled' }, 403)

  // Issue tokens
  const now = Math.floor(Date.now() / 1000)
  const accessJti = generateJti()
  const refreshJti = generateJti()

  const accessPayload: JWTPayload = { sub: userId, role: user.role, jti: accessJti, iat: now, exp: now + 86400 }
  const refreshPayload: JWTPayload = { sub: userId, role: user.role, jti: refreshJti, iat: now, exp: now + 604800 }

  const accessToken = await signJWT(accessPayload, c.env.JWT_SECRET)
  const refreshToken = await signJWT(refreshPayload, c.env.JWT_SECRET)

  await c.env.KV.put(`rt:${refreshJti}`, userId, { expirationTtl: 604800 })

  setCookie(c, 'access_token', accessToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 86400 })
  setCookie(c, 'refresh_token', refreshToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 604800 })

  return c.json({ success: true, user: { id: user.id, email: user.email, role: user.role } })
})

// Send email OTP for 2FA login
auth2faRoutes.post('/otp/send', async (c) => {
  const { tempToken } = await c.req.json<{ tempToken: string }>()
  if (!tempToken) return c.json({ error: 'tempToken required' }, 400)

  const userId = await c.env.KV.get(`2fa:${tempToken}`)
  if (!userId) return c.json({ error: 'Invalid session' }, 401)

  const prefix = c.env.TABLE_PREFIX || ''
  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const code = await generateEmailOTP(c.env, userId, tempToken)
  await sendOTPEmail(c.env, user.email, code, user.language)

  return c.json({ success: true })
})

// Protected routes below - require auth
auth2faRoutes.use('/totp/*', authMiddleware)
auth2faRoutes.use('/passkey/register/*', authMiddleware)

// TOTP setup
auth2faRoutes.get('/totp/setup', async (c) => {
  const userId = c.get('userId')
  const prefix = c.env.TABLE_PREFIX || ''
  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const { secret, uri } = await generateTOTPSecret(user.email)

  // Store secret temporarily in KV until user confirms with a valid code
  await c.env.KV.put(`totp_setup:${userId}`, secret, { expirationTtl: 600 })

  return c.json({ secret, uri })
})

// TOTP enable (verify setup code)
auth2faRoutes.post('/totp/enable', async (c) => {
  const userId = c.get('userId')
  const { code } = await c.req.json<{ code: string }>()
  if (!code) return c.json({ error: 'Code required' }, 400)

  const secret = await c.env.KV.get(`totp_setup:${userId}`)
  if (!secret) return c.json({ error: 'No pending TOTP setup' }, 400)

  const valid = await verifyTOTPAsync(secret, code, c.env, userId)
  if (!valid) return c.json({ error: 'Invalid code' }, 400)

  const prefix = c.env.TABLE_PREFIX || ''
  await upsert2FAConfig(c.env.DB, prefix, userId, {
    totp_secret: secret,
    totp_enabled: 1,
    email_otp_enabled: 1, // Enable email OTP as backup
  })

  await c.env.KV.delete(`totp_setup:${userId}`)

  return c.json({ success: true })
})

// TOTP delete
auth2faRoutes.delete('/totp', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const prefix = c.env.TABLE_PREFIX || ''

  await upsert2FAConfig(c.env.DB, prefix, userId, {
    totp_secret: null,
    totp_enabled: 0,
  })

  return c.json({ success: true })
})

// Passkey register options
auth2faRoutes.post('/passkey/register/options', async (c) => {
  const userId = c.get('userId')
  const prefix = c.env.TABLE_PREFIX || ''
  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const { generateRegistrationOptions } = await import('@simplewebauthn/server')

  const config = await get2FAConfig(c.env.DB, prefix, userId)
  const existingCredentials = config?.passkey_credentials ? JSON.parse(config.passkey_credentials) : []

  const options = await generateRegistrationOptions({
    rpName: 'enotify',
    rpID: new URL(c.req.url).hostname,
    userName: user.email,
    userDisplayName: user.email,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((cred: StoredCredential) => ({
      id: cred.id,
      type: 'public-key',
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  await c.env.KV.put(`passkey_challenge:${userId}`, options.challenge, { expirationTtl: 300 })

  return c.json(options)
})

// Passkey register verify
auth2faRoutes.post('/passkey/register/verify', async (c) => {
  const userId = c.get('userId')
  const prefix = c.env.TABLE_PREFIX || ''
  const body = await c.req.json()

  const expectedChallenge = await c.env.KV.get(`passkey_challenge:${userId}`)
  if (!expectedChallenge) return c.json({ error: 'No pending challenge' }, 400)

  const { verifyRegistrationResponse } = await import('@simplewebauthn/server')

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: new URL(c.req.url).origin,
    expectedRPID: new URL(c.req.url).hostname,
  })

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'Verification failed' }, 400)
  }

  const { credential } = verification.registrationInfo
  const config = await get2FAConfig(c.env.DB, prefix, userId)
  const existingCredentials = config?.passkey_credentials ? JSON.parse(config.passkey_credentials) : []

  existingCredentials.push({
    id: credential.id,
    publicKey: btoa(String.fromCharCode(...new Uint8Array(credential.publicKey))),
    counter: credential.counter,
    createdAt: new Date().toISOString(),
  })

  await upsert2FAConfig(c.env.DB, prefix, userId, {
    passkey_credentials: JSON.stringify(existingCredentials),
    passkey_enabled: 1,
    email_otp_enabled: 1,
  })

  await c.env.KV.delete(`passkey_challenge:${userId}`)

  return c.json({ success: true })
})

// Passkey authentication options (for 2FA login)
auth2faRoutes.post('/passkey/authenticate/options', async (c) => {
  const { tempToken } = await c.req.json<{ tempToken: string }>()
  if (!tempToken) return c.json({ error: 'tempToken required' }, 400)

  const userId = await c.env.KV.get(`2fa:${tempToken}`)
  if (!userId) return c.json({ error: 'Invalid session' }, 401)

  const prefix = c.env.TABLE_PREFIX || ''
  const config = await get2FAConfig(c.env.DB, prefix, userId)
  if (!config?.passkey_credentials) return c.json({ error: 'No passkeys registered' }, 400)

  const credentials = JSON.parse(config.passkey_credentials)
  const { generateAuthenticationOptions } = await import('@simplewebauthn/server')

  const options = await generateAuthenticationOptions({
    rpID: new URL(c.req.url).hostname,
    allowCredentials: credentials.map((cred: StoredCredential) => ({
      id: cred.id,
      type: 'public-key',
    })),
    userVerification: 'preferred',
  })

  await c.env.KV.put(`passkey_auth_challenge:${tempToken}`, options.challenge, { expirationTtl: 300 })

  return c.json(options)
})

// Passkey authentication verify (for 2FA login)
auth2faRoutes.post('/passkey/authenticate/verify', async (c) => {
  const { tempToken, ...body } = await c.req.json()
  if (!tempToken) return c.json({ error: 'tempToken required' }, 400)

  const userId = await c.env.KV.get(`2fa:${tempToken}`)
  if (!userId) return c.json({ error: 'Invalid session' }, 401)

  const prefix = c.env.TABLE_PREFIX || ''
  const config = await get2FAConfig(c.env.DB, prefix, userId)
  if (!config?.passkey_credentials) return c.json({ error: 'No passkeys' }, 400)

  const credentials = JSON.parse(config.passkey_credentials)
  const expectedChallenge = await c.env.KV.get(`passkey_auth_challenge:${tempToken}`)
  if (!expectedChallenge) return c.json({ error: 'No pending challenge' }, 400)

  const credential = credentials.find((cred: StoredCredential) => cred.id === body.id)
  if (!credential) return c.json({ error: 'Unknown credential' }, 400)

  const { verifyAuthenticationResponse } = await import('@simplewebauthn/server')

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: new URL(c.req.url).origin,
    expectedRPID: new URL(c.req.url).hostname,
    credential: {
      id: credential.id,
      publicKey: Uint8Array.from(atob(credential.publicKey), (c) => c.charCodeAt(0)),
      counter: credential.counter,
    },
  })

  if (!verification.verified) return c.json({ error: 'Verification failed' }, 401)

  // Update counter
  credential.counter = verification.authenticationInfo.newCounter
  await upsert2FAConfig(c.env.DB, prefix, userId, {
    passkey_credentials: JSON.stringify(credentials),
  })

  await c.env.KV.delete(`2fa:${tempToken}`)
  await c.env.KV.delete(`passkey_auth_challenge:${tempToken}`)

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)
  if (!user.is_active) return c.json({ error: 'Account is disabled' }, 403)

  const now = Math.floor(Date.now() / 1000)
  const accessJti = generateJti()
  const refreshJti = generateJti()

  const accessPayload: JWTPayload = { sub: userId, role: user.role, jti: accessJti, iat: now, exp: now + 86400 }
  const refreshPayload: JWTPayload = { sub: userId, role: user.role, jti: refreshJti, iat: now, exp: now + 604800 }

  const accessToken = await signJWT(accessPayload, c.env.JWT_SECRET)
  const refreshTokenStr = await signJWT(refreshPayload, c.env.JWT_SECRET)

  await c.env.KV.put(`rt:${refreshJti}`, userId, { expirationTtl: 604800 })

  setCookie(c, 'access_token', accessToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 86400 })
  setCookie(c, 'refresh_token', refreshTokenStr, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 604800 })

  return c.json({ success: true, user: { id: user.id, email: user.email, role: user.role } })
})

// Delete passkey
auth2faRoutes.delete('/passkey/:credentialId', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const credentialId = c.req.param('credentialId')
  const prefix = c.env.TABLE_PREFIX || ''

  const config = await get2FAConfig(c.env.DB, prefix, userId)
  if (!config?.passkey_credentials) return c.json({ error: 'No passkeys' }, 400)

  const credentials = JSON.parse(config.passkey_credentials)
  const filtered = credentials.filter((cred: StoredCredential) => cred.id !== credentialId)

  await upsert2FAConfig(c.env.DB, prefix, userId, {
    passkey_credentials: JSON.stringify(filtered),
    passkey_enabled: filtered.length > 0 ? 1 : 0,
  })

  return c.json({ success: true })
})
