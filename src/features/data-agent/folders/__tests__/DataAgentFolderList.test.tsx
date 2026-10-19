import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

let connectionRows: Record<string, unknown>[] = []
let loadErrorRow: { message: string } | null = null
let authUser: { id: string; sub_account: string; role: string } | null = { id: 'admin-1', sub_account: 'AM333', role: 'Admin' }
const rpcMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authUser }) }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: connectionRows, error: loadErrorRow }) }) }),
    })),
  },
}))

import { DataAgentFolderList } from '../DataAgentFolderList'

function renderList() {
  return render(<MemoryRouter><DataAgentFolderList subAccount="AM333" /></MemoryRouter>)
}

describe('DataAgentFolderList', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1', sub_account: 'AM333', role: 'Admin' }
    rpcMock.mockReset().mockResolvedValue({ data: 'new-conn-id', error: null })
    navigateMock.mockReset()
    loadErrorRow = null
  })

  it('shows one folder card per connection, named by label with its location id', async () => {
    connectionRows = [
      { id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null },
      { id: 'conn-2', sub_account: 'AM333', label: 'Client B', ghl_location_id: 'loc_b', last_verified_at: null },
    ]
    renderList()
    expect(await screen.findByText('Client A')).toBeInTheDocument()
    expect(screen.getByText(/loc_a/)).toBeInTheDocument()
    expect(screen.getByText('Client B')).toBeInTheDocument()
    expect(screen.getByText(/loc_b/)).toBeInTheDocument()
  })

  it('links each folder card to its own connection page, not a shared dashboard', async () => {
    connectionRows = [{ id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null }]
    renderList()
    const link = await screen.findByRole('link', { name: /client a/i })
    expect(link).toHaveAttribute('href', '/data-agent/connections/conn-1')
  })

  it('REGRESSION: lets an Admin create a project folder directly here, not in Settings', async () => {
    connectionRows = []
    renderList()
    await userEvent.click(await screen.findByRole('button', { name: /create your first project/i }))
    await userEvent.type(screen.getByLabelText(/project name/i), 'Acme Corp')
    await userEvent.type(screen.getByLabelText(/ghl location id/i), 'loc_123')
    await userEvent.type(screen.getByLabelText(/private integration token/i), 'pit_abc')
    await userEvent.click(screen.getByRole('button', { name: /^create project$/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_data_agent_connection', {
      p_sub_account: 'AM333', p_label: 'Acme Corp', p_ghl_location_id: 'loc_123', p_pit: 'pit_abc',
    }))
    expect(navigateMock).toHaveBeenCalledWith('/data-agent/connections/new-conn-id')
  })

  it('tells a non-admin to ask an Admin instead of offering to create a project', async () => {
    authUser = { id: 'member-1', sub_account: 'AM333', role: 'Member' }
    connectionRows = []
    renderList()
    expect(await screen.findByText(/ask an admin/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create your first project/i })).not.toBeInTheDocument()
  })

  it('surfaces a load error instead of silently showing an empty list', async () => {
    connectionRows = []
    loadErrorRow = { message: 'network error' }
    renderList()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load connections/i)
  })
})
