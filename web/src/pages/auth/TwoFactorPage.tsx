import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { KeyRound, Mail, Smartphone } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { cn, serializeAuthenticationCredential, prepareAuthenticationOptions } from '@/lib/utils'

type Method = 'totp' | 'email_otp' | 'passkey'

interface LocationState {
  tempToken: string
  availableMethods: string[]
}

export function TwoFactorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshUser } = useAuth()

  const state = location.state as LocationState | null
  const availableMethods = (state?.availableMethods ?? ['totp']) as Method[]

  const [activeMethod, setActiveMethod] = useState<Method>(availableMethods[0])
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [codeSent, setCodeSent] = useState(false)

  useEffect(() => {
    if (!state?.tempToken) {
      navigate('/login', { replace: true })
    }
  }, [state, navigate])

  if (!state?.tempToken) return null

  const methodConfig: Record<Method, { label: string; icon: React.ReactNode }> = {
    totp: { label: t('auth.totp'), icon: <Smartphone className="w-4 h-4" /> },
    email_otp: { label: t('auth.emailOtp'), icon: <Mail className="w-4 h-4" /> },
    passkey: { label: t('auth.passkey'), icon: <KeyRound className="w-4 h-4" /> },
  }

  const switchMethod = (m: Method) => {
    setActiveMethod(m)
    setCode('')
    setError('')
    setCodeSent(false)
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<any>('/auth/2fa/verify', {
        tempToken: state.tempToken,
        method: activeMethod,
        code,
      })
      if (res.success) {
        await refreshUser().catch(() => {})
        navigate('/', { replace: true })
      }
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleSendCode = async () => {
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/2fa/otp/send', { tempToken: state.tempToken })
      setCodeSent(true)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const handlePasskey = async () => {
    setError('')
    setLoading(true)
    try {
      const opts = await api.post<any>(
        '/auth/2fa/passkey/authenticate/options',
        { tempToken: state.tempToken }
      )
      const credential = await navigator.credentials.get({
        publicKey: prepareAuthenticationOptions(opts),
      })
      if (!credential) throw new Error('No credential returned')
      const serialized = serializeAuthenticationCredential(credential as PublicKeyCredential)
      const res = await api.post<any>('/auth/2fa/passkey/authenticate/verify', {
        tempToken: state.tempToken,
        ...serialized,
      })
      if (res.success) {
        await refreshUser().catch(() => {})
        navigate('/', { replace: true })
      }
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border rounded-xl shadow-lg p-8">
          <h1 className="text-xl font-bold text-center text-foreground mb-2">
            {t('auth.twoFactor')}
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-6">
            {t('auth.enterCode')}
          </p>

          {/* Method selector */}
          {availableMethods.length > 1 && (
            <div className="flex gap-1 mb-6 p-1 bg-muted rounded-lg">
              {availableMethods.map((m) => {
                const cfg = methodConfig[m]
                return (
                  <button
                    key={m}
                    onClick={() => switchMethod(m)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors',
                      activeMethod === m
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {cfg.icon}
                    <span className="hidden sm:inline">{cfg.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-4">
              {error}
            </p>
          )}

          {activeMethod === 'passkey' ? (
            <button
              onClick={handlePasskey}
              disabled={loading}
              className="w-full py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" />
              {loading ? t('common.loading') : t('auth.passkey')}
            </button>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              {activeMethod === 'email_otp' && !codeSent && (
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={loading}
                  className="w-full py-2 px-4 bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-secondary-foreground text-sm font-medium rounded-md transition-colors"
                >
                  {loading ? t('common.loading') : t('auth.sendCode')}
                </button>
              )}
              {activeMethod === 'email_otp' && codeSent && (
                <p className="text-xs text-muted-foreground text-center">
                  {t('auth.verifyEmailSent')}
                </p>
              )}

              {(activeMethod === 'totp' || codeSent) && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      {t('auth.enterCode')}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-3 rounded-md border border-input bg-background text-foreground text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="000000"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || code.length < 6}
                    className="w-full py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
                  >
                    {loading ? t('common.loading') : t('common.confirm')}
                  </button>
                </>
              )}
            </form>
          )}

          <div className="mt-6 text-center">
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
              ← {t('common.back')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
