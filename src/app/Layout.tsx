import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ClockProvider, useClockContext } from '@/features/time-tracking/ClockContext'

const STAFF_NAV = [
  { to: '/',           end: true,  label: 'Time Tracking',   icon: '⏱',
    children: [{ to: '/screenshots', label: 'Screenshots', icon: '📸' }] },
  { to: '/calendar',   end: false, label: 'Calendar',         icon: '📅' },
  { to: '/leave',      end: false, label: 'Leave & Time Off', icon: '📋' },
  { to: '/tasks',      end: false, label: 'Tasks',            icon: '✅' },
  { to: '/documents',  end: false, label: 'HR Documents',     icon: '📁' },
  { to: '/kpis',       end: false, label: 'KPIs',             icon: '📊' },
]

const SUPER_ADMIN_NAV = [
  { to: '/platform',  end: true,  label: 'Platform Admin',   icon: '🏢', children: [] },
  { to: '/settings',  end: false, label: 'Settings',         icon: '⚙', children: [] },
]

function ClockStatusBadge() {
  const { activeLog } = useClockContext()
  const status = activeLog?.status ?? 'clocked_out'
  const label = status === 'working' ? 'Online' : status === 'lunch' ? 'On Lunch' : 'Offline'
  const dotColor = status === 'working' ? 'bg-green-500' : status === 'lunch' ? 'bg-amber-500' : 'bg-gray-400'
  const labelColor = status === 'working' ? 'text-green-600' : status === 'lunch' ? 'text-amber-500' : 'text-gray-400'

  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      <span className="hidden sm:inline">Status:</span>
      <span className={`flex items-center gap-1.5 font-medium ${labelColor}`}>
        <span
          className={`w-2 h-2 rounded-full ${dotColor} ${status === 'working' ? 'animate-pulse' : ''}`}
          aria-hidden="true"
        />
        <span className="hidden sm:inline">{label}</span>
      </span>
    </div>
  )
}

