import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn().mockResolvedValue({ error: null })
const orderMock = vi.fn().mockResolvedValue({ data: [] })
const singleMock = vi.fn().mockResolvedValue({ data: { managers_can_view_reports: false } })
const updateMock = vi.fn().mockResolvedValue({ error: null })
const functionsInvokeMock = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
const fakeArchiveSnapshot = {
  profile: {
    name: 'Cecillia', email: 'cecillia@amwelltechnologies.com', role: 'Staff', sub_account: 'AM333',
    country: 'SG', phone: null, annual_leave: 14, time_off: 40,
    reporting_time_in: '10:00', reporting_time_out: '19:00', member_since: '2026-01-01',
  },
  time_logs: [], leave_requests: [], tasks_created: [], tasks_assigned: [],
  kpi_daily_logs: [], documents: [], eod_reports: [],
}
const rpcMock = vi.fn((...args: unknown[]) => {
  const fnName = args[0]
  if (fnName === 'build_user_archive_snapshot') return Promise.resolve({ data: fakeArchiveSnapshot, error: null })
  if (fnName === 'archive_and_delete_user') return Promise.resolve({ data: 'archive-id', error: null })
  return Promise.resolve({ data: null, error: null })
})
const storageUploadMock = vi.fn().mockResolvedValue({ error: null })
const storageListMock = vi.fn().mockResolvedValue({ data: [], error: null })
const storageRemoveMock = vi.fn().mockResolvedValue({ data: [], error: null })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => functionsInvokeMock(...args),
    },
    from: vi.fn(() => {
      const qb = {
        select: vi.fn(() => qb),
        eq: vi.fn(() => qb),
        order: (...args: unknown[]) => orderMock(...args),
        insert: (...args: unknown[]) => insertMock(...args),
        update: (...args: unknown[]) => { updateMock(...args); return qb },
        single: (...args: unknown[]) => singleMock(...args),
      }
      return qb
    }),
    storage: {
      from: vi.fn(() => ({
        upload: (...args: unknown[]) => storageUploadMock(...args),
        list: (...args: unknown[]) => storageListMock(...args),
        remove: (...args: unknown[]) => storageRemoveMock(...args),
      })),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
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
  status: 'active',
  created_at: new Date().toISOString(),
  appointed_as: null,
  address_line1: null,
  address_line2: null,
  address_city: null,
  address_pin_code: null,
  last_ip_address: null,
  last_ip_captured_at: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  department_id: null,
}

const cecillia: User = {
  id: 'user-cecillia',
  email: 'cecillia@amwelltechnologies.com',
  name: 'Cecillia',
  role: 'Staff',
  sub_account: 'AM333',
  manager_id: null,
  annual_leave: 14,
  time_off: 40,
  profile_image: null,
  reporting_time_in: '10:00',
  reporting_time_out: '19:00',
  country: 'SG',
  phone: null,
  status: 'active',
  created_at: new Date().toISOString(),
  appointed_as: null,
  address_line1: null,
  address_line2: null,
  address_city: null,
  address_pin_code: null,
  last_ip_address: null,
  last_ip_captured_at: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  department_id: null,
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: currentUser, loading: false,
    accountBlockedMessage: null,
    isSuperAdmin: false,
    isAssociate: false,
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
    functionsInvokeMock.mockClear().mockResolvedValue({ data: { success: true }, error: null })
  })

  it('sends an invite automatically after creating a new user', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(orderMock).toHaveBeenCalled())
    await fillAndSubmitAddUserForm('Corporate Account', 'corporate@amwelltechnologies.com')

    await waitFor(() => expect(insertMock).toHaveBeenCalled())
    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('invite-staff-user', {
      body: { email: 'corporate@amwelltechnologies.com' },
    }))
  })

  it('shows a clear warning if the user is created but the invite email fails to send', async () => {
    functionsInvokeMock.mockResolvedValueOnce({ data: { error: 'SMTP error' }, error: null })

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
    expect(functionsInvokeMock).not.toHaveBeenCalledWith('invite-staff-user', expect.anything())
  })
})

