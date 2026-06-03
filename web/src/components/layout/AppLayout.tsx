import { Outlet, NavLink, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { LayoutDashboard, CreditCard, Shield, LogOut, XCircle, Settings, History, User, ChevronDown, Info, Radio, RefreshCw } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { usePWAUpdate } from '@/hooks/usePWAUpdate'

function AvatarDropdown({ user, onLogout, onNavigate }: {
  user: { email: string; role: string } | null
  onLogout: () => void
  onNavigate: (path: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleNavigate = (path: string) => {
    setOpen(false)
    onNavigate(path)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-card border rounded-lg shadow-lg py-1 z-50">
          <div className="px-3 py-2 border-b">
            <p className="text-sm font-medium truncate">{user?.email}</p>
          </div>
          <button onClick={() => handleNavigate('/settings')} className="flex items-center gap-2 px-3 py-2 text-sm w-full text-muted-foreground hover:bg-accent transition-colors">
            <Settings className="w-4 h-4" />
            {t('nav.settings')}
          </button>
          {user?.role === 'admin' && (
            <button onClick={() => handleNavigate('/admin')} className="flex items-center gap-2 px-3 py-2 text-sm w-full text-muted-foreground hover:bg-accent transition-colors">
              <Shield className="w-4 h-4" />
              {t('nav.admin')}
            </button>
          )}
          <button onClick={() => handleNavigate('/about')} className="flex items-center gap-2 px-3 py-2 text-sm w-full text-muted-foreground hover:bg-accent transition-colors">
            <Info className="w-4 h-4" />
            {t('nav.about')}
          </button>
          <div className="border-t mt-1 pt-1">
            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-2 text-sm w-full text-destructive hover:bg-accent transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t('auth.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AppLayout() {
  const { t } = useTranslation()
  const { user, logout, refreshUser } = useAuth()
  const navigate = useNavigate()
  const { needRefresh, update, dismiss } = usePWAUpdate()
  const [impersonating, setImpersonating] = useState(() => !!sessionStorage.getItem('impersonate_user_id'))
  const [appName, setAppName] = useState('eNotify')

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

  // Prefetch bottom nav tab chunks so mobile tab switching is instant
  useEffect(() => {
    const tid = setTimeout(() => {
      import('@/pages/items/ItemListPage')
      import('@/pages/channels/ChannelPage')
      import('@/pages/history/HistoryPage')
      import('@/pages/me/MePage')
    }, 500)
    return () => clearTimeout(tid)
  }, [])

  const stopImpersonating = async () => {
    sessionStorage.removeItem('impersonate_user_id')
    window.dispatchEvent(new Event('impersonation-change'))
    setImpersonating(false)
    await refreshUser()
    navigate('/admin/users')
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleMenuNavigate = (path: string) => {
    navigate(path)
  }

  const desktopNavItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/items', icon: CreditCard, label: t('nav.items') },
    { to: '/channels', icon: Radio, label: t('nav.channels') },
    { to: '/history', icon: History, label: t('nav.history') },
  ]

  const mobileNavItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/items', icon: CreditCard, label: t('nav.items') },
    { to: '/channels', icon: Radio, label: t('nav.channels') },
    { to: '/history', icon: History, label: t('nav.history') },
    { to: '/me', icon: User, label: t('nav.me') },
  ]

  return (
    <div className="h-dvh flex flex-col md:flex-row md:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-40 md:flex md:w-64 md:flex-col bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 border-r shadow-[1px_0_0_0_hsl(var(--border))]">
        <div className="h-14 flex items-center px-4 border-b">
          <h1 className="text-xl font-bold text-primary">{appName}</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {desktopNavItems.map((item) => (
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
      </aside>

      {/* Main content */}
      <main className="flex-1 pt-[calc(3rem+env(safe-area-inset-top,0px))] pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:ml-64 md:h-dvh md:overflow-y-auto md:pt-14 md:pb-0">
        {/* Desktop top bar */}
        <div className="hidden md:fixed md:top-0 md:left-64 md:right-0 md:z-30 md:flex items-center justify-end gap-2 px-6 h-14 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 shadow-sm">
          <AvatarDropdown user={user} onLogout={handleLogout} onNavigate={handleMenuNavigate} />
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

        {needRefresh && (
          <div className="bg-blue-500/90 text-white text-sm px-4 py-2 flex items-center justify-between">
            <span>{t('pwa.updateAvailable')}</span>
            <div className="flex items-center gap-2">
              <button onClick={update} className="flex items-center gap-1 font-medium hover:underline">
                <RefreshCw className="w-4 h-4" />
                {t('pwa.updateAction')}
              </button>
              <button onClick={dismiss} className="opacity-70 hover:opacity-100">
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Mobile top bar */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 bg-card border-b flex items-center px-4 z-50"
        style={{
          height: 'calc(3rem + env(safe-area-inset-top, 0px))',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <span className="text-base font-bold text-primary">{appName}</span>
      </header>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t flex justify-around z-50"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingTop: '0.5rem',
        }}
      >
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
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