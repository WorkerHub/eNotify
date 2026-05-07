import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { api } from '@/lib/api'

export function ForgotPasswordPage() {
  const { t } = useTranslation()

  const [step, setStep] = useState<'email' | 'reset'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const startCountdown = useCallback(() => {
    setCountdown(60)
  }, [])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const handleSendCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/password/forgot', { email }, { skipRedirect: true })
      setStep('reset')
      startCountdown()
    } catch (err: any) {
      if (err.status === 429) {
        setError(t('auth.resetCodeCooldown'))
        if (step === 'reset') startCountdown()
      } else {
        setError(err.message || t('common.error'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/password/reset', { email, code, new_password: newPassword }, { skipRedirect: true })
      setDone(true)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const INPUT = 'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground">{t('app.name')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('auth.forgotPassword')}</p>
          </div>

          {done ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-green-600">{t('auth.resetPasswordSuccess')}</p>
              <Link to="/login" className="block text-sm text-primary hover:underline font-medium">
                {t('auth.login')}
              </Link>
            </div>
          ) : step === 'email' ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('auth.forgotPasswordDesc')}</p>
              <div>
                <label className="block text-sm font-medium mb-1.5">{t('auth.email')}</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={INPUT}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
              >
                {loading ? t('common.loading') : t('auth.sendCode')}
              </button>

              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="text-primary hover:underline font-medium">
                  {t('auth.backToLogin')}
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('auth.resetCodeSent')}</p>

              <div>
                <label className="block text-sm font-medium mb-1.5">{t('auth.verificationCode')}</label>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className={INPUT}
                  placeholder="123456"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">{t('auth.newPassword')}</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={INPUT}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">{t('auth.confirmPassword')}</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={INPUT}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
              >
                {loading ? t('common.loading') : t('auth.resetPassword')}
              </button>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <button
                  type="button"
                  disabled={countdown > 0 || loading}
                  onClick={() => handleSendCode()}
                  className={`font-medium ${countdown > 0 ? 'text-muted-foreground cursor-not-allowed' : 'text-primary hover:underline'}`}
                >
                  {countdown > 0 ? t('auth.resendCodeCountdown', { seconds: countdown }) : t('auth.resendCode')}
                </button>
                <Link to="/login" className="text-primary hover:underline font-medium">
                  {t('auth.backToLogin')}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
