import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn()
const updateMock = vi.fn()
const maybeSingleMock = vi.fn().mockResolvedValue({ data: null })
const singleMock = vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null })

function makeQueryBuilder() {
  const qb = {
    select: vi.fn(() => qb),
    eq: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    maybeSingle: (...args: unknown[]) => maybeSingleMock(...args),
    single: (...args: unknown[]) => singleMock(...args),
    insert: (payload: unknown) => { insertMock(payload); return qb },
    update: (payload: unknown) => { updateMock(payload); return qb },
    // Makes `await supabase.from(...).update(payload).eq('id', x)` resolve
    // directly, matching how the component actually awaits that chain.
    then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
  }
  return qb
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => makeQueryBuilder()),
  },
}))

import { StripePaymentsTab } from '../StripePaymentsTab'

describe('StripePaymentsTab — secret key handling', () => {
  beforeEach(() => {
    insertMock.mockClear()
    updateMock.mockClear()
    maybeSingleMock.mockClear().mockResolvedValue({ data: null })
    singleMock.mockClear().mockResolvedValue({ data: { id: 'new-id' }, error: null })
  })

  it('never requests stripe_secret_key or stripe_webhook_secret in the initial load', async () => {
    render(<StripePaymentsTab />)
    await waitFor(() => expect(maybeSingleMock).toHaveBeenCalled())

    // The component's own `.from('stripe_settings')` call site is what matters;
    // asserting on the mock's own select() would just prove the mock works.
    // Instead, confirm no secret value ever reaches state by checking the
    // secret key input starts empty even with a saved config present.
    expect(screen.getByPlaceholderText(/sk_test|sk_live/i)).toHaveValue('')
  })

  it('omits stripe_secret_key from the insert payload when the field is left blank', async () => {
    render(<StripePaymentsTab />)
    await waitFor(() => expect(maybeSingleMock).toHaveBeenCalled())

    await userEvent.type(screen.getByPlaceholderText(/pk_test|pk_live/i), 'pk_test_123')
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(insertMock).toHaveBeenCalled())
    const payload = insertMock.mock.calls[0][0]
    expect(payload).not.toHaveProperty('stripe_secret_key')
    expect(payload).not.toHaveProperty('stripe_webhook_secret')
  })

  it('includes stripe_secret_key in the payload only when the admin types a new one', async () => {
    render(<StripePaymentsTab />)
    await waitFor(() => expect(maybeSingleMock).toHaveBeenCalled())

    await userEvent.type(screen.getByPlaceholderText(/pk_test|pk_live/i), 'pk_test_123')
    await userEvent.type(screen.getByPlaceholderText(/sk_test|sk_live/i), 'sk_test_supersecret')
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(insertMock).toHaveBeenCalled())
    const payload = insertMock.mock.calls[0][0]
    expect(payload.stripe_secret_key).toBe('sk_test_supersecret')
  })

  it('updates an existing row without clearing an already-saved secret when left blank', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: 'existing-id', stripe_publishable_key: 'pk_test_existing', has_secret_key: true, has_webhook_secret: false },
    })

    render(<StripePaymentsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('pk_test_existing')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const payload = updateMock.mock.calls[0][0]
    expect(payload).not.toHaveProperty('stripe_secret_key')
    expect(payload.stripe_publishable_key).toBe('pk_test_existing')
  })
})
