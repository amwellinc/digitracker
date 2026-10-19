import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'

let connectionRows: Record<string, unknown>[] = []
let loadErrorRow: { message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
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
  it('shows one folder card per connection, named by label with its location id', async () => {
    connectionRows = [
      { id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null },
      { id: 'conn-2', sub_account: 'AM333', label: 'Client B', ghl_location_id: 'loc_b', last_verified_at: null },
    ]
    loadErrorRow = null
    renderList()
    expect(await screen.findByText('Client A')).toBeInTheDocument()
    expect(screen.getByText(/loc_a/)).toBeInTheDocument()
    expect(screen.getByText('Client B')).toBeInTheDocument()
    expect(screen.getByText(/loc_b/)).toBeInTheDocument()
  })

  it('links each folder card to its own connection page, not a shared dashboard', async () => {
    connectionRows = [{ id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null }]
    loadErrorRow = null
    renderList()
    const link = await screen.findByRole('link', { name: /client a/i })
    expect(link).toHaveAttribute('href', '/data-agent/connections/conn-1')
  })

  it('shows a setup prompt linking to Settings when there are no connections yet', async () => {
    connectionRows = []
    loadErrorRow = null
    renderList()
    expect(await screen.findByText(/no ghl connections yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings?tab=data-agent')
  })

  it('surfaces a load error instead of silently showing an empty list', async () => {
    connectionRows = []
    loadErrorRow = { message: 'network error' }
    renderList()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load connections/i)
  })
})
