import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Users, Settings, AlertCircle, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { User } from '@/types'

export function AdminPage() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<User[]>('/admin/users')
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="bg-card rounded-xl border p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Users className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{t('admin.userCount')}</p>
          {loading ? (
            <div className="h-6 w-8 bg-muted rounded animate-pulse mt-0.5" />
          ) : (
            <p className="text-2xl font-bold">{users.length}</p>
          )}
        </div>
      </div>

      {/* Navigation links */}
      <div className="space-y-2">
        <Link
          to="/admin/users"
          className="flex items-center gap-4 bg-card rounded-xl border p-4 hover:bg-accent transition-colors"
        >
          <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{t('admin.users')}</p>
            <p className="text-xs text-muted-foreground">{t('admin.usersDescription')}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>

        <Link
          to="/admin/system"
          className="flex items-center gap-4 bg-card rounded-xl border p-4 hover:bg-accent transition-colors"
        >
          <div className="w-9 h-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
            <Settings className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{t('admin.system')}</p>
            <p className="text-xs text-muted-foreground">{t('admin.systemDescription')}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>
      </div>
    </div>
  )
}
