import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const subAccountsData = [{ code: 'AM333', company_name: 'AM333 Wellness' }, { code: 'JOY', company_name: 'JOY Consultancy' }]
let relationships: { provider_sub_account: string; client_sub_account: string }[] = []
const insertMock = vi.fn()
const deleteMock = vi.fn()
let insertShouldFail = false

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'super-admin-1' } }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'sub_accounts') return { select: () => ({ order: () => Promise.resolve({ data: subAccountsData }) }) }
      return {
        select: () => ({ order: () => Promise.resolve({ data: relationships }) }),
        insert: (...args: unknown[]) => {
          insertMock(...args)
          return Promise.resolve({ error: insertShouldFail ? { message: 'duplicate key' } : null })
        },
        delete: () => ({ eq: () => ({ eq: () => { deleteMock(); return Promise.resolve({ error: null }) } }) }),
      }
    }),
  },
}))

import { ProviderClientsPanel } from '../ProviderClientsPanel'

describe('ProviderClientsPanel', () => {
  beforeEach(() => { insertMock.mockReset(); deleteMock.mockReset(); relationships = []; insertShouldFail = false })

  it('grants AM333 as a provider for JOY, inserting the relationship', async () => {
    render(<ProviderClientsPanel />)
    await userEvent.selectOptions(await screen.findByLabelText(/provider/i), 'AM333')
    await userEvent.selectOptions(screen.getByLabelText(/client/i), 'JOY')
    await userEvent.click(screen.getByRole('button', { name: /grant/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalledWith({ provider_sub_account: 'AM333', client_sub_account: 'JOY', added_by: 'super-admin-1' }))
  })

  it('lists existing relationships and can revoke one', async () => {
    relationships = [{ provider_sub_account: 'AM333', client_sub_account: 'JOY' }]
    render(<ProviderClientsPanel />)
    expect(await screen.findByText(/AM333.*JOY/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => expect(deleteMock).toHaveBeenCalled())
  })

  it('REVIEW FINDING: surfaces an error when granting a cross-tenant relationship fails, rather than looking identical to success', async () => {
    insertShouldFail = true
    render(<ProviderClientsPanel />)
    await userEvent.selectOptions(await screen.findByLabelText(/provider/i), 'AM333')
    await userEvent.selectOptions(screen.getByLabelText(/client/i), 'JOY')
    await userEvent.click(screen.getByRole('button', { name: /grant/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
