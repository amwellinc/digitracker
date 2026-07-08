import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

const NAV = [
  { to: '/',           end: true,  label: 'Time Tracking',  icon: '⏱',
    children: [{ to: '/screenshots', label: 'Screenshots', icon: '📸' }] },
  { to: '/calendar',   end: false, label: 'Calendar',        icon: '📅' },
  { to: '/leave',      end: false, label: 'Leave & Time Off', icon: '📋' },
  { to: '/tasks',      end: false, label: 'Tasks',            icon: '✅' },
  { to: '/documents',  end: false, label: 'HR Documents',      icon: '📁' },
  { to: '/kpis',       end: false, label: 'KPIs',             icon: '📊' },
]

export function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-100">
          <img src="/logo.png" alt="DIGITRACKER" className="w-10 h-10 rounded-lg object-contain" />
          <div className="leading-tight">
            <span className="font-bold text-sm tracking-tight block">DIGITRACKER</span>
            <span className="text-xs text-gray-400">By DIGI5Y</span>
          </div>
        </div>

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
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive && !childActive ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </NavLink>
                {item.children && sectionOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-violet-100 pl-3">
                    {item.children.map(child => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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

        <div className="px-3 py-4 border-t border-gray-100 space-y-0.5">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-violet-200 text-violet-700 font-semibold text-xs flex items-center justify-center flex-shrink-0">
              {user?.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            </div>
          </div>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            <span>⚙</span> Settings
          </NavLink>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 w-full"
          >
            <span>↪</span> Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
          <h1 className="text-xl font-semibold text-gray-900">Time Tracking</h1>
          <div className="flex items-center gap-4">
            <button className="text-gray-400 hover:text-gray-600 text-xl" aria-label="Notifications">
              🔔
            </button>
            <button className="text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
              Account
            </button>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              Status:
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                Inactive
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
