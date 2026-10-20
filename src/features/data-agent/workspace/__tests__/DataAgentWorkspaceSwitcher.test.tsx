import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

let clientsData: { client_sub_account: string }[] = []
let entitlementsData: { sub_account: string }[] = []
const fromMock = vi.fn((table: string) => {
  if (table === 'data_agent_entitlements') return { select: () => ({ eq: () => Promise.resolve({ data: entitlementsData }) }) }
  return { select: () => ({ eq: () => Promise.resolve({ data: clientsData }) }) }
})
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fromMock(table) } }))

import { DataAgentWorkspaceSwitcher } from '../DataAgentWorkspaceSwitcher'

describe('DataAgentWorkspaceSwitcher', () => {
  it('renders nothing when the sub-account services no clients', async () => {
    clientsData = []
    const { container } = render(<DataAgentWorkspaceSwitcher ownSubAccount="DERMITAGE" selected="DERMITAGE" onChange={vi.fn()} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('offers "My workspace" plus every granted client, and calls onChange on selection', async () => {
    clientsData = [{ client_sub_account: 'JOY' }]
    const onChange = vi.fn()
    render(<DataAgentWorkspaceSwitcher ownSubAccount="AM333" selected="AM333" onChange={onChange} />)
    const select = await screen.findByLabelText(/workspace/i)
    expect(screen.getByRole('option', { name: /my workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'JOY' })).toBeInTheDocument()
    await userEvent.selectOptions(select, 'JOY')
    expect(onChange).toHaveBeenCalledWith('JOY')
  })

  it('REGRESSION: a Super-Admin sees every entitled sub-account, not just ones linked via a provider-client relationship — provider_clients is an agency\'s own client list, not a platform-wide access grant, and a Super-Admin already has blanket access to any entitled sub-account regardless', async () => {
    clientsData = [] // no provider-client relationship set up for this Super-Admin's own sub-account
    entitlementsData = [{ sub_account: 'DIGI5Y-OPS' }, { sub_account: 'AM333' }, { sub_account: 'JOY' }]
    render(<DataAgentWorkspaceSwitcher ownSubAccount="DIGI5Y-OPS" selected="DIGI5Y-OPS" onChange={vi.fn()} isSuperAdmin />)
    expect(await screen.findByRole('option', { name: 'AM333' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'JOY' })).toBeInTheDocument()
    // Own sub-account must not be duplicated as a second option alongside "My workspace".
    expect(screen.queryByRole('option', { name: 'DIGI5Y-OPS' })).not.toBeInTheDocument()
    expect(fromMock).toHaveBeenCalledWith('data_agent_entitlements')
  })

  it('a non-super-admin still only sees provider-client relationships, even with the isSuperAdmin prop omitted', async () => {
    entitlementsData = [{ sub_account: 'AM333' }, { sub_account: 'JOY' }]
    clientsData = [{ client_sub_account: 'JOY' }]
    render(<DataAgentWorkspaceSwitcher ownSubAccount="AM333" selected="AM333" onChange={vi.fn()} />)
    const select = await screen.findByLabelText(/workspace/i)
    expect(select).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'DIGI5Y-OPS' })).not.toBeInTheDocument()
    expect(fromMock).toHaveBeenCalledWith('data_agent_provider_clients')
  })
})
