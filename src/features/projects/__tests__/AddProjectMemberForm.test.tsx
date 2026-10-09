import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ilikeMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const qb = {
        select: () => qb,
        eq: () => qb,
        ilike: (...args: unknown[]) => ilikeMock(...args),
      }
      return qb
    }),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))

import { AddProjectMemberForm } from '../AddProjectMemberForm'
import { AuthContext } from '@/features/auth/AuthContext'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const adminUser: User = {
  id: 'admin-1', email: 'admin@am333.com', name: 'Admin', role: 'Admin', sub_account: 'AM333',
  manager_id: null, annual_leave: 14, time_off: 40, profile_image: null,
  reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'SG', phone: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: adminUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false, isAssociate: false,
    visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
    viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
    signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
    signOut: vi.fn(), refreshUser: vi.fn(),
    ...overrides,
  }
}

// Regression test: add_project_member already allowed Admin/Manager to add
// a teammate from their own sub_account, but the only UI that called it was
// buried inside task creation's "Assign To" picker -- there was no direct
// way to just add someone to the project without creating a task as a side
// effect. This gives Admin/Manager a standalone control for it.
describe('AddProjectMemberForm', () => {
  beforeEach(() => {
    ilikeMock.mockReset().mockResolvedValue({
      data: [{ id: 'u2', name: 'Jane Staff', role: 'Staff' }],
    })
    rpcMock.mockReset().mockResolvedValue({ error: null })
  })

  it('searches the caller\'s own workspace and excludes existing members', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={['u2']} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'Jane')
    await waitFor(() => expect(ilikeMock).toHaveBeenCalledWith('name', '%Jane%'))
    expect(screen.queryByText('Jane Staff')).not.toBeInTheDocument()
  })

  it('adds a candidate via add_project_member and reports success', async () => {
    const onAdded = vi.fn()
    ilikeMock.mockResolvedValue({ data: [{ id: 'u3', name: 'New Hire', role: 'Staff' }] })
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={onAdded} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'New')
    await userEvent.click(await screen.findByRole('button', { name: /new hire/i }))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_project_member', { p_project_id: 'p1', p_user_id: 'u3' }))
    expect(await screen.findByText(/New Hire added to this project/i)).toBeInTheDocument()
    expect(onAdded).toHaveBeenCalled()
  })

  it('surfaces an error from add_project_member without claiming success', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'This project already has members from 3 workspaces' } })
    ilikeMock.mockResolvedValue({ data: [{ id: 'u3', name: 'New Hire', role: 'Staff' }] })
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'New')
    await userEvent.click(await screen.findByRole('button', { name: /new hire/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/3 workspaces/i)
  })
})
