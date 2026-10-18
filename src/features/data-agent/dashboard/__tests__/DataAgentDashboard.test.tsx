import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'

const migrationsData = [
  { id: 'mig-1', status: 'completed', row_count: 100, accuracy_rating: 92, created_at: '2026-10-01T00:00:00Z', original_filename: 'contacts.csv' },
  { id: 'mig-2', status: 'mapping', row_count: 500, accuracy_rating: null, created_at: '2026-10-05T00:00:00Z', original_filename: 'orders.csv' },
]
const membersData = [{ user_id: 'u1', users: { name: 'Jane' } }]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'data_agent_migrations') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: migrationsData }) }) }) }
      return { select: () => ({ eq: () => Promise.resolve({ data: membersData }) }) }
    }),
  },
}))

import { DataAgentDashboard } from '../DataAgentDashboard'

describe('DataAgentDashboard', () => {
  it('shows the latest migration with its real status, not implied success, and excludes it from the completed count', async () => {
    render(<MemoryRouter><DataAgentDashboard subAccount="AM333" /></MemoryRouter>)
    expect(await screen.findByText('orders.csv')).toBeInTheDocument()
    expect(screen.getByTestId('latest-status')).toHaveTextContent(/mapping/i)
    expect(screen.getByTestId('completed-count')).toHaveTextContent('1')
    expect(screen.getByTestId('records-processed')).toHaveTextContent('100')
  })

  it('lists team members by name', async () => {
    render(<MemoryRouter><DataAgentDashboard subAccount="AM333" /></MemoryRouter>)
    expect(await screen.findByText('Jane')).toBeInTheDocument()
  })
})
