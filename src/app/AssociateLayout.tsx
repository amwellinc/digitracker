// App shell for associates (spec §2.3): project-only sidebar, no clock or
// time-tracking side effects, and every non-project route redirected.
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useProjectMemberships } from '@/hooks/useProjectMemberships'
import { NotificationsBell } from '@/features/notifications/NotificationsBell'
import { NoProjectsPage } from '@/features/projects/NoProjectsPage'

const PROJECT_PATH = /^\/projects\/[^/]+$/

export function AssociateLayout() {
  const { user, signOut, isSuperAdmin, viewAsUser, exitViewAs } = useAuth()
  const navigate = useNavigate()
  const { memberships, loading } = useProjectMemberships()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const onProjectRoute = PROJECT_PATH.test(location.pathname)
  if (!onProjectRoute && memberships.length > 0) {
    return <Navigate to={`/projects/${memberships[0].id}`} replace />
  }

  return (
    <div className="min-h-screen flex flex-col sm:flex-row bg-gray-50">
      <aside className="sm:w-64 bg-white border-b sm:border-b-0 sm:border-r border-gray-200 flex sm:flex-col">
        <nav aria-label="Projects" className="flex-1 px-3 py-3 sm:py-4 flex sm:flex-col gap-1 overflow-x-auto">
          {memberships.map(p => (
            <NavLink key={p.id} to={`/projects/${p.id}`}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                isActive ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100'}`}
              style={{ minHeight: '44px' }}>
              <span aria-hidden="true">🗂</span>{`PROJECTS-${p.name}`}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 sm:py-4 sm:border-t border-gray-100 flex sm:flex-col gap-1 flex-shrink-0">
          <p className="hidden sm:block px-3 text-sm font-medium truncate">{user?.name}</p>
          <p className="hidden sm:block px-3 text-xs text-gray-400 mb-1">Associate</p>
          <button onClick={() => void signOut()}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50"
            style={{ minHeight: '44px' }}>
            <span aria-hidden="true">↪</span> Logout
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        {isSuperAdmin && viewAsUser && (
          <div className="bg-indigo-50 border-b border-indigo-200 px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-indigo-700 min-w-0 truncate">
              <span aria-hidden="true">👁 </span>Viewing as: <span className="font-semibold">{viewAsUser.name}</span>
              <span className="ml-2 text-indigo-400">Associate</span>
            </p>
            <button onClick={() => { exitViewAs(); navigate('/') }}
              className="text-xs font-medium text-indigo-600 hover:bg-indigo-100 rounded-lg px-3 flex-shrink-0"
              style={{ minHeight: '44px' }}>
              Exit View As
            </button>
          </div>
        )}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-end px-4 sm:px-6">
          <NotificationsBell />
        </header>
        <main className="flex-1 overflow-y-auto">
          {onProjectRoute ? <Outlet /> : <NoProjectsPage />}
        </main>
      </div>
    </div>
  )
}
