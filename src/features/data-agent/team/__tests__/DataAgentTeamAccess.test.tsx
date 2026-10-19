import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const membersData = vi.fn()
const rpcMock = vi.fn()
let ilikeMock = vi.fn().mockResolvedValue({ data: [] })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'data_agent_members') {
        return { select: () => ({ eq: () => membersData() }) }
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => ilikeMock() }) }) }) }
    }),
  },
}))

import { DataAgentTeamAccess } from '../DataAgentTeamAccess'

describe('DataAgentTeamAccess', () => {
  beforeEach(() => {
    membersData.mockReset().mockResolvedValue({ data: [] })
    rpcMock.mockReset().mockResolvedValue({ error: null })
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
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_data_agent_member', { p_sub_account: 'AM333', p_user_id: 'u2' }))
  })

  it('surfaces a grant error instead of claiming success', async () => {
    ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }] })
    rpcMock.mockResolvedValue({ error: { message: 'duplicate key' } })

    render(<DataAgentTeamAccess subAccount="AM333" />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /jo smith/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/duplicate key/i)
  })

  it('REGRESSION: grants via the add_data_agent_member RPC, not a direct table insert — the RPC also fires an in-app notification server-side', async () => {
    ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }] })
    render(<DataAgentTeamAccess subAccount="AM333" />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /jo smith/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_data_agent_member', { p_sub_account: 'AM333', p_user_id: 'u1' }))
    expect(screen.getByText(/no invite email is sent/i)).toBeInTheDocument()
    expect(await screen.findByText(/has been notified/i)).toBeInTheDocument()
  })
})