describe('UsersTab — Set Password', () => {
  beforeEach(() => {
    orderMock.mockClear().mockResolvedValue({ data: [cecillia] })
    functionsInvokeMock.mockClear().mockResolvedValue({ data: { success: true }, error: null })
  })

  it('calls the admin-set-password function with the target user and new password', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    await userEvent.type(screen.getByPlaceholderText('At least 8 characters'), 'SuperSecret1')
    await userEvent.type(screen.getByPlaceholderText('Repeat the password'), 'SuperSecret1')
    await userEvent.click(screen.getByRole('button', { name: 'Set Password' }))

    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('admin-set-password', {
      body: { targetUserId: 'user-cecillia', password: 'SuperSecret1' },
    }))
    await waitFor(() => expect(screen.getByText(/no magic link needed/i)).toBeInTheDocument())
  })

  it('rejects mismatched passwords without calling the function', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    await userEvent.type(screen.getByPlaceholderText('At least 8 characters'), 'SuperSecret1')
    await userEvent.type(screen.getByPlaceholderText('Repeat the password'), 'DoesNotMatch1')
    await userEvent.click(screen.getByRole('button', { name: 'Set Password' }))

    await waitFor(() => expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument())
    expect(functionsInvokeMock).not.toHaveBeenCalled()
  })

  it('surfaces the function error message on failure', async () => {
    functionsInvokeMock.mockResolvedValueOnce({ data: { error: 'Only Admins can set passwords for other users' }, error: null })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    await userEvent.type(screen.getByPlaceholderText('At least 8 characters'), 'SuperSecret1')
    await userEvent.type(screen.getByPlaceholderText('Repeat the password'), 'SuperSecret1')
    await userEvent.click(screen.getByRole('button', { name: 'Set Password' }))

    await waitFor(() => expect(screen.getByText(/only admins can set passwords/i)).toBeInTheDocument())
  })

  it('surfaces the error message from a non-2xx function response (the real edge-function failure shape)', async () => {
    const contextResponse = { json: () => Promise.resolve({ error: 'Password must be at least 8 characters' }) }
    functionsInvokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: contextResponse },
    })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    await userEvent.type(screen.getByPlaceholderText('At least 8 characters'), 'SuperSecret1')
    await userEvent.type(screen.getByPlaceholderText('Repeat the password'), 'SuperSecret1')
    await userEvent.click(screen.getByRole('button', { name: 'Set Password' }))

    await waitFor(() => expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument())
  })
})

describe('UsersTab — Edit User email change', () => {
  beforeEach(() => {
    orderMock.mockClear().mockResolvedValue({ data: [cecillia] })
    functionsInvokeMock.mockClear().mockResolvedValue({ data: { success: true, noticeSent: true }, error: null })
    updateMock.mockClear().mockResolvedValue({ error: null })
  })

  async function openEditAndChangeEmail(newEmail: string) {
    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const emailInput = await screen.findByDisplayValue('cecillia@amwelltechnologies.com')
    await userEvent.clear(emailInput)
    if (newEmail) await userEvent.type(emailInput, newEmail)
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  }

  it('routes an email change through admin-change-email, then invites the new address', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await openEditAndChangeEmail('cecillia.new@amwelltechnologies.com')

    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('admin-change-email', {
      body: { targetUserId: 'user-cecillia', newEmail: 'cecillia.new@amwelltechnologies.com' },
    }))
    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('invite-staff-user', {
      body: { email: 'cecillia.new@amwelltechnologies.com' },
    }))
    await waitFor(() => expect(screen.getAllByText(/link to set up their password was sent/i).length).toBeGreaterThan(0))
  })

  it('does not call admin-change-email when the email field is left unchanged', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(functionsInvokeMock).not.toHaveBeenCalledWith('admin-change-email', expect.anything())
    expect(functionsInvokeMock).not.toHaveBeenCalledWith('invite-staff-user', expect.anything())
  })

  // Regression test: a stored email with stray whitespace (older row,
  // CSV import, manual entry — handleAdd's own .trim() only ever applied
  // going forward) used to make Save falsely detect an email change on
  // every edit, even when the admin never touched the Email field, sending
  // the save through admin-change-email instead of a plain profile update
  // and surfacing a confusing "Could not change email" error.
  it('does not treat stray whitespace in the stored email as a change', async () => {
    const cecilliaWithWhitespace: User = { ...cecillia, email: ' cecillia@amwelltechnologies.com ' }
    orderMock.mockClear().mockResolvedValue({ data: [cecilliaWithWhitespace] })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(functionsInvokeMock).not.toHaveBeenCalledWith('admin-change-email', expect.anything())
    expect(functionsInvokeMock).not.toHaveBeenCalledWith('invite-staff-user', expect.anything())
  })

  it('surfaces the error and does not send an invite when the email change fails', async () => {
    functionsInvokeMock.mockResolvedValueOnce({
      data: { error: 'That email is already used by another account.' }, error: null,
    })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await openEditAndChangeEmail('taken@amwelltechnologies.com')

    await waitFor(() => expect(screen.getAllByText(/already used by another account/i).length).toBeGreaterThan(0))
    expect(functionsInvokeMock).not.toHaveBeenCalledWith('invite-staff-user', expect.anything())
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe('UsersTab — per-row and bulk invite', () => {
  beforeEach(() => {
    orderMock.mockClear().mockResolvedValue({ data: [cecillia] })
    functionsInvokeMock.mockClear().mockResolvedValue({ data: { success: true }, error: null })
  })

  it('invites a single user via the per-row Invite button', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    // Exact match — "📧 Invite All" is a distinct button with its own
    // accessible name, not matched by this one.
    await userEvent.click(screen.getByRole('button', { name: '📧 Invite' }))

    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('invite-staff-user', {
      body: { email: 'cecillia@amwelltechnologies.com' },
    }))
    await waitFor(() => expect(screen.getByText(/invite sent to/i)).toBeInTheDocument())
  })

  it('surfaces an error from the per-row Invite button', async () => {
    functionsInvokeMock.mockResolvedValueOnce({ data: { error: 'You can only invite users in your own workspace.' }, error: null })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '📧 Invite' }))

    await waitFor(() => expect(screen.getByText(/could not invite cecillia/i)).toBeInTheDocument())
  })

  it('invites every user via Invite All', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '📧 Invite All' }))

    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('invite-staff-user', {
      body: { email: 'cecillia@amwelltechnologies.com' },
    }))
    await waitFor(() => expect(screen.getByText(/sent 1 invite/i)).toBeInTheDocument())
  })
})

