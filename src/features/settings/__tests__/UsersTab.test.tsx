import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn().mockResolvedValue({ error: null })
const orderMock = vi.fn().mockResolvedValue({ data: [] })
const signInWithOtpMock = vi.fn().mockResolvedValue({ error: null })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtpMock(...args),
    },
    from: vi.fn(() => {
      const qb = {
        select: vi.fn(() => qb),
        eq: vi.fn(() => qb),
        order: (...args: unknown[]) => orderMock(...args),
        insert: (...args: unknown[]) => insertMock(...args),
      }
      return qb
    }),
  },
}))

import { UsersTab } from '../UsersTab'
import { AuthContext } from '@/features/auth/AuthContext'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const currentUser: User = {
  id: 'admin-1',
  email: 'admin@amwelltechnology.com',
  name: 'Admin User',
  role: 'Admin',
  sub_account: 'AM333',
  manager_id: null,
  annual_leave: 14,
  time_off: 40,
  profile_image: null,
  reporting_time_in: '10:00',
  reporting_time_out: '19:00',
  country: 'SG',
  phone: null,
  created_at: new Date().toISOString(),
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: currentUser, loading: false,
    isSuperAdmin: false,
    visitingAccount: null,
    visitSubAccount: vi.fn(),
    exitVisit: vi.fn(),
    viewAsUser: null,
    startViewAs: vi.fn(),
    exitViewAs: vi.fn(),
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    sendPasswordReset: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn(),
    refreshUser: vi.fn(),
    ...overrides,
  }
}

async function fillAndSubmitAddUserForm(name: string, email: string) {
  await userEvent.click(screen.getByRole('button', { name: '+ Add User' }))
  await userEvent.type(screen.getByPlaceholderText('Jane Smith'), name)
  await userEvent.type(screen.getByPlaceholderText('jane@company.com'), email)
  const emailInput = screen.getByPlaceholderText('jane@company.com')
  const form = emailInput.closest('form')
  if (!form) throw new Error('Add User form not found')
  await userEvent.click(screen.getByRole('button', { name: 'Add User' }))
  return form
}

describe('UsersTab — Add User', () => {
  beforeEach(() => {
    insertMock.mockClear().mockResolvedValue({ error: null })
    orderMock.mockClear().mockResolvedValue({ data: [] })
    signInWithOtpMock.mockClear().mockResolvedValue({ error: null })
  })

  it('sends a magic-link invite automatically after creating a new user', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(orderMock).toHaveBeenCalled())
    await fillAndSubmitAddUserForm('Corporate Account', 'corporate@amwelltechnologies.com')

    await waitFor(() => expect(insertMock).toHaveBeenCalled())
    await waitFor(() => expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: 'corporate@amwelltechnologies.com',
      options: { emailRedirectTo: window.location.origin },
    }))
  })

  it('shows a clear warning if the user is created but the invite email fails to send', async () => {
    signInWithOtpMock.mockResolvedValueOnce({ error: { message: 'SMTP error' } })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(orderMock).toHaveBeenCalled())
    await fillAndSubmitAddUserForm('Corporate Account', 'corporate@amwelltechnologies.com')

    await waitFor(() => expect(screen.getAllByText(/invite email failed to send/i).length).toBeGreaterThan(0))
    expect(screen.getAllByText(/SMTP error/).length).toBeGreaterThan(0)
  })

  it('does not attempt to send an invite if user creation itself fails', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'duplicate email' } })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(orderMock).toHaveBeenCalled())
    await fillAndSubmitAddUserForm('Corporate Account', 'corporate@amwelltechnologies.com')

    await waitFor(() => expect(screen.getAllByText(/duplicate email/i).length).toBeGreaterThan(0))
    expect(signInWithOtpMock).not.toHaveBeenCalled()
  })
})
