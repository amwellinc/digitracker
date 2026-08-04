import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { StatCards } from '../StatCards'
import { AuthContext } from '@/features/auth/AuthContext'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const testUser: User = {
  id: 'u1', email: 'staff@test.com', name: 'Staff Member', role: 'Staff',
  sub_account: 'AM333', manager_id: null, annual_leave: 14, time_off: 40,
  profile_image: null, reporting_time_in: '10:00', reporting_time_out: '19:00',
  country: 'SG', phone: null, status: 'active', created_at: '2026-01-01T00:00:00Z',
  appointed_as: null, address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null, emergency_contact_phone: null,
  department_id: null,
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: testUser, loading: false,
    accountBlockedMessage: null,
    isSuperAdmin: false,
    visitingAccount: null,
    visitSubAccount: vi.fn(),
    exitVisit: vi.fn(),
    viewAsUser: null,
    startViewAs: vi.fn(),
    exitViewAs: vi.fn(),
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    sendPasswordReset: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn(),
    refreshUser: vi.fn(),
    ...overrides,
  }
}

const base = {
  status: 'clocked_out' as const,
  dayMinutes: 0,
  liveSeconds: 0,
  isCapturing: false,
  isWorking: false,
  isOnLunch: false,
  onClockIn: vi.fn(),
  onStartLunch: vi.fn(),
  onEndLunch: vi.fn(),
  onClockOut: vi.fn(),
}

function renderStatCards(props: Partial<ComponentProps<typeof StatCards>> = {}) {
  return render(
    <AuthContext.Provider value={makeCtx()}>
      <StatCards {...base} {...props} />
    </AuthContext.Provider>
  )
}

describe('StatCards', () => {
  it('shows Clock In when clocked out', () => {
    renderStatCards()
    expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument()
  })

  it('calls onClockIn when clicked', async () => {
    const onClockIn = vi.fn()
    renderStatCards({ onClockIn })
    await userEvent.click(screen.getByRole('button', { name: /clock in/i }))
    expect(onClockIn).toHaveBeenCalledOnce()
  })

  it('shows Start Lunch + Clock Out when working', () => {
    renderStatCards({ status: 'working', isWorking: true })
    expect(screen.getByRole('button', { name: /start lunch/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clock out/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clock in/i })).not.toBeInTheDocument()
  })

  it('shows End Lunch + Clock Out when on lunch', () => {
    renderStatCards({ status: 'lunch', isOnLunch: true })
    expect(screen.getByRole('button', { name: /end lunch/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clock out/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start lunch/i })).not.toBeInTheDocument()
  })

  it('formats 167 minutes as 02:47:00', () => {
    renderStatCards({ dayMinutes: 167 })
    expect(screen.getByText('02:47:00')).toBeInTheDocument()
  })

  it('shows capture indicator when capturing', () => {
    renderStatCards({ isCapturing: true })
    expect(screen.getByText(/screen capture active/i)).toBeInTheDocument()
  })
})
