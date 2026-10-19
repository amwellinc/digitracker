import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

let connectionRow: Record<string, unknown> | null = {
  id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null,
}
let loadErrorRow: { message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: connectionRow, error: loadErrorRow }) }) }),
    })),
  },
}))

const newMigrationModalProps = vi.fn()
vi.mock('../../dashboard/DataAgentDashboard', () => ({
  DataAgentDashboard: ({ subAccount, connectionId }: { subAccount: string; connectionId: string }) => (
    <div data-testid="dashboard" data-sub-account={subAccount} data-connection-id={connectionId} />
  ),
}))
vi.mock('../../upload/NewMigrationModal', () => ({
  NewMigrationModal: (props: Record<string, unknown>) => { newMigrationModalProps(props); return <div data-testid="new-migration-modal" /> },
}))

import { DataAgentFolderPage } from '../DataAgentFolderPage'

function renderAt(connectionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/data-agent/connections/${connectionId}`]}>
      <Routes><Route path="/data-agent/connections/:connectionId" element={<DataAgentFolderPage />} /></Routes>
    </MemoryRouter>
  )
}

describe('DataAgentFolderPage', () => {
  beforeEach(() => {
    newMigrationModalProps.mockReset()
    connectionRow = { id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null }
    loadErrorRow = null
  })

  it('shows the connection\'s name and location id as the folder header', async () => {
    renderAt('conn-1')
    expect(await screen.findByText('Client A')).toBeInTheDocument()
    expect(screen.getByText(/loc_a/)).toBeInTheDocument()
  })

  it('has a back link to the folder list', async () => {
    renderAt('conn-1')
    expect(await screen.findByRole('link', { name: /all projects/i })).toHaveAttribute('href', '/data-agent')
  })

  it('renders the dashboard scoped to this one connection, not the whole sub-account\'s other folders', async () => {
    renderAt('conn-1')
    const dashboard = await screen.findByTestId('dashboard')
    expect(dashboard).toHaveAttribute('data-sub-account', 'AM333')
    expect(dashboard).toHaveAttribute('data-connection-id', 'conn-1')
  })

  it('opens New Migration pre-selected to this folder\'s connection', async () => {
    renderAt('conn-1')
    await userEvent.click(await screen.findByRole('button', { name: /new migration/i }))
    await waitFor(() => expect(screen.getByTestId('new-migration-modal')).toBeInTheDocument())
    expect(newMigrationModalProps).toHaveBeenCalledWith(expect.objectContaining({ subAccount: 'AM333', initialConnectionId: 'conn-1' }))
  })

  it('shows an error instead of a blank page when the connection cannot be found', async () => {
    connectionRow = null
    renderAt('missing-id')
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i)
  })
})
