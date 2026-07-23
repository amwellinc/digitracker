import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { Layout } from './Layout'
import { LandingPage } from '@/features/landing/LandingPage'
import { GHLInstallPage } from '@/features/ghl/GHLInstallPage'
import { GHLConnectedPage } from '@/features/ghl/GHLConnectedPage'
import { useAuth } from '@/hooks/useAuth'
import { useReportsAccess } from '@/hooks/useReportsAccess'

const TimeTrackingPage = lazy(() =>
  import('@/features/time-tracking/TimeTrackingPage').then(m => ({ default: m.TimeTrackingPage }))
)
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(m => ({ default: m.SettingsPage }))
)
const CalendarPage = lazy(() =>
  import('@/features/calendar/CalendarPage').then(m => ({ default: m.CalendarPage }))
)
const LeavePage = lazy(() =>
  import('@/features/leave/LeavePage').then(m => ({ default: m.LeavePage }))
)
const ScreenshotsPage = lazy(() =>
  import('@/features/screenshots/ScreenshotsPage').then(m => ({ default: m.ScreenshotsPage }))
)
const TasksPage = lazy(() =>
  import('@/features/tasks/TasksPage').then(m => ({ default: m.TasksPage }))
)
const HRDocumentsPage = lazy(() =>
  import('@/features/documents/HRDocumentsPage').then(m => ({ default: m.HRDocumentsPage }))
)
const KPIsPage = lazy(() =>
  import('@/features/kpis/KPIsPage').then(m => ({ default: m.KPIsPage }))
)
const SuperAdminPage = lazy(() =>
  import('@/features/super-admin/SuperAdminPage').then(m => ({ default: m.SuperAdminPage }))
)
const SubAccountsTab = lazy(() =>
  import('@/features/super-admin/SubAccountsTab').then(m => ({ default: m.SubAccountsTab }))
)
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then(m => ({ default: m.ReportsPage }))
)

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Root route renders the landing page for unauthenticated visitors,
// and the authenticated app shell (with Outlet for nested routes) for signed-in users.
function SmartRoot() {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0d14]">
      <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!user) return <LandingPage />
  return <AuthGuard><Layout /></AuthGuard>
}

// Reports is nav-gated (Admin default, Manager opt-in) — this guard blocks
// direct navigation to the URL for anyone the nav link isn't shown to.
function ReportsRoute() {
  const canView = useReportsAccess()
  if (!canView) return <Navigate to="/" replace />
  return (
    <Suspense fallback={<Spinner />}>
      <ReportsPage />
    </Suspense>
  )
}

export function AppRouter() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {/* Public routes */}
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/install"         element={<GHLInstallPage />} />
        <Route path="/ghl/callback"    element={<GHLConnectedPage />} />
        <Route path="/ghl/connected"   element={<GHLConnectedPage />} />

        {/* Root: landing page for guests, app shell for authenticated users */}
        <Route
          path="/"
          element={<SmartRoot />}
        >
          <Route
            index
            element={
              <Suspense fallback={<Spinner />}>
                <TimeTrackingPage />
              </Suspense>
            }
          />
          <Route
            path="calendar"
            element={
              <Suspense fallback={<Spinner />}>
                <CalendarPage />
              </Suspense>
            }
          />
          <Route
            path="screenshots"
            element={
              <Suspense fallback={<Spinner />}>
                <ScreenshotsPage />
              </Suspense>
            }
          />
          <Route
            path="tasks"
            element={
              <Suspense fallback={<Spinner />}>
                <TasksPage />
              </Suspense>
            }
          />
          <Route
            path="leave"
            element={
              <Suspense fallback={<Spinner />}>
                <LeavePage />
              </Suspense>
            }
          />
          <Route
            path="kpis"
            element={
              <Suspense fallback={<Spinner />}>
                <KPIsPage />
              </Suspense>
            }
          />
          <Route
            path="documents"
            element={
              <Suspense fallback={<Spinner />}>
                <HRDocumentsPage />
              </Suspense>
            }
          />
          <Route path="reports" element={<ReportsRoute />} />
          <Route
            path="settings"
            element={
              <Suspense fallback={<Spinner />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route
            path="platform"
            element={
              <AuthGuard allowedRoles={['Super-Admin']}>
                <Suspense fallback={<Spinner />}>
                  <SuperAdminPage />
                </Suspense>
              </AuthGuard>
            }
          />
          <Route
            path="platform/accounts"
            element={
              <AuthGuard allowedRoles={['Super-Admin']}>
                <Suspense fallback={<Spinner />}>
                  <SubAccountsTab />
                </Suspense>
              </AuthGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  )
}
