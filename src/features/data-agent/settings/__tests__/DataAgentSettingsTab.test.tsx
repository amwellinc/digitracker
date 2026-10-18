import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const connectionSingle = vi.fn()
const membersData = vi.fn()
const insertMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'data_agent_connections') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => connectionSingle() }) }) }
      }
      if (table === 'data_agent_members') {
        return {
          select: () => ({ eq: () => membersData() }),
          insert: (...args: unknown[]) => insertMock(...args),
        }
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => Promise.resolve({ data: [] }) }) }) }) }
    }),
  },
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1', sub_account: 'AM333', role: 'Admin' } }) }))

import { DataAgentSettingsTab } from '../DataAgentSettingsTab'

describe('DataAgentSettingsTab', () => {
  beforeEach(() => {
    rpcMock.mockReset().mockResolvedValue({ error: null })
    connectionSingle.mockReset().mockResolvedValue({ data: null })
    membersData.mockReset().mockResolvedValue({ data: [] })
    insertMock.mockReset().mockResolvedValue({ error: null })
  })

  it('saves the connection via save_data_agent_connection, never storing the PIT in a plain field', async () => {
    render(<DataAgentSettingsTab />)
    await userEvent.type(await screen.findByLabelText(/GHL Location ID/i), 'loc_123')
    await userEvent.type(screen.getByLabelText(/Private Integration Token/i), 'pit_abc')
    await userEvent.click(screen.getByRole('button', { name: /save connection/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('save_data_agent_connection', {
      p_sub_account: 'AM333', p_ghl_location_id: 'loc_123', p_pit: 'pit_abc',
    }))
  })

  it('shows an existing connection without ever displaying the PIT', async () => {
    connectionSingle.mockResolvedValue({ data: { ghl_location_id: 'loc_999', last_verified_at: null } })
    render(<DataAgentSettingsTab />)
    expect(await screen.findByDisplayValue('loc_999')).toBeInTheDocument()
    expect(screen.queryByText(/pit_/)).not.toBeInTheDocument()
  })
})