// Regression tests: Admin's Edit form previously had no fields for address/
// emergency contact at all (those were self-edit only, from My Profile), so
// a user who never filled in their own profile left Admin's view showing
// "Not provided" with no way to do anything about it. Admin can now fill
// these in directly too.
describe('UsersTab — Edit User location and emergency contact', () => {
  beforeEach(() => {
    orderMock.mockClear().mockResolvedValue({ data: [cecillia] })
    updateMock.mockClear().mockResolvedValue({ error: null })
  })

  it("lets an Admin fill in a user's address and emergency contact, even when previously empty", async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await userEvent.type(await screen.findByPlaceholderText('Street address'), '123 Example Rd')
    await userEvent.type(screen.getByPlaceholderText('City'), 'Singapore')
    await userEvent.type(screen.getByPlaceholderText('Postal / pin code'), '123456')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Jane Doe')
    // "91234567" is also the main Phone field's placeholder — Emergency
    // Contact Phone is the second match in DOM order.
    await userEvent.type(screen.getAllByPlaceholderText('91234567')[1], '98765432')

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      address_line1: '123 Example Rd',
      address_city: 'Singapore',
      address_pin_code: '123456',
      emergency_contact_name: 'Jane Doe',
      emergency_contact_phone: '98765432',
    })))
  })

  it('pre-fills the edit form with existing address and emergency contact data', async () => {
    const cecilliaWithLocation: User = {
      ...cecillia,
      address_line1: '1 Raffles Place', address_city: 'Singapore', address_pin_code: '048616',
      emergency_contact_name: 'John Tan', emergency_contact_phone: '98765432',
    }
    orderMock.mockClear().mockResolvedValue({ data: [cecilliaWithLocation] })

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(await screen.findByDisplayValue('1 Raffles Place')).toBeInTheDocument()
    expect(screen.getByDisplayValue('048616')).toBeInTheDocument()
    expect(screen.getByDisplayValue('John Tan')).toBeInTheDocument()
    expect(screen.getByDisplayValue('98765432')).toBeInTheDocument()
  })
})

// Regression tests: archive_and_delete_user only ever removed the
// public.users row -- it has no way to reach Supabase Auth, which needs the
// service-role key. That left a stranded Auth account permanently reserving
// the deleted person's email, later colliding with admin-change-email or a
// fresh invite/signup for the same address with a confusing "Error updating
// user" message. admin-delete-user-auth closes that gap.
describe('UsersTab — Delete User also removes the Auth account', () => {
  const suspendedCecillia: User = { ...cecillia, status: 'suspended' }

  beforeEach(() => {
    orderMock.mockClear().mockResolvedValue({ data: [suspendedCecillia] })
    functionsInvokeMock.mockClear().mockResolvedValue({ data: { success: true }, error: null })
    rpcMock.mockClear()
    storageUploadMock.mockClear().mockResolvedValue({ error: null })
    storageListMock.mockClear().mockResolvedValue({ data: [], error: null })
  })

  async function openDeleteAndConfirm() {
    await waitFor(() => expect(screen.getByText('cecillia@amwelltechnologies.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: /archive & delete/i }))
  }

  it('deletes the Auth account before archiving and removing the user row', async () => {
    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await openDeleteAndConfirm()

    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalledWith('admin-delete-user-auth', {
      body: { targetUserId: 'user-cecillia' },
    }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('archive_and_delete_user', expect.anything()))

    const authDeleteCallOrder = functionsInvokeMock.mock.invocationCallOrder[0]
    const archiveDeleteCallOrder = rpcMock.mock.invocationCallOrder.find((_, i) => rpcMock.mock.calls[i][0] === 'archive_and_delete_user')
    expect(authDeleteCallOrder).toBeLessThan(archiveDeleteCallOrder!)
  })

  it('stops before deleting the user row if the Auth account cannot be removed', async () => {
    functionsInvokeMock.mockImplementation((name: string) =>
      name === 'admin-delete-user-auth'
        ? Promise.resolve({ data: { error: 'Could not reach the authentication service.' }, error: null })
        : Promise.resolve({ data: { success: true }, error: null })
    )

    render(
      <AuthContext.Provider value={makeCtx()}>
        <UsersTab />
      </AuthContext.Provider>
    )

    await openDeleteAndConfirm()

    await waitFor(() => expect(screen.getByText(/could not reach the authentication service/i)).toBeInTheDocument())
    expect(rpcMock).not.toHaveBeenCalledWith('archive_and_delete_user', expect.anything())
  })
})
