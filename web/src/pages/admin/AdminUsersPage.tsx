import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ArrowLeft, AlertCircle, ShieldCheck, UserX, UserCheck, Trash2, LogIn } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

interface AdminUser {
  id: string
  email: string
  role: 'admin' | 'user'
  is_active: boolean
  email_verified: boolean
  created_at: string
}

const ROLE_STYLE: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  user: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export function AdminUsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user: currentUser, refreshUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    api
      .get<AdminUser[]>('/admin/users')
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const handleToggleActive = async (u: AdminUser) => {
    try {
      await api.put(`/admin/users/${u.id}`, { is_active: u.is_active ? 0 : 1 })
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_active: !u.is_active } : x)))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleChangeRole = async (u: AdminUser) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin'
    if (!window.confirm(t('admin.confirmRoleChange', { email: u.email, role: newRole }))) return
    try {
      await api.put(`/admin/users/${u.id}`, { role: newRole })
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: newRole } : x)))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDelete = async (u: AdminUser) => {
    if (!window.confirm(t('admin.confirmDeleteUser', { email: u.email }))) return
    try {
      await api.delete(`/admin/users/${u.id}`)
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleImpersonate = async (u: AdminUser) => {
    if (!window.confirm(t('admin.confirmImpersonate', { email: u.email }))) return
    sessionStorage.setItem('impersonate_user_id', u.id)
    window.dispatchEvent(new Event('impersonation-change'))
    await refreshUser()
    navigate('/')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">{t('admin.users')}</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[t('auth.email'), t('admin.role'), t('common.status'), t('admin.verified'), t('admin.created'), t('common.actions')].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium">{u.email}</span>
                      {u.id === currentUser?.id && (
                        <span className="ml-2 text-xs text-muted-foreground">({t('admin.you')})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ROLE_STYLE[u.role])}>
                        {t(`admin.role${u.role.charAt(0).toUpperCase() + u.role.slice(1)}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          u.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                        )}
                      >
                        {u.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.email_verified ? '✓' : '✗'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {u.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggleActive(u)}
                          disabled={u.id === currentUser?.id}
                          className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-30"
                          title={u.is_active ? t('admin.deactivate') : t('admin.activate')}
                          aria-label={u.is_active ? t('admin.deactivate') : t('admin.activate')}
                        >
                          {u.is_active ? (
                            <UserX className="w-4 h-4 text-yellow-500" />
                          ) : (
                            <UserCheck className="w-4 h-4 text-green-500" />
                          )}
                        </button>
                        <button
                          onClick={() => handleChangeRole(u)}
                          disabled={u.id === currentUser?.id}
                          className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-30"
                          title={t('admin.changeRole')}
                          aria-label={t('admin.changeRole')}
                        >
                          <ShieldCheck className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleImpersonate(u)}
                          disabled={u.id === currentUser?.id}
                          className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-30"
                          title={t('admin.impersonate')}
                          aria-label={t('admin.impersonate')}
                        >
                          <LogIn className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={u.id === currentUser?.id}
                          className="p-1.5 rounded hover:bg-accent transition-colors text-destructive disabled:opacity-30"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {users.map((u) => (
              <div key={u.id} className="bg-card rounded-xl border p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.email}</p>
                    <p className="text-xs text-muted-foreground">{u.created_at.slice(0, 10)}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ROLE_STYLE[u.role])}>
                      {t(`admin.role${u.role.charAt(0).toUpperCase() + u.role.slice(1)}`)}
                    </span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs font-medium',
                        u.is_active
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-600',
                      )}
                    >
                      {u.is_active ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                </div>
                {u.id !== currentUser?.id && (
                  <div className="flex flex-wrap gap-2 pt-1 border-t">
                    <button
                      onClick={() => handleToggleActive(u)}
                      className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      {u.is_active ? t('admin.deactivate') : t('admin.activate')}
                    </button>
                    <button
                      onClick={() => handleChangeRole(u)}
                      className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      {t('admin.changeRole')}
                    </button>
                    <button
                      onClick={() => handleImpersonate(u)}
                      className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      {t('admin.impersonate')}
                    </button>
                    <button
                      onClick={() => handleDelete(u)}
                      className="text-xs px-3 py-1.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
