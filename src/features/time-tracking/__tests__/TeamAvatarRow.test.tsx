import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { TeamAvatarRow } from '../TeamAvatarRow'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const adminUser: User = {
  id: 'admin1', email: 'admin@test.com', name: 'Admin 333', role: 'Admin',
  sub_account: 'AM333', manager_id: null, annual_leave: 14, time_off: 5,
  profile_image: null, reporting_time_in: '10:00', reporting_time_out: '19:00',
  country: 'SG', phone: null, status: 'active', created_at: '2026-01-01T00:00:00Z',
}

vi.mock('@/lib/supabase', () => {
  const members = [
    {
      id: 'u1', name: 'Alice Lee', email: 'alice@test.com', role: 'Staff',
      sub_account: 'AM333', manager_id: null, annual_leave: 14, time_off: 5,
      profile_image: null, reporting_time_in: '10:00', reporting_time_out: '19:00',
      status: 'active', created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'u2', name: 'Bob Smith', email: 'bob@test.com', role: 'Staff',
      sub_account: 'AM333', manager_id: null, annual_leave: 14, time_off: 5,
      profile_image: null, reporting_time_in: '10:00', reporting_time_out: '19:00',
      status: 'active', created_at: '2026-01-01T00:00:00Z',
    },
  ]
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: members }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: members }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnValue({}),
      }),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
  }
})

function wrap(children: React.ReactNode) {
  return (
    <AuthContext.Provider value={{
      user: adminUser, loading: false,
      accountBlockedMessage: null,
      isSuperAdmin: false,
      visitingAccount: null,
      visitSubAccount: vi.fn(),
      exitVisit: vi.fn(),
      viewAsUser: null,
      startViewAs: vi.fn(),
      exitViewAs: vi.fn(),
      signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(), signOut: vi.fn(), refreshUser: vi.fn(),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

describe('TeamAvatarRow', () => {
  it('renders team member avatars', async () => {
    render(wrap(<TeamAvatarRow />))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('opens activity drawer when avatar is clicked', async () => {
    render(wrap(<TeamAvatarRow />))
    await waitFor(() => screen.getByText('Alice'))
    await userEvent.click(screen.getByText('Alice').closest('button')!)
    expect(screen.getByText('Alice Lee')).toBeInTheDocument()
  })
})
