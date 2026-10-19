import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DataAgentConnection } from '@/types/dataAgent'

let authUser: { id: string; sub_account: string; role: string } | null = { id: 'admin-1', sub_account: 'AM333', role: 'Admin' }
const rpcMock = vi.fn()
const invokeMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authUser }) }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}))

import { DataAgentConnectionPanel } from '../DataAgentConnectionPanel'

const CONNECTION: DataAgentConnection = { id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null }

function renderPanel(onChanged = vi.fn()) {
  return render(<MemoryRouter><DataAgentConnectionPanel connection={CONNECTION} onChanged={onChanged} /></MemoryRouter>)
}

describe('DataAgentConnectionPanel', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1', sub_account: 'AM333', role: 'Admin' }
    rpcMock.mockReset().mockResolvedValue({ error: null })
    invokeMock.mockReset().mockResolvedValue({ data: { ok: true }, error: null })
    navigateMock.mockReset()
  })

  it('renders nothing for a non-admin — only Admin/Super-Admin ever sees connection management', () => {
    authUser = { id: 'member-1', sub_account: 'AM333', role: 'Member' }
    const { container } = renderPanel()
    expect(container).toBeEmptyDOMElement()
  })

  it('tests the connection via connectionId and calls onChanged on success', async () => {
    const onChanged = vi.fn()
    renderPanel(onChanged)
    await userEvent.click(screen.getByRole('button', { name: /^test$/i }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('data-agent-test-connection', { body: { connectionId: 'conn-1' } }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(await screen.findByText(/verified/i)).toBeInTheDocument()
  })

  it('rotates the token via update_data_agent_connection_token', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /rotate token/i }))
    await userEvent.type(screen.getByLabelText(/new private integration token/i), 'new_pit')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('update_data_agent_connection_token', { p_connection_id: 'conn-1', p_pit: 'new_pit' }))
  })

  it('removes the connection and navigates back to the folder list on success', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('delete_data_agent_connection', { p_connection_id: 'conn-1' }))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/data-agent'))
  })

  it('surfaces a remove error instead of silently doing nothing', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'This connection has migration history and cannot be removed' } })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(await screen.findByText(/cannot be removed/i)).toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