function LayoutInner() {
  const { user, isSuperAdmin, visitingAccount, exitVisit, viewAsUser, exitViewAs, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isViewingAs = isSuperAdmin && !!viewAsUser
  const isVisiting  = isSuperAdmin && !!visitingAccount && !isViewingAs
  const NAV = (isSuperAdmin && !isVisiting && !isViewingAs) ? SUPER_ADMIN_NAV : STAFF_NAV

  // Close sidebar on route change (mobile nav)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname, location.hash])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleExitVisit = () => {
    exitVisit()
    navigate('/platform')
  }

  const handleExitViewAs = () => {
    exitViewAs()
    navigate('/platform')
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 flex flex-col
          transition-transform duration-300 ease-in-out
          md:relative md:z-auto md:translate-x-0 md:w-60 md:flex-shrink-0
          ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100 flex-shrink-0">
          <img src="/logo.png" alt="DIGITRACKER" className="w-9 h-9 rounded-lg object-contain" />
          <div className="leading-tight">
            <span className="font-bold text-sm tracking-tight block">DIGITRACKER</span>
            <span className="text-xs text-gray-400">By DIGI5Y</span>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto text-gray-400 hover:text-gray-600 p-1.5 rounded-lg md:hidden"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isViewingAs && (
          <div className="mx-3 mt-3 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 flex-shrink-0">
            <p className="text-xs font-semibold text-indigo-700">👁 Viewing As</p>
            <p className="text-xs text-indigo-600 font-medium truncate">{viewAsUser!.name}</p>
            <p className="text-xs text-indigo-400 truncate">{viewAsUser!.role} · {viewAsUser!.sub_account}</p>
          </div>
        )}
        {isVisiting && !isViewingAs && (
          <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex-shrink-0">
            <p className="text-xs font-semibold text-amber-700">Admin Visit Mode</p>
            <p className="text-xs text-amber-600 font-mono truncate">{visitingAccount!.code}</p>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(item => {
            const parentActive = item.end
              ? location.pathname === '/' || location.hash === '#/'
              : location.hash.startsWith(`#${item.to}`)
            const childActive = item.children?.some(c => location.hash === `#${c.to}`)
            const sectionOpen = parentActive || !!childActive
            return (
              <div key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive && !childActive
                        ? 'bg-violet-50 text-violet-700'
                        : 'text-gray-600 hover:bg-gray-100 active:bg-gray-100'
                    }`
                  }
                  style={{ minHeight: '44px' }}
                >
                  <span className="text-base w-5 text-center">{item.icon}</span>
                  {item.label}
                </NavLink>
                {item.children && item.children.length > 0 && sectionOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-violet-100 pl-3">
                    {item.children.map(child => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive ? 'bg-violet-50 text-violet-700' : 'text-gray-500 hover:bg-gray-100'
                          }`
                        }
                      >
                        <span className="text-sm">{child.icon}</span>
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100 space-y-0.5 flex-shrink-0">
          <div className="flex items-center gap-3 px-3 py-2">
            {user?.profile_image ? (
              <img
                src={user.profile_image}
                alt={user.name}
                className="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-gray-200"
              />
            ) : (
              <div className={`w-8 h-8 rounded-full font-semibold text-xs flex items-center justify-center flex-shrink-0 ${
                isSuperAdmin ? 'bg-purple-200 text-purple-800' : 'bg-violet-200 text-violet-700'
              }`}>
                {user?.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 truncate">
                {isViewingAs ? `${viewAsUser!.role} · ${viewAsUser!.sub_account}`
                  : isVisiting ? `Admin · ${visitingAccount!.code}`
                  : isSuperAdmin ? 'Super Admin'
                  : user?.role}
              </p>
            </div>
          </div>
          {(!isSuperAdmin || isVisiting || isViewingAs) && (
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
              style={{ minHeight: '44px' }}
            >
              <span>⚙</span> Settings
            </NavLink>
          )}
          {isViewingAs && (
            <button
              onClick={handleExitViewAs}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-indigo-600 hover:bg-indigo-50 w-full"
              style={{ minHeight: '44px' }}
            >
              <span>👁</span> Exit View As
            </button>
          )}
          {isVisiting && (
            <button
              onClick={handleExitVisit}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-amber-600 hover:bg-amber-50 w-full"
              style={{ minHeight: '44px' }}
            >
              <span>←</span> Exit Visit
            </button>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 w-full"
            style={{ minHeight: '44px' }}
          >
            <span>↪</span> Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {isViewingAs && (
          <div className="bg-indigo-600 text-white px-4 sm:px-6 py-2 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <span className="text-sm">👁</span>
              <span className="text-sm font-semibold truncate">
                Viewing as: {viewAsUser!.name}
              </span>
              <span className="text-xs bg-indigo-700 px-2 py-0.5 rounded hidden sm:inline">
                {viewAsUser!.role}
              </span>
              <span className="font-mono text-xs bg-indigo-700 px-2 py-0.5 rounded hidden sm:inline">
                {viewAsUser!.sub_account}
              </span>
              <span className="text-xs text-indigo-300 hidden md:inline">— read-only preview</span>
            </div>
            <button
              onClick={handleExitViewAs}
              className="text-sm font-semibold bg-white text-indigo-700 hover:bg-indigo-50 px-3 py-1 rounded-lg transition-colors flex-shrink-0"
            >
              Exit View As
            </button>
          </div>
        )}
        {isVisiting && (
          <div className="bg-amber-500 text-white px-4 sm:px-6 py-2 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <span className="text-sm font-semibold truncate">
                Visiting: {visitingAccount!.company_name || visitingAccount!.code}
              </span>
              <span className="font-mono text-xs bg-amber-600 px-2 py-0.5 rounded hidden sm:inline">
                {visitingAccount!.code}
              </span>
            </div>
            <button
              onClick={handleExitVisit}
              className="text-sm font-semibold bg-white text-amber-700 hover:bg-amber-50 px-3 py-1 rounded-lg transition-colors flex-shrink-0"
            >
              ← Exit
            </button>
          </div>
        )}

        <header className="h-14 sm:h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 flex-shrink-0 gap-3">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 -ml-1 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Open navigation menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate flex-1">
            {isViewingAs ? `${viewAsUser!.name}'s View`
              : isVisiting ? `${visitingAccount!.company_name || visitingAccount!.code}`
              : 'DIGITRACKER'}
          </h1>

          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <ClockStatusBadge />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

export function Layout() {
  return (
    <ClockProvider>
      <LayoutInner />
    </ClockProvider>
  )
}
