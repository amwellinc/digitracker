import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const messagesData = [{ id: 'm1', user_id: 'u1', message: 'Started the contacts upload', created_at: '2026-10-01T00:00:00Z', users: { name: 'Jane' } }]
const insertMock = vi.fn()
let insertShouldFail = false

vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u2', sub_account: 'AM333' } }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: messagesData }) }) }),
      insert: (...args: unknown[]) => {
        insertMock(...args)
        return Promise.resolve({ error: insertShouldFail ? { message: 'insert failed' } : null })
      },
    })),
  },
}))

import { DataAgentChat } from '../DataAgentChat'

describe('DataAgentChat', () => {
  beforeEach(() => { insertMock.mockReset(); insertShouldFail = false })

  it('shows existing messages with the sender\'s name', async () => {
    render(<DataAgentChat subAccount="AM333" connectionId="conn-1" />)
    expect(await screen.findByText('Started the contacts upload')).toBeInTheDocument()
    expect(screen.getByText('Jane')).toBeInTheDocument()
  })

  it('sends a new message scoped to the connection (folder), not the whole sub-account', async () => {
    render(<DataAgentChat subAccount="AM333" connectionId="conn-1" />)
    await userEvent.type(await screen.findByLabelText(/message/i), 'Mapping looks good')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalledWith({ sub_account: 'AM333', connection_id: 'conn-1', user_id: 'u2', message: 'Mapping looks good' }))
  })

  it('REVIEW FINDING: keeps the draft and shows an error when sending fails, instead of silently clearing it', async () => {
    insertShouldFail = true
    render(<DataAgentChat subAccount="AM333" connectionId="conn-1" />)
    const input = await screen.findByLabelText(/message/i)
    await userEvent.type(input, 'Mapping looks good')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(input).toHaveValue('Mapping looks good')
  })
})
