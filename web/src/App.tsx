import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { lazy, Suspense, type ReactNode } from 'react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { AppLayout } from '@/components/layout/AppLayout'

// Lazy-loaded pages for code splitting
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })))
const TwoFactorPage = lazy(() => import('@/pages/auth/TwoFactorPage').then(m => ({ default: m.TwoFactorPage })))
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ItemListPage = lazy(() => import('@/pages/items/ItemListPage').then(m => ({ default: m.ItemListPage })))
const ItemNewPage = lazy(() => import('@/pages/items/ItemNewPage').then(m => ({ default: m.ItemNewPage })))
const ItemDetailPage = lazy(() => import('@/pages/items/ItemDetailPage').then(m => ({ default: m.ItemDetailPage })))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))
const HistoryPage = lazy(() => import('@/pages/history/HistoryPage').then(m => ({ default: m.HistoryPage })))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage').then(m => ({ default: m.AdminPage })))
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })))
const AdminAppPage = lazy(() => import('@/pages/admin/AdminAppPage').then(m => ({ default: m.AdminAppPage })))
const AdminEmailPage = lazy(() => import('@/pages/admin/AdminEmailPage').then(m => ({ default: m.AdminEmailPage })))
const AdminSecurityPage = lazy(() => import('@/pages/admin/AdminSecurityPage').then(m => ({ default: m.AdminSecurityPage })))
const AboutPage = lazy(() => import('@/pages/about/AboutPage').then(m => ({ default: m.AboutPage })))
const ChannelPage = lazy(() => import('@/pages/channels/ChannelPage').then(m => ({ default: m.ChannelPage })))

function PageLoader() {
  return <div className="flex items-center justify-center h-screen">Loading...</div>
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
              <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
              <Route path="/2fa" element={<TwoFactorPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />

              {/* Protected routes */}
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route index element={<DashboardPage />} />
                <Route path="items" element={<ItemListPage />} />
                <Route path="items/new" element={<ItemNewPage />} />
                <Route path="items/:id" element={<ItemDetailPage />} />
                <Route path="channels" element={<ChannelPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="about" element={<AboutPage />} />

                {/* Admin routes */}
                <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>}>
                  <Route index element={<Navigate to="users" replace />} />
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="app" element={<AdminAppPage />} />
                  <Route path="email" element={<AdminEmailPage />} />
                  <Route path="security" element={<AdminSecurityPage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}