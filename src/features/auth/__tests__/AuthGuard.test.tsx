import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthGuard } from '../AuthGuard'
import { AuthContext } from '../AuthContext'
import type { User } from '@/types'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    }),
  },
}))

const staff: User = {
  id: '1', email: 'a@a.com', name: 'Alice', role: 'Staff',
  sub_account: 'AM333', manager_id: null, annual_leave: 14,
  time_off: 5, profile_image: null, reporting_time_in: '10:00',
  reporting_time_out: '19:00', country: 'SG', phone: null, status: 'active', created_at: '2026-01-01T00:00:00Z',
}
const admin: User = { ...staff, role: 'Admin' }

const ctx = (user: User | null, loading = false) => ({
  user, loading,
  accountBlockedMessage: null,
  isSuperAdmin: user?.role === 'Super-Admin',
  visitingAccount: null,
  visitSubAccount: vi.fn(),
  exitVisit: vi.fn(),
  viewAsUser: null,
  startViewAs: vi.fn(),
  exitViewAs: vi.fn(),
  signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(), signOut: vi.fn(), refreshUser: vi.fn(),
})

describe('AuthGuard', () => {
  it('shows spinner while loading', () => {
    const { container } = render(
      <AuthContext.Provider value={ctx(null, true)}>
        <MemoryRouter><AuthGuard><div>ok</div></AuthGuard></MemoryRouter>
      </AuthContext.Provider>
    )
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('renders children for authenticated user', () => {
    render(
      <AuthContext.Provider value={ctx(staff)}>
        <MemoryRouter><AuthGuard><div>protected</div></AuthGuard></MemoryRouter>
      </AuthContext.Provider>
    )
    expect(screen.getByText('protected')).toBeInTheDocument()
  })

  it('does not render children when unauthenticated', () => {
    render(
      <AuthContext.Provider value={ctx(null)}>
        <MemoryRouter><AuthGuard><div>protected</div></AuthGuard></MemoryRouter>
      </AuthContext.Provider>
    )
    expect(screen.queryByText('protected')).not.toBeInTheDocument()
  })

  it('blocks Staff from Manager-only route', () => {
    render(
      <AuthContext.Provider value={ctx(staff)}>
        <MemoryRouter>
          <AuthGuard allowedRoles={['Manager', 'Admin', 'Super-Admin']}><div>mgr</div></AuthGuard>
        </MemoryRouter>
      </AuthContext.Provider>
    )
    expect(screen.queryByText('mgr')).not.toBeInTheDocument()
  })

  it('allows Admin on Manager-only route', () => {
    render(
      <AuthContext.Provider value={ctx(admin)}>
        <MemoryRouter>
          <AuthGuard allowedRoles={['Manager', 'Admin', 'Super-Admin']}><div>mgr</div></AuthGuard>
        </MemoryRouter>
      </AuthContext.Provider>
    )
    expect(screen.getByText('mgr')).toBeInTheDocument()
  })
})
