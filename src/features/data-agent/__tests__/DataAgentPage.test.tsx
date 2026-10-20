import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

let authUser: { sub_account: string; role?: string } = { sub_account: 'AM333' }
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authUser }) }))
const switcherProps = vi.fn()
vi.mock('../workspace/DataAgentWorkspaceSwitcher', () => ({
  DataAgentWorkspaceSwitcher: (props: { onChange: (s: string) => void }) => {
    switcherProps(props)
    return <button onClick={() => props.onChange('JOY')}>switch-to-joy</button>
  },
}))
vi.mock('../folders/DataAgentFolderList', () => ({
  DataAgentFolderList: ({ subAccount }: { subAccount: string }) => <div data-testid="folders-for">{subAccount}</div>,
}))

import { DataAgentPage } from '../DataAgentPage'

describe('DataAgentPage', () => {
  beforeEach(() => { authUser = { sub_account: 'AM333' }; switcherProps.mockReset() })

  it('REGRESSION: tells the workspace switcher when the signed-in user is a Super-Admin, so it can offer every entitled sub-account, not just provider-client relationships', () => {
    authUser = { sub_account: 'DIGI5Y-OPS', role: 'Super-Admin' }
    render(<DataAgentPage />, { wrapper: MemoryRouter })
    expect(switcherProps).toHaveBeenCalledWith(expect.objectContaining({ isSuperAdmin: true }))
  })

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
