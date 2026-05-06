import { Outlet, NavLink, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/components/theme-provider'
import { LayoutDashboard, CreditCard, Settings, Shield, LogOut, Sun, Moon, Monitor, Globe, XCircle, History, User, ChevronDown } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '@/lib/api'

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout, refreshUser } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [impersonating, setImpersonating] = useState(() => !!sessionStorage.getItem('impersonate_user_id'))
  const [appName, setAppName] = useState('eNotify')
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const avatarMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get<{ app_name: string; version: string }>('/system/info')
      .then((info) => { if (info.app_name) setAppName(info.app_name) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const check = () => setImpersonating(!!sessionStorage.getItem('impersonate_user_id'))
    window.addEventListener('storage', check)
    window.addEventListener('impersonation-change', check)
    const id = setInterval(check, 3000)
    return () => { window.removeEventListener('storage', check); window.removeEventListener('impersonation-change', check); clearInterval(id) }
  }, [])

  useEffect(() => {
    if (sessionStorage.getItem('needs_2fa_setup')) {
      sessionStorage.removeItem('needs_2fa_setup')
      navigate('/settings?tab=security', { replace: true })
    }
  }, [navigate])

  // Close avatar menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
        setAvatarMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const stopImpersonating = async () => {
    sessionStorage.removeItem('impersonate_user_id')
    window.dispatchEvent(new Event('impersonation-change'))
    setImpersonating(false)
    await refreshUser()
    navigate('/admin/users')
  }

  const handleLogout = async () => {
    setAvatarMenuOpen(false)
    await logout()
    navigate('/login')
  }

  const toggleLanguage = () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh'
    i18n.changeLanguage(next)
  }

  const cycleTheme = () => {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % 3])
  }

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/items', icon: CreditCard, label: t('nav.items') },
    { to: '/history', icon: History, label: t('nav.history') },
  ]

  // Avatar dropdown menu items
  const avatarMenuItems = [
    { to: '/settings', icon: Settings, label: t('nav.settings') },
    ...(user?.role === 'admin' ? [{ to: '/admin', icon: Shield, label: t('nav.admin') }] : []),
  ]

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col bg-card border-r">
        <div className="p-4 border-b">
          <h1 className="text-xl font-bold text-primary">{appName}</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent'
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t space-y-1">
          <button onClick={cycleTheme} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm w-full text-muted-foreground hover:bg-accent">
            {theme === 'light' ? <Sun className="w-4 h-4" /> : theme === 'dark' ? <Moon className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            {t(`settings.theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`)}
          </button>
          <button onClick={toggleLanguage} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm w-full text-muted-foreground hover:bg-accent">
            <Globe className="w-4 h-4" />
            {i18n.language === 'zh' ? 'English' : '中文'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 pt-11 pb-16 md:pt-0 md:pb-0">
        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-end gap-2 px-6 py-3 border-b bg-card">
          <button onClick={cycleTheme} className="p-2 rounded-md text-muted-foreground hover:bg-accent transition-colors" aria-label={t('settings.theme')}>
            {theme === 'light' ? <Sun className="w-4 h-4" /> : theme === 'dark' ? <Moon className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
          </button>
          <button onClick={toggleLanguage} className="p-2 rounded-md text-muted-foreground hover:bg-accent transition-colors text-xs font-medium" aria-label={t('settings.language')}>
            {i18n.language === 'zh' ? 'EN' : '中'}
          </button>
          <div ref={avatarMenuRef} className="relative">
            <button
              onClick={() => setAvatarMenuOpen((p) => !p)}
              className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            {avatarMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-card border rounded-lg shadow-lg py-1 z-50">
                <div className="px-3 py-2 border-b">
                  <p className="text-sm font-medium truncate">{user?.email}</p>
                </div>
                {avatarMenuItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/settings'}
                    onClick={() => setAvatarMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                        isActive ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:bg-accent'
                      }`
                    }
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </NavLink>
                ))}
                <div className="border-t mt-1 pt-1">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-3 py-2 text-sm w-full text-destructive hover:bg-accent transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('auth.logout')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {impersonating && (
          <div className="bg-yellow-500/90 text-yellow-950 text-sm px-4 py-2 flex items-center justify-between">
            <span>{t('admin.impersonating', { defaultValue: 'Impersonating another user' })}</span>
            <button onClick={stopImpersonating} className="flex items-center gap-1 font-medium hover:underline">
              <XCircle className="w-4 h-4" />
              {t('common.stop', { defaultValue: 'Stop' })}
            </button>
          </div>
        )}
        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 left-0 right-0 bg-card border-b flex items-center justify-between px-4 h-11 z-50">
        <span className="text-base font-bold text-primary">{appName}</span>
        <div className="flex items-center gap-1">
          <button onClick={cycleTheme} className="p-2 rounded-md text-muted-foreground hover:bg-accent transition-colors" aria-label={t('settings.theme')}>
            {theme === 'light' ? <Sun className="w-4 h-4" /> : theme === 'dark' ? <Moon className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
          </button>
          <button onClick={toggleLanguage} className="p-2 rounded-md text-muted-foreground hover:bg-accent transition-colors text-xs font-medium" aria-label={t('settings.language')}>
            {i18n.language === 'zh' ? 'EN' : '中'}
          </button>
          <div ref={avatarMenuRef} className="relative">
            <button
              onClick={() => setAvatarMenuOpen((p) => !p)}
              className="p-1 rounded-md hover:bg-accent transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-primary" />
              </div>
            </button>
            {avatarMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-card border rounded-lg shadow-lg py-1 z-50">
                <div className="px-3 py-2 border-b">
                  <p className="text-xs font-medium truncate">{user?.email}</p>
                </div>
                {avatarMenuItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/settings'}
                    onClick={() => setAvatarMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                        isActive ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:bg-accent'
                      }`
                    }
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </NavLink>
                ))}
                <div className="border-t mt-1 pt-1">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-3 py-2 text-sm w-full text-destructive hover:bg-accent transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('auth.logout')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t flex justify-around py-2 z-50">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-3 py-1 text-xs ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
