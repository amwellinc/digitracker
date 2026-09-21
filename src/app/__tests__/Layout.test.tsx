import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Layout } from '../Layout'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

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

const useProjectMembershipsMock = vi.fn()
vi.mock('@/hooks/useProjectMemberships', () => ({
  useProjectMemberships: () => useProjectMembershipsMock(),
}))
vi.mock('@/hooks/useReportsAccess', () => ({ useReportsAccess: () => false }))
vi.mock('@/hooks/useSubAccountBranding', () => ({ useSubAccountBranding: () => ({ companyName: null, logoUrl: null }) }))

const staffUser: User = {
  id: 'u1', email: 'a@a.com', name: 'Alice', role: 'Staff', sub_account: 'AM333',
  manager_id: null, annual_leave: 14, time_off: 5, profile_image: null,
  reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'SG', phone: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function renderLayout() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{
        user: staffUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false,
        visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
        viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
        signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
        signOut: vi.fn(), refreshUser: vi.fn(),
      }}>
        <Layout />
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

describe('Layout — dynamic Projects nav', () => {
  it('shows no Projects entry when the user has no project memberships', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [], loading: false })
    renderLayout()
    expect(screen.queryByText(/^PROJECTS-/)).not.toBeInTheDocument()
  })

  it('shows one nav entry per project membership, labeled PROJECTS-<name>', () => {
    useProjectMembershipsMock.mockReturnValue({
      memberships: [{ id: 'p1', name: 'JohnBakery' }, { id: 'p2', name: 'AcmeCorp' }],
      loading: false,
    })
    renderLayout()
    expect(screen.getByText('PROJECTS-JohnBakery')).toBeInTheDocument()
    expect(screen.getByText('PROJECTS-AcmeCorp')).toBeInTheDocument()
  })
})
