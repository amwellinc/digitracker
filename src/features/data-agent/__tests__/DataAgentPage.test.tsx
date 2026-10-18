import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { sub_account: 'AM333' } }) }))
vi.mock('../workspace/DataAgentWorkspaceSwitcher', () => ({
  DataAgentWorkspaceSwitcher: ({ onChange }: { onChange: (s: string) => void }) => (
    <button onClick={() => onChange('JOY')}>switch-to-joy</button>
  ),
}))
vi.mock('../dashboard/DataAgentDashboard', () => ({
  DataAgentDashboard: ({ subAccount }: { subAccount: string }) => <div data-testid="dashboard-for">{subAccount}</div>,
}))
vi.mock('../upload/NewMigrationModal', () => ({ NewMigrationModal: () => null }))

import { DataAgentPage } from '../DataAgentPage'

describe('DataAgentPage', () => {
  it('defaults the dashboard to the signed-in user\'s own sub-account', () => {
    render(<DataAgentPage />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('dashboard-for')).toHaveTextContent('AM333')
  })

  it('switching workspace re-points the dashboard at the chosen client sub-account', async () => {
    render(<DataAgentPage />, { wrapper: MemoryRouter })
    await userEvent.click(screen.getByText('switch-to-joy'))
    expect(screen.getByTestId('dashboard-for')).toHaveTextContent('JOY')
  })
})
