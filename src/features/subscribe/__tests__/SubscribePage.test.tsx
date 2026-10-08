import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const qb = {
        select: () => qb,
        eq: () => qb,
        order: () => Promise.resolve({ data: [] }),
      }
      return qb
    }),
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}))

import { SubscribePage } from '../SubscribePage'

const freePlan = {
  id: 'free', name: 'Free', price_monthly: 0, price_annual: 0, max_seats: 3,
  features: [], is_active: true, sort_order: 1,
}
const usd = { code: 'USD', symbol: '$', flag: '🇺🇸', is_active: true, sort_order: 1 }

describe('SubscribePage — country and timezone at signup', () => {
  beforeEach(async () => {
    invokeMock.mockReset().mockResolvedValue({
      data: { success: true, code: 'DERM123', planName: 'Free' }, error: null,
    })
    rpcMock.mockReset().mockResolvedValue({ data: 0 })

    const { supabase } = await import('@/lib/supabase')
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const data = table === 'plan_configs' ? [freePlan] : table === 'currencies' ? [usd] : []
      const qb = { select: () => qb, eq: () => qb, order: () => Promise.resolve({ data }) }
      return qb as unknown as ReturnType<typeof supabase.from>
    })
  })

  it('lets a new sub-account pick any country and timezone and sends both to provision-subscription', async () => {
    render(<MemoryRouter><SubscribePage /></MemoryRouter>)

    await screen.findByText('Up to 3 users')
    await userEvent.click(screen.getByRole('button', { name: /Free/ }))

    await userEvent.type(screen.getByPlaceholderText('Acme Corp'), 'DERMITAGE')
    await userEvent.type(screen.getByPlaceholderText('you@company.com'), 'admin@dermitage.cz')
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'CZ')
    await userEvent.selectOptions(screen.getByLabelText('Work Calendar Timezone'), 'Europe/Prague')
    await userEvent.click(screen.getByRole('button', { name: /continue to review/i }))

    await userEvent.click(screen.getByRole('button', { name: /start free plan/i }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('provision-subscription', {
      body: expect.objectContaining({
        companyName: 'DERMITAGE',
        country: 'CZ',
        timezone: 'Europe/Prague',
      }),
    }))
  })

  it('defaults the timezone and leaves country unset when the admin picks neither', async () => {
    render(<MemoryRouter><SubscribePage /></MemoryRouter>)

    await screen.findByText('Up to 3 users')
    await userEvent.click(screen.getByRole('button', { name: /Free/ }))

    await userEvent.type(screen.getByPlaceholderText('Acme Corp'), 'Acme')
    await userEvent.type(screen.getByPlaceholderText('you@company.com'), 'a@acme.com')
    await userEvent.click(screen.getByRole('button', { name: /continue to review/i }))
    await userEvent.click(screen.getByRole('button', { name: /start free plan/i }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('provision-subscription', {
      body: expect.objectContaining({ country: null, timezone: 'Asia/Singapore' }),
    }))
  })
})
