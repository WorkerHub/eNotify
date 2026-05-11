import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import { Users, Settings, Mail, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AdminPage() {
  const { t } = useTranslation()

  const tabs = [
    { to: '/admin/users', label: t('admin.users'), icon: Users },
    { to: '/admin/app', label: t('admin.appSettings'), icon: Settings },
    { to: '/admin/email', label: t('admin.emailProvider'), icon: Mail },
    { to: '/admin/security', label: t('admin.accessSecurity'), icon: ShieldCheck },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>

      <div className="flex flex-wrap gap-0 border-b">
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
