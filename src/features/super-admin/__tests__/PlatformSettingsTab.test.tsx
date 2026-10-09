import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn()
const orderMock = vi.fn()
const maybeSingleMock = vi.fn()
const functionsInvokeMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const qb = {
        select: () => qb,
        eq: () => qb,
        order: (...args: unknown[]) => orderMock(table, ...args),
        limit: () => qb,
        maybeSingle: () => maybeSingleMock(table),
        insert: (...args: unknown[]) => insertMock(table, ...args),
        update: () => qb,
      }
      return qb
    }),
    functions: { invoke: (...args: unknown[]) => functionsInvokeMock(...args) },
  },
}))

import { PlatformSettingsTab } from '../PlatformSettingsTab'
import { AuthContext } from '@/features/auth/AuthContext'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const superAdmin: User = {
  id: 'sa-1', email: 'root@digi5y.co', name: 'Root', role: 'Super-Admin', sub_account: '__saas__',
  manager_id: null, annual_leave: 0, time_off: 0, profile_image: null,
  reporting_time_in: '09:00', reporting_time_out: '18:00', country: 'SG', phone: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: superAdmin, loading: false, accountBlockedMessage: null, isSuperAdmin: true, isAssociate: false,
    visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
    viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
    signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
    signOut: vi.fn(), refreshUser: vi.fn(),
    ...overrides,
  }
}

// Regression test: inviting a new Super-Admin into the existing platform
// sub-account used to call signInWithOtp() redirecting to the bare app
// origin -- a path HashRouter never bridges, stranding the invited person
// on "/" with only "Create an account" (the paid-plan signup) as a way
// forward, same root cause already fixed for Project Associate invites and
// Settings -> Users & Roles staff invites. It now reuses invite-staff-user,
// whose own authorization already allows a Super-Admin caller regardless
// of the target's sub_account.
describe('PlatformSettingsTab — invite Super-Admin sends a password-setup link, not a bare magic link', () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue({ error: null })
    orderMock.mockReset().mockResolvedValue({ data: [] })
    maybeSingleMock.mockReset().mockResolvedValue({ data: null })
    functionsInvokeMock.mockReset().mockResolvedValue({ data: { success: true }, error: null })
  })

  async function openInviteFormAndSubmit(name: string, email: string) {
    await waitFor(() => expect(orderMock).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /invite super admin/i }))
    await userEvent.type(screen.getByPlaceholderText('Jane Developer'), name)
    await userEvent.type(screen.getByPlaceholderText('jane@digi5y.com'), email)
    await userEvent.click(screen.getByRole('button', { name: /add & invite/i }))
  }

  it('routes the invite through invite-staff-user instead of a bare-origin signInWithOtp', async () => {
    render(<AuthContext.Provider value={makeCtx()}><PlatformSettingsTab /></AuthContext.Provider>)
    await openInviteFormAndSubmit('New Root', 'new-root@digi5y.co')

    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('invite-staff-user', {
      body: { email: 'new-root@digi5y.co' },
    }))
    expect(insertMock).toHaveBeenCalledWith('users', expect.objectContaining({
      email: 'new-root@digi5y.co', role: 'Super-Admin', sub_account: '__saas__',
    }))
  })

  it('surfaces the invite-staff-user error without claiming the invite succeeded', async () => {
    functionsInvokeMock.mockResolvedValue({ data: { error: 'SMTP relay unavailable' }, error: null })
    render(<AuthContext.Provider value={makeCtx()}><PlatformSettingsTab /></AuthContext.Provider>)
    await openInviteFormAndSubmit('New Root', 'new-root@digi5y.co')

    await waitFor(() => expect(screen.getByText(/invite email failed to send/i)).toBeInTheDocument())
    expect(screen.getByText(/SMTP relay unavailable/i)).toBeInTheDocument()
  })
})
