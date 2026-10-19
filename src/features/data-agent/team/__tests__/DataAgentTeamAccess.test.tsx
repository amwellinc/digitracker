import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const membersData = vi.fn()
const insertMock = vi.fn()
let ilikeMock = vi.fn().mockResolvedValue({ data: [] })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'data_agent_members') {
        return {
          select: () => ({ eq: () => membersData() }),
          insert: (...args: unknown[]) => insertMock(...args),
        }
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => ilikeMock() }) }) }) }
    }),
  },
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1', sub_account: 'AM333', role: 'Admin' } }) }))

import { DataAgentTeamAccess } from '../DataAgentTeamAccess'

describe('DataAgentTeamAccess', () => {
  beforeEach(() => {
    membersData.mockReset().mockResolvedValue({ data: [] })
    insertMock.mockReset().mockResolvedValue({ error: null })
    ilikeMock = vi.fn().mockResolvedValue({ data: [] })
  })

  it('shows named candidates for explicit selection rather than auto-granting a partial-name match', async () => {
    ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }, { id: 'u2', name: 'Jo Lee' }] })

    render(<DataAgentTeamAccess subAccount="AM333" />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByRole('button', { name: /jo smith/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /jo lee/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /jo lee/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalledWith({ sub_account: 'AM333', user_id: 'u2', added_by: 'admin-1' }))
  })

  it('surfaces a grant error instead of claiming success', async () => {
    ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }] })
    insertMock.mockResolvedValue({ error: { message: 'duplicate key' } })

    render(<DataAgentTeamAccess subAccount="AM333" />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /jo smith/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/duplicate key/i)
  })

  it('never invokes an invite flow — granting is a direct insert, no email/auth call involved', async () => {
    ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }] })
    render(<DataAgentTeamAccess subAccount="AM333" />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /jo smith/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalled())
    expect(screen.getByText(/no invite email is sent/i)).toBeInTheDocument()
  })
})
