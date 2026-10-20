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
vi.mock('../folders/DataAgentFolderList', () => ({
  DataAgentFolderList: ({ subAccount }: { subAccount: string }) => <div data-testid="folders-for">{subAccount}</div>,
}))

import { DataAgentPage } from '../DataAgentPage'

describe('DataAgentPage', () => {
  it('defaults the folder list to the signed-in user\'s own sub-account', () => {
    render(<DataAgentPage />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('folders-for')).toHaveTextContent('AM333')
  })

  it('switching workspace re-points the folder list at the chosen client sub-account', async () => {
    render(<DataAgentPage />, { wrapper: MemoryRouter })
    await userEvent.click(screen.getByText('switch-to-joy'))
    expect(screen.getByTestId('folders-for')).toHaveTextContent('JOY')
  })

  it('REGRESSION: has no top-level "New Migration" shortcut — a migration always belongs to one project, so the only entry point is "+ New Project" then New Migration from inside that project', () => {
    render(<DataAgentPage />, { wrapper: MemoryRouter })
    expect(screen.queryByRole('button', { name: /new migration/i })).not.toBeInTheDocument()
  })
})
