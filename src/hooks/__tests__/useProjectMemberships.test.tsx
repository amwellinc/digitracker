import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { useProjectMemberships } from '../useProjectMemberships'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const selectMock = vi.fn()
const eqMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: (...args: unknown[]) => { selectMock(...args); return { eq: (...eqArgs: unknown[]) => eqMock(...eqArgs) } },
    })),
  },
}))

const mockUser: User = {
  id: 'u1', email: 'a@a.com', name: 'Alice', role: 'Staff', sub_account: 'AM333',
  manager_id: null, annual_leave: 14, time_off: 5, profile_image: null,
  reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'SG', phone: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{
      user: mockUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false,
      visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
      viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
      signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
      signOut: vi.fn(), refreshUser: vi.fn(),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

describe('useProjectMemberships', () => {
  it('returns an empty list when the user has no project memberships', async () => {
    eqMock.mockResolvedValueOnce({ data: [] })
    const { result } = renderHook(() => useProjectMemberships(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.memberships).toEqual([])
  })

  it('maps joined project rows into {id, name}', async () => {
    eqMock.mockResolvedValueOnce({
      data: [
        { project_id: 'p1', projects: { name: 'JohnBakery' } },
        { project_id: 'p2', projects: { name: 'AcmeCorp' } },
      ],
    })
    const { result } = renderHook(() => useProjectMemberships(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.memberships).toEqual([
      { id: 'p1', name: 'JohnBakery' },
      { id: 'p2', name: 'AcmeCorp' },
    ])
  })
})
