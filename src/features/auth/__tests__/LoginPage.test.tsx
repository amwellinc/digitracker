import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    }),
  },
}))

import { LoginPage } from '../LoginPage'
import { AuthContext } from '../AuthContext'
import type { AuthContextValue } from '../AuthContext'

function makeCtx(signIn: AuthContextValue['signIn']): AuthContextValue {
  return {
    user: null, loading: false,
    isSuperAdmin: false,
    visitingAccount: null,
    visitSubAccount: vi.fn(),
    exitVisit: vi.fn(),
    signIn, signOut: vi.fn(), refreshUser: vi.fn(),
  }
}

describe('LoginPage', () => {
  it('renders email and sub-account fields', () => {
    render(
      <AuthContext.Provider value={makeCtx(vi.fn().mockResolvedValue({ error: null }))}>
        <LoginPage />
      </AuthContext.Provider>
    )
    expect(screen.getByPlaceholderText(/you@company.com/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/AM333/i)).toBeInTheDocument()
  })

  it('shows magic link sent state after successful signIn', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null })
    render(
      <AuthContext.Provider value={makeCtx(signIn)}>
        <LoginPage />
      </AuthContext.Provider>
    )
    await userEvent.type(screen.getByPlaceholderText(/you@company.com/i), 'test@test.com')
    await userEvent.type(screen.getByPlaceholderText(/AM333/i), 'AM333')
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument())
  })

  it('shows error message when signIn returns error', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: 'Not registered. Contact your administrator.' })
    render(
      <AuthContext.Provider value={makeCtx(signIn)}>
        <LoginPage />
      </AuthContext.Provider>
    )
    await userEvent.type(screen.getByPlaceholderText(/you@company.com/i), 'bad@test.com')
    await userEvent.type(screen.getByPlaceholderText(/AM333/i), 'AM333')
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(screen.getByText(/not registered/i)).toBeInTheDocument())
  })
})
