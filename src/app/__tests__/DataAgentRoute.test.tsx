import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

// `DataAgentRoute` is a private, unexported function inside Router.tsx — by
// design (see the task brief: don't restructure Router.tsx's exports just to
// make it directly importable). The most direct test available without that
// restructuring is to exercise it through the exported `AppRouter`.
//
// AppRouter hard-codes `HashRouter` internally, which can't take
// `initialEntries`. Swapping it for `MemoryRouter` here (test-file-only,
// Router.tsx is untouched) lets each test pick its starting route.
let initialPath = '/data-agent'
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    HashRouter: ({ children }: { children: ReactNode }) => (
      <actual.MemoryRouter initialEntries={[initialPath]}>{children}</actual.MemoryRouter>
    ),
  }
})

// Generic Supabase mock — same shape proven sufficient in Layout.test.tsx to
// render the full Layout tree (ClockProvider, useScreenCapture,
// useSubAccountTimezone, etc.) without hitting a real network call.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [] }),
      single: vi.fn().mockResolvedValue({ data: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    })),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null }),
  },
}))

vi.mock('@/hooks/useProjectMemberships', () => ({
  useProjectMemberships: () => ({ memberships: [], loading: false }),
}))
vi.mock('@/hooks/useReportsAccess', () => ({ useReportsAccess: () => false }))
vi.mock('@/hooks/useSubAccountBranding', () => ({
  useSubAccountBranding: () => ({ companyName: null, logoUrl: null }),
}))

// This is the hook under test (via Router's DataAgentRoute) — mocked here so
// each test can drive it through the exact { hasAccess, entitled, loading }
// shapes the bug fix cares about, independent of its own async/Supabase
// internals (those are covered by useDataAgentAccess.test.ts).
const useDataAgentAccessMock = vi.fn()
vi.mock('@/hooks/useDataAgentAccess', () => ({
  useDataAgentAccess: () => useDataAgentAccessMock(),
}))

// Lazy route targets, stubbed so the test only exercises DataAgentRoute's own
// gating logic, not the full real pages behind it.
vi.mock('@/features/data-agent/DataAgentPage', () => ({
  DataAgentPage: () => <div>data-agent-content</div>,
}))
vi.mock('@/features/time-tracking/TimeTrackingPage', () => ({
  TimeTrackingPage: () => <div>home-index</div>,
}))

import { AppRouter } from '../Router'

const staffUser: User = {
  id: 'u1', email: 'a@a.com', name: 'Alice', role: 'Admin', sub_account: 'AM333',
  manager_id: null, annual_leave: 14, time_off: 5, profile_image: null,
  reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'SG', phone: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function renderAt(path: string) {
  initialPath = path
  return render(
    <AuthContext.Provider value={{
      user: staffUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false, isAssociate: false,
      visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
      viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
      signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
      signOut: vi.fn(), refreshUser: vi.fn(),
    }}>
      <AppRouter />
    </AuthContext.Provider>
  )
}

describe('DataAgentRoute (exercised through AppRouter)', () => {
  it('shows a loading indicator and does NOT redirect while the access check is in flight', () => {
    useDataAgentAccessMock.mockReturnValue({ hasAccess: false, entitled: false, loading: true })
    const { container } = renderAt('/data-agent')

    // Loading must render a spinner in place, not bounce to "/" — this is
    // exactly the race the bug fix closes: hasAccess defaults to false
    // before the async check resolves, and the old code redirected on that
    // default instead of waiting.
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    expect(screen.queryByText('data-agent-content')).not.toBeInTheDocument()
    expect(screen.queryByText('home-index')).not.toBeInTheDocument()
  })

  it('renders the Data Agent page once the access check resolves true', async () => {
    useDataAgentAccessMock.mockReturnValue({ hasAccess: true, entitled: true, loading: false })
    renderAt('/data-agent')

    await waitFor(() => expect(screen.getByText('data-agent-content')).toBeInTheDocument())
  })

  it('redirects to "/" once the access check resolves false', async () => {
    useDataAgentAccessMock.mockReturnValue({ hasAccess: false, entitled: false, loading: false })
    renderAt('/data-agent')

    // No loading=true window here, so the guard should redirect immediately
    // (this is the pre-existing, still-correct "really has no access" path).
    await waitFor(() => expect(screen.getByText('home-index')).toBeInTheDocument())
    expect(screen.queryByText('data-agent-content')).not.toBeInTheDocument()
  })
})
