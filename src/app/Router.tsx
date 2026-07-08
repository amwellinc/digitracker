import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { Layout } from './Layout'

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

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function AppRouter() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
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
            path="leave"
            element={
              <Suspense fallback={<Spinner />}>
                <LeavePage />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<Spinner />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  )
}
