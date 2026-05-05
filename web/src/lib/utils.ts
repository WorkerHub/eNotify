import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4
  const binary = atob(pad ? padded + '='.repeat(4 - pad) : padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function prepareRegistrationOptions(opts: any): PublicKeyCredentialCreationOptions {
  return {
    ...opts,
    challenge: base64urlToBuffer(opts.challenge),
    user: opts.user ? {
      ...opts.user,
      id: base64urlToBuffer(opts.user.id),
    } : opts.user,
    excludeCredentials: opts.excludeCredentials?.map((c: any) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  }
}

export function prepareAuthenticationOptions(opts: any): PublicKeyCredentialRequestOptions {
  return {
    ...opts,
    challenge: base64urlToBuffer(opts.challenge),
    allowCredentials: opts.allowCredentials?.map((c: any) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  }
}

export function serializeRegistrationCredential(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
    },
  }
}

export function serializeAuthenticationCredential(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  }
}
