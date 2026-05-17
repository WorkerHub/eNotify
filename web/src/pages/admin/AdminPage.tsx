import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { Users, Settings, Mail, ShieldCheck, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'

export function AdminPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()

  const isIndex = location.pathname === '/admin'

  const tabs = [
    { to: '/admin/users', label: t('admin.users'), icon: Users },
    { to: '/admin/app', label: t('admin.appSettings'), icon: Settings },
    { to: '/admin/email', label: t('admin.emailProvider'), icon: Mail },
    { to: '/admin/security', label: t('admin.accessSecurity'), icon: ShieldCheck },
  ]

  // Desktop: redirect /admin to /admin/users
  useEffect(() => {
    if (isIndex && !isMobile) {
      navigate('/admin/users', { replace: true })
    }
  }, [isIndex, isMobile, navigate])

  // Mobile: show sub-menu at index
  if (isIndex && isMobile) {
    return (
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-foreground mb-6">{t('admin.title')}</h1>
        <div className="rounded-lg border overflow-hidden divide-y">
          {tabs.map(({ to, label, icon: Icon }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="w-full flex items-center gap-3 px-4 py-3.5 bg-card hover:bg-accent transition-colors"
            >
              <Icon className="w-5 h-5 text-muted-foreground" />
              <span className="flex-1 text-left text-sm text-foreground">{label}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Desktop or mobile sub-route: show tabs + content
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>

      <div className="hidden md:flex gap-0 border-b overflow-x-auto no-scrollbar">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
