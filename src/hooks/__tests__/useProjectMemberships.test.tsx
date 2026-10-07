import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { useProjectMemberships } from '../useProjectMemberships'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const selectMock = vi.fn()
const orderMock = vi.fn()
const fromMock = vi.fn()
const channelMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...fromArgs: unknown[]) => { fromMock(...fromArgs); return { select: (...args: unknown[]) => { selectMock(...args); return { order: (...orderArgs: unknown[]) => orderMock(...orderArgs) } } } },
    channel: (...args: unknown[]) => { channelMock(...args); return { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() } },
    removeChannel: vi.fn(),
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
      user: mockUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false, isAssociate: false,
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
  it('returns an empty list when the user has no visible projects', async () => {
    orderMock.mockResolvedValueOnce({ data: [] })
    const { result } = renderHook(() => useProjectMemberships(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.memberships).toEqual([])
  })

  // Queries projects directly (not project_members filtered to this user)
  // so RLS alone decides visibility — including an Admin who can see a
  // project through their sub_account's participation without personally
  // having a project_members row (is_project_member() grants that, but a
  // user_id-filtered query would still hide it).
  it('maps every RLS-visible project row into {id, name}', async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: 'p1', name: 'JohnBakery' },
        { id: 'p2', name: 'AcmeCorp' },
      ],
    })
    const { result } = renderHook(() => useProjectMemberships(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.memberships).toEqual([
      { id: 'p1', name: 'JohnBakery' },
      { id: 'p2', name: 'AcmeCorp' },
    ])
    expect(fromMock).toHaveBeenCalledWith('projects')
    expect(selectMock).toHaveBeenCalledWith('id, name')
  })

  // Regression test: on any project page, this hook runs simultaneously in
  // Layout.tsx's sidebar AND in ProjectGuard. A shared/hardcoded realtime
  // channel name meant the second instance's .on() call collided with the
  // first instance's already-subscribed channel, throwing an uncaught error
  // that (with no error boundary in the app) blanked the entire page on
  // every project navigation.
  it('gives each simultaneously-mounted instance its own realtime channel name', async () => {
    orderMock.mockResolvedValue({ data: [] })
    channelMock.mockClear()

    renderHook(() => useProjectMemberships(), { wrapper })
    renderHook(() => useProjectMemberships(), { wrapper })

    await waitFor(() => expect(channelMock).toHaveBeenCalledTimes(2))
    const [firstTopic] = channelMock.mock.calls[0]
    const [secondTopic] = channelMock.mock.calls[1]
    expect(firstTopic).not.toEqual(secondTopic)
  })
})
