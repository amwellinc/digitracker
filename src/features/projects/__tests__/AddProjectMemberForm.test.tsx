import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const orMock = vi.fn()
const eqMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const qb = {
        select: () => qb,
        eq: (...args: unknown[]) => { eqMock(...args); return qb },
        or: (...args: unknown[]) => orMock(...args),
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
    orMock.mockReset().mockResolvedValue({
      data: [{ id: 'u2', name: 'Jane Staff', role: 'Staff' }],
    })
    eqMock.mockReset()
    rpcMock.mockReset().mockResolvedValue({ error: null })
  })

  // Regression test: the first version searched live as you typed, showing
  // a per-result "+ Add" button only once a match came back — with nothing
  // typed yet, or no match, there was no visible button anywhere, reading
  // as a feature with no button at all.
  it('always shows a clickable Search button, even before anything is typed', () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('searches the caller\'s own workspace on Search and excludes existing members', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={['u2']} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'Jane')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => expect(orMock).toHaveBeenCalledWith('name.ilike.%Jane%,email.ilike.%Jane%'))
    expect(screen.queryByText('Jane Staff')).not.toBeInTheDocument()
    expect(await screen.findByText(/no one in your workspace matched/i)).toBeInTheDocument()
  })

  // Regression test: an Admin trying to add someone usually has their
  // email, not their exact display name. The search used to filter on the
  // `name` column only, so typing an email always came back empty even for
  // a real same-workspace match. Found live: an Admin searching
  // "cs111@digi5y.com" got "No one in your workspace matched that name"
  // with no indication the search never even checked email.
  it('matches by email as well as name', async () => {
    orMock.mockResolvedValue({ data: [{ id: 'u5', name: 'CS Hundred Eleven', role: 'Staff' }] })
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'cs111@digi5y.com')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => expect(orMock).toHaveBeenCalledWith('name.ilike.%cs111@digi5y.com%,email.ilike.%cs111@digi5y.com%'))
    expect(await screen.findByText('CS Hundred Eleven')).toBeInTheDocument()
  })

  it('escapes LIKE wildcard characters in the search term', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), '50%_off')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => expect(orMock).toHaveBeenCalledWith('name.ilike.%50\\%\\_off%,email.ilike.%50\\%\\_off%'))
  })

  // Regression test: when nothing matches in the caller's own workspace,
  // the person being searched for may simply not be a member of this
  // workspace at all -- the fix for exactly that case is the Invite
  // associate form rendered alongside this one, but nothing used to point
  // an Admin toward it.
  it('points a non-Super-Admin toward Invite associate when nothing matches', async () => {
    orMock.mockResolvedValue({ data: [] })
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'cs111@digi5y.com')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))

    expect(await screen.findByText(/use invite associate below instead/i)).toBeInTheDocument()
  })

  it('adds a candidate via add_project_member and reports success', async () => {
    const onAdded = vi.fn()
    orMock.mockResolvedValue({ data: [{ id: 'u3', name: 'New Hire', role: 'Staff' }] })
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={onAdded} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'New')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    await userEvent.click(await screen.findByRole('button', { name: /new hire/i }))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_project_member', { p_project_id: 'p1', p_user_id: 'u3' }))
    expect(await screen.findByText(/New Hire added to this project/i)).toBeInTheDocument()
    expect(onAdded).toHaveBeenCalled()
  })

  it('surfaces an error from add_project_member without claiming success', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'This project already has members from 3 workspaces' } })
    orMock.mockResolvedValue({ data: [{ id: 'u3', name: 'New Hire', role: 'Staff' }] })
    render(
      <AuthContext.Provider value={makeCtx()}>
        <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
      </AuthContext.Provider>
    )

    await userEvent.type(screen.getByLabelText(/search your workspace/i), 'New')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    await userEvent.click(await screen.findByRole('button', { name: /new hire/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/3 workspaces/i)
  })

  // Regression test: add_project_member already lets a Super-Admin add
  // someone from ANY workspace, but this search was unconditionally scoped
  // to the caller's own sub_account — a Super-Admin could never even FIND
  // a cross-workspace person to add. Found live: an Admin got stuck trying
  // to invite an existing user from a different workspace, with no path
  // through either this form or invite-associate's own guidance.
  describe('as Super-Admin', () => {
    const superAdminUser: User = { ...adminUser, id: 'sa-1', role: 'Super-Admin' }

    it('shows copy for searching across all workspaces, not just one', () => {
      render(
        <AuthContext.Provider value={makeCtx({ user: superAdminUser, isSuperAdmin: true })}>
          <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
        </AuthContext.Provider>
      )
      expect(screen.getByText(/add a teammate from any workspace/i)).toBeInTheDocument()
    })

    it('searches without scoping to the caller\'s own sub_account', async () => {
      orMock.mockResolvedValue({
        data: [{ id: 'u9', name: 'Cross Account', role: 'Staff', sub_account: 'DIGI5Y' }],
      })
      render(
        <AuthContext.Provider value={makeCtx({ user: superAdminUser, isSuperAdmin: true })}>
          <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
        </AuthContext.Provider>
      )

      await userEvent.type(screen.getByLabelText(/search your workspace/i), 'Cross')
      await userEvent.click(screen.getByRole('button', { name: /search/i }))

      await waitFor(() => expect(orMock).toHaveBeenCalledWith('name.ilike.%Cross%,email.ilike.%Cross%'))
      expect(eqMock).not.toHaveBeenCalledWith('sub_account', expect.anything())
      expect(await screen.findByText('Cross Account')).toBeInTheDocument()
      expect(screen.getByText(/staff · digi5y/i)).toBeInTheDocument()
    })

    it('shows the all-workspaces empty-state copy when nothing matches', async () => {
      orMock.mockResolvedValue({ data: [] })
      render(
        <AuthContext.Provider value={makeCtx({ user: superAdminUser, isSuperAdmin: true })}>
          <AddProjectMemberForm projectId="p1" existingMemberIds={[]} onAdded={vi.fn()} />
        </AuthContext.Provider>
      )

      await userEvent.type(screen.getByLabelText(/search your workspace/i), 'Nobody')
      await userEvent.click(screen.getByRole('button', { name: /search/i }))

      expect(await screen.findByText(/no one matched that name or email/i)).toBeInTheDocument()
    })
  })
})
