import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const subAccountsData = [{ code: 'AM333', company_name: 'AM333 Wellness' }, { code: 'DERMITAGE', company_name: 'Dermitage' }]
const entitlementsData = [{ sub_account: 'AM333', enabled: true }]
const upsertMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: () => ({
        order: () => Promise.resolve(table === 'sub_accounts' ? { data: subAccountsData } : { data: entitlementsData }),
      }),
      upsert: (...args: unknown[]) => upsertMock(table, ...args),
    })),
  },
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-user-id' } }) }))

import { DataAgentEntitlementsTab } from '../DataAgentEntitlementsTab'

describe('DataAgentEntitlementsTab', () => {
  beforeEach(() => { upsertMock.mockReset().mockResolvedValue({ error: null }) })

  it('lists every sub-account with its current entitlement state', async () => {
    render(<DataAgentEntitlementsTab />)
    expect(await screen.findByText('AM333 Wellness')).toBeInTheDocument()
    expect(screen.getByText('Dermitage')).toBeInTheDocument()
    const toggles = screen.getAllByRole('checkbox')
    expect(toggles[0]).toBeChecked()
    expect(toggles[1]).not.toBeChecked()
  })

  it('enabling a sub-account upserts data_agent_entitlements', async () => {
    render(<DataAgentEntitlementsTab />)
    await screen.findByText('Dermitage')
    const toggles = screen.getAllByRole('checkbox')
    await userEvent.click(toggles[1])
    await waitFor(() => expect(upsertMock).toHaveBeenCalledWith(
      'data_agent_entitlements',
      expect.objectContaining({ sub_account: 'DERMITAGE', enabled: true }),
    ))
  })

  it('surfaces an upsert error without flipping the checkbox', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'permission denied' } })
    render(<DataAgentEntitlementsTab />)
    await screen.findByText('Dermitage')
    const toggles = screen.getAllByRole('checkbox')
    await userEvent.click(toggles[1])
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
    expect(toggles[1]).not.toBeChecked()
  })
})
