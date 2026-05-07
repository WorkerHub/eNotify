import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { AlertCircle, ShieldCheck, UserX, UserCheck, Trash2, LogIn, UserPlus, Pencil, X, Users } from 'lucide-react'
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

const INPUT = 'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring'
const SELECT = cn(INPUT, 'cursor-pointer')

export function AdminUsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user: currentUser, refreshUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [adding, setAdding] = useState(false)

  // Edit user
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editing, setEditing] = useState(false)

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

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    setError('')
    try {
      const created = await api.post<AdminUser>('/admin/users', { email: newEmail, password: newPassword, role: newRole })
      setUsers((prev) => [created, ...prev])
      setNewEmail('')
      setNewPassword('')
      setNewRole('user')
      setShowAddForm(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setAdding(false)
    }
  }

  const openEditUser = (u: AdminUser) => {
    setEditUser(u)
    setEditEmail(u.email)
    setEditPassword('')
    setError('')
  }

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setEditing(true)
    setError('')
    try {
      const body: Record<string, string> = {}
      if (editEmail !== editUser.email) body.email = editEmail
      if (editPassword) body.password = editPassword
      if (Object.keys(body).length === 0) { setEditUser(null); return }
      await api.put(`/admin/users/${editUser.id}`, body)
      setUsers((prev) => prev.map((x) => x.id === editUser.id ? { ...x, email: editEmail || x.email } : x))
      setEditUser(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setEditing(false)
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
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('admin.userCount')}</p>
            {loading ? (
              <div className="h-4 w-6 bg-muted rounded animate-pulse" />
            ) : (
              <p className="text-sm font-bold leading-tight">{users.length}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => { setShowAddForm((p) => !p); setError('') }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          {t('admin.addUser')}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Add user form */}
      {showAddForm && (
        <div className="bg-card border rounded-xl p-5">
          <h2 className="text-base font-semibold mb-4">{t('admin.addUser')}</h2>
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('auth.email')}</label>
                <input type="email" required className={INPUT} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('auth.password')}</label>
                <input type="password" required minLength={8} className={INPUT} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('admin.role')}</label>
                <select className={SELECT} value={newRole} onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}>
                  <option value="user">{t('admin.roleUser')}</option>
                  <option value="admin">{t('admin.roleAdmin')}</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={adding} className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {adding ? t('common.loading') : t('admin.createUser')}
              </button>
              <button type="button" onClick={() => setShowAddForm(false)} className="px-5 py-2 rounded-lg text-sm font-medium border hover:bg-accent transition-colors">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border rounded-xl p-6 w-full max-w-md mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{t('admin.editUser')}</h2>
              <button onClick={() => setEditUser(null)} className="p-1 rounded hover:bg-accent transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleEditUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('auth.email')}</label>
                <input type="email" required className={INPUT} value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('admin.newPasswordOptional')}</label>
                <input type="password" minLength={8} className={INPUT} value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={editing} className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {editing ? t('common.loading') : t('common.save')}
                </button>
                <button type="button" onClick={() => setEditUser(null)} className="px-5 py-2 rounded-lg text-sm font-medium border hover:bg-accent transition-colors">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
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
                          onClick={() => openEditUser(u)}
                          className="p-1.5 rounded hover:bg-accent transition-colors"
                          title={t('admin.editUser')}
                          aria-label={t('admin.editUser')}
                        >
                          <Pencil className="w-4 h-4" />
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
                      onClick={() => openEditUser(u)}
                      className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/70 transition-colors"
                    >
                      {t('admin.editUser')}
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
