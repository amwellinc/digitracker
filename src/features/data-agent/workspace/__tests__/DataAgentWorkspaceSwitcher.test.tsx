import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

let clientsData: { client_sub_account: string }[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ select: () => ({ eq: () => Promise.resolve({ data: clientsData }) }) })) },
}))

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
})
