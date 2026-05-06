import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { TwoFactorPage } from '@/pages/auth/TwoFactorPage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import { ItemListPage } from '@/pages/items/ItemListPage'
import { ItemNewPage } from '@/pages/items/ItemNewPage'
import { ItemDetailPage } from '@/pages/items/ItemDetailPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'
import { HistoryPage } from '@/pages/history/HistoryPage'
import { AdminPage } from '@/pages/admin/AdminPage'
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage'
import { AdminSystemPage } from '@/pages/admin/AdminSystemPage'
import type { ReactNode } from 'react'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
            <Route path="/2fa" element={<TwoFactorPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="items" element={<ItemListPage />} />
              <Route path="items/new" element={<ItemNewPage />} />
              <Route path="items/:id" element={<ItemDetailPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="settings" element={<SettingsPage />} />

              {/* Admin routes */}
              <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
              <Route path="admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
              <Route path="admin/system" element={<AdminRoute><AdminSystemPage /></AdminRoute>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
