import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
let connectionRows: Record<string, unknown>[] = []
const membersData = vi.fn()
const insertMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'data_agent_connections') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: connectionRows }) }) }) }
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
    connectionRows = []
    membersData.mockReset().mockResolvedValue({ data: [] })
    insertMock.mockReset().mockResolvedValue({ error: null })
  })

  it('adds a new connection via add_data_agent_connection, never storing the PIT in a plain field', async () => {
    render(<DataAgentSettingsTab />)
    await userEvent.click(await screen.findByRole('button', { name: /\+ add connection/i }))
    await userEvent.type(screen.getByLabelText(/connection name/i), 'Acme Corp — Production')
    await userEvent.type(screen.getByLabelText(/GHL Location ID/i), 'loc_123')
    await userEvent.type(screen.getByLabelText(/Private Integration Token/i), 'pit_abc')
    await userEvent.click(screen.getByRole('button', { name: /^add connection$/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_data_agent_connection', {
      p_sub_account: 'AM333', p_label: 'Acme Corp — Production', p_ghl_location_id: 'loc_123', p_pit: 'pit_abc',
    }))
    expect(screen.queryByText(/pit_abc/)).not.toBeInTheDocument()
  })

  it('lists every existing connection by name and location id, with no PIT ever shown', async () => {
    connectionRows = [
      { id: 'conn-1', sub_account: 'AM333', label: 'Acme Corp — Production', ghl_location_id: 'loc_999', last_verified_at: null },
      { id: 'conn-2', sub_account: 'AM333', label: 'Acme Corp — Sandbox', ghl_location_id: 'loc_888', last_verified_at: null },
    ]
    render(<DataAgentSettingsTab />)
    expect(await screen.findByText('Acme Corp — Production')).toBeInTheDocument()
    expect(screen.getByText(/loc_999/)).toBeInTheDocument()
    expect(screen.getByText('Acme Corp — Sandbox')).toBeInTheDocument()
    expect(screen.getByText(/loc_888/)).toBeInTheDocument()
    expect(screen.queryByText(/pit_/)).not.toBeInTheDocument()
  })

  it('REGRESSION: a sub-account can have more than one connection — this is the whole point of the feature', async () => {
    connectionRows = [
      { id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null },
      { id: 'conn-2', sub_account: 'AM333', label: 'Client B', ghl_location_id: 'loc_b', last_verified_at: null },
      { id: 'conn-3', sub_account: 'AM333', label: 'Client C', ghl_location_id: 'loc_c', last_verified_at: null },
    ]
    render(<DataAgentSettingsTab />)
    expect(await screen.findByText('Client A')).toBeInTheDocument()
    expect(screen.getByText('Client B')).toBeInTheDocument()
    expect(screen.getByText('Client C')).toBeInTheDocument()
  })

  it('rotates a connection\'s token via update_data_agent_connection_token, not by deleting and re-adding it', async () => {
    connectionRows = [{ id: 'conn-1', sub_account: 'AM333', label: 'Acme Corp', ghl_location_id: 'loc_999', last_verified_at: null }]
    render(<DataAgentSettingsTab />)
    await userEvent.click(await screen.findByRole('button', { name: /rotate token/i }))
    await userEvent.type(screen.getByLabelText(/new token for acme corp/i), 'new_pit_value')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('update_data_agent_connection_token', {
      p_connection_id: 'conn-1', p_pit: 'new_pit_value',
    }))
  })

  it('removes a connection via delete_data_agent_connection', async () => {
    connectionRows = [{ id: 'conn-1', sub_account: 'AM333', label: 'Acme Corp', ghl_location_id: 'loc_999', last_verified_at: null }]
    render(<DataAgentSettingsTab />)
    await userEvent.click(await screen.findByRole('button', { name: /remove/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('delete_data_agent_connection', { p_connection_id: 'conn-1' }))
  })

  it('surfaces an error instead of silently doing nothing when removing a connection with migration history fails', async () => {
    connectionRows = [{ id: 'conn-1', sub_account: 'AM333', label: 'Acme Corp', ghl_location_id: 'loc_999', last_verified_at: null }]
    rpcMock.mockImplementation((fn: string) =>
      fn === 'delete_data_agent_connection'
        ? Promise.resolve({ error: { message: 'This connection has migration history and cannot be removed' } })
        : Promise.resolve({ error: null }))
    render(<DataAgentSettingsTab />)
    await userEvent.click(await screen.findByRole('button', { name: /remove/i }))
    expect(await screen.findByText(/cannot be removed/i)).toBeInTheDocument()
  })

  it('shows named candidates for explicit selection rather than auto-granting a partial-name match', async () => {
    const ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }, { id: 'u2', name: 'Jo Lee' }] })
    vi.mocked(await import('@/lib/supabase')).supabase.from = vi.fn((table: string) => {
      if (table === 'data_agent_connections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: connectionRows }) }) }) }
      if (table === 'data_agent_members') return { select: () => ({ eq: () => membersData() }), insert: (...args: unknown[]) => insertMock(...args) }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => ilikeMock() }) }) }) }
    }) as never

    render(<DataAgentSettingsTab />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByRole('button', { name: /jo smith/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /jo lee/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /jo lee/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalledWith({ sub_account: 'AM333', user_id: 'u2', added_by: 'admin-1' }))
  })

  it('surfaces a grant error instead of claiming success', async () => {
    const ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }] })
    vi.mocked(await import('@/lib/supabase')).supabase.from = vi.fn((table: string) => {
      if (table === 'data_agent_connections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: connectionRows }) }) }) }
      if (table === 'data_agent_members') return { select: () => ({ eq: () => membersData() }), insert: (...args: unknown[]) => insertMock(...args) }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => ilikeMock() }) }) }) }
    }) as never
    insertMock.mockResolvedValue({ error: { message: 'duplicate key' } })

    render(<DataAgentSettingsTab />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /jo smith/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/duplicate key/i)
  })
})
