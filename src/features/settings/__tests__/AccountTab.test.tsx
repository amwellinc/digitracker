import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const selectSingleMock = vi.fn()
const updateEqMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: () => selectSingleMock() }) }),
      update: (patch: unknown) => ({ eq: (...args: unknown[]) => updateEqMock(patch, ...args) }),
    })),
  },
}))

import { AccountTab } from '../AccountTab'
import { AuthContext } from '@/features/auth/AuthContext'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const adminUser: User = {
  id: 'admin-1', email: 'admin@dermitage.com', name: 'Admin', role: 'Admin', sub_account: 'DERMITAGE',
  manager_id: null, annual_leave: 14, time_off: 40, profile_image: null,
  reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'CZ', phone: null,
  status: 'active', created_at: '2026-10-07T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: adminUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false, isAssociate: false,
    visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
    viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
    signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
    signOut: vi.fn(), refreshUser: vi.fn(),
    ...overrides,
  }
}

describe('AccountTab — country and timezone', () => {
  beforeEach(() => {
    selectSingleMock.mockReset().mockResolvedValue({
      data: { timezone: 'Asia/Singapore', country: null, company_name: null, logo_url: null },
    })
    updateEqMock.mockReset().mockResolvedValue({ error: null })
  })

  it('shows Country and Timezone selects for an Admin', async () => {
    render(<AuthContext.Provider value={makeCtx()}><AccountTab /></AuthContext.Provider>)
    await waitFor(() => expect(selectSingleMock).toHaveBeenCalled())
    expect(screen.getByText('Country & Work Calendar Timezone')).toBeInTheDocument()
    expect(screen.getByText('Country')).toBeInTheDocument()
    expect(screen.getByText('Timezone')).toBeInTheDocument()
  })

  it('pre-fills the country select from the loaded sub_accounts row', async () => {
    selectSingleMock.mockResolvedValue({
      data: { timezone: 'Europe/Prague', country: 'CZ', company_name: null, logo_url: null },
    })
    render(<AuthContext.Provider value={makeCtx()}><AccountTab /></AuthContext.Provider>)
    const countrySelect = await screen.findByDisplayValue(/Czech/i)
    expect(countrySelect).toBeInTheDocument()
  })

  it('saves the selected country and timezone together', async () => {
    render(<AuthContext.Provider value={makeCtx()}><AccountTab /></AuthContext.Provider>)
    await waitFor(() => expect(selectSingleMock).toHaveBeenCalled())

    const selects = screen.getAllByRole('combobox')
    const countrySelect = selects[0]
    const timezoneSelect = selects[1]
    await userEvent.selectOptions(countrySelect, 'CZ')
    await userEvent.selectOptions(timezoneSelect, 'Europe/Prague')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateEqMock).toHaveBeenCalledWith(
      { timezone: 'Europe/Prague', country: 'CZ' }, 'code', 'DERMITAGE',
    ))
  })
})
