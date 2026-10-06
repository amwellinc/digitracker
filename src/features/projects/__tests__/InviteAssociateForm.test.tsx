import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}))

import { InviteAssociateForm } from '../InviteAssociateForm'

async function submit(email = 'Guest@Partner.com', name = 'Guest') {
  await userEvent.type(screen.getByPlaceholderText(/associate email/i), email)
  await userEvent.type(screen.getByPlaceholderText(/full name/i), name)
  await userEvent.click(screen.getByRole('button', { name: /invite associate/i }))
}

describe('InviteAssociateForm', () => {
  beforeEach(() => invokeMock.mockReset())

  it('invites a new associate and reports it', async () => {
    const onInvited = vi.fn()
    invokeMock.mockResolvedValueOnce({ data: { status: 'invited' }, error: null })
    render(<InviteAssociateForm projectId="p1" onInvited={onInvited} />)
    await submit()
    expect(invokeMock).toHaveBeenCalledWith('invite-associate', { body: { projectId: 'p1', email: 'Guest@Partner.com', name: 'Guest' } })
    await screen.findByText(/invited — an email was sent to Guest@Partner.com to set up their password/i)
    expect(onInvited).toHaveBeenCalled()
  })

  it('reports re-adding an existing associate', async () => {
    invokeMock.mockResolvedValueOnce({ data: { status: 'added' }, error: null })
    render(<InviteAssociateForm projectId="p1" onInvited={vi.fn()} />)
    await submit()
    await screen.findByText(/added to this project/i)
  })

  it('shows the 409 message for a workspace user and does not call onInvited', async () => {
    const onInvited = vi.fn()
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error: 'This email belongs to a workspace user — add them as a normal member instead.' }), { status: 409 }) },
    })
    render(<InviteAssociateForm projectId="p1" onInvited={onInvited} />)
    await submit()
    await screen.findByText(/belongs to a workspace user/i)
    expect(onInvited).not.toHaveBeenCalled()
  })

  it('labels its inputs and announces success as a status', async () => {
    invokeMock.mockResolvedValueOnce({ data: { status: 'added' }, error: null })
    render(<InviteAssociateForm projectId="p1" onInvited={vi.fn()} />)
    expect(screen.getByLabelText('Associate email')).toBeInTheDocument()
    expect(screen.getByLabelText('Associate full name')).toBeInTheDocument()
    await submit()
    expect(await screen.findByRole('status')).toHaveTextContent(/added to this project/i)
  })

  it('announces errors as an alert', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    render(<InviteAssociateForm projectId="p1" onInvited={vi.fn()} />)
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  // Regression test: the function can return 200 with BOTH a status (the
  // associate row was created/added) AND an error (the password-setup email
  // itself failed to send, e.g. a transient SMTP hiccup). The old message
  // concatenated the optimistic "invited — email sent" sentence with the
  // error text, reading as self-contradictory. It must show only the error.
  it('shows a clear, non-contradictory message when the invite email fails despite the associate being added', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { status: 'invited', error: 'Database error saving new user' }, error: null,
    })
    render(<InviteAssociateForm projectId="p1" onInvited={vi.fn()} />)
    await submit('pater@partner.com', 'Pater Kar')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Pater Kar was added, but the invite email could not be sent: Database error saving new user/i)
    expect(alert).not.toHaveTextContent(/email was sent to pater@partner.com to set up their password/i)
  })
})
