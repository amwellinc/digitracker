import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
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

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null, loading: false,
    isSuperAdmin: false,
    visitingAccount: null,
    visitSubAccount: vi.fn(),
    exitVisit: vi.fn(),
    viewAsUser: null,
    startViewAs: vi.fn(),
    exitViewAs: vi.fn(),
    signIn:              vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword:  vi.fn().mockResolvedValue({ error: null }),
    sendPasswordReset:   vi.fn().mockResolvedValue({ error: null }),
    signOut:             vi.fn(),
    refreshUser:         vi.fn(),
    ...overrides,
  }
}

// LoginPage calls useNavigate(), which requires a Router ancestor even in tests.
function renderLoginPage(ctxOverrides: Partial<AuthContextValue> = {}) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={makeCtx(ctxOverrides)}>
        <LoginPage />
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  it('renders email, password, and sub-account fields by default', () => {
    renderLoginPage()
    expect(screen.getByPlaceholderText(/you@company.com/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/AM333/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/your password/i)).toBeInTheDocument()
  })

  it('signs in with password on submit', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null })
    renderLoginPage({ signInWithPassword })
    await userEvent.type(screen.getByPlaceholderText(/you@company.com/i), 'test@test.com')
    await userEvent.type(screen.getByPlaceholderText(/AM333/i), 'AM333')
    await userEvent.type(screen.getByPlaceholderText(/your password/i), 'mypassword')
    await userEvent.click(screen.getByRole('button', { name: /sign in$/i }))
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith('test@test.com', 'AM333', 'mypassword'))
  })

  it('shows error when password sign-in fails', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: 'Incorrect password.' })
    renderLoginPage({ signInWithPassword })
    await userEvent.type(screen.getByPlaceholderText(/you@company.com/i), 'test@test.com')
    await userEvent.type(screen.getByPlaceholderText(/AM333/i), 'AM333')
    await userEvent.type(screen.getByPlaceholderText(/your password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in$/i }))
    await waitFor(() => expect(screen.getByText(/incorrect password/i)).toBeInTheDocument())
  })

  it('switches to magic link mode and sends link', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null })
    renderLoginPage({ signIn })
    // Switch to magic link mode
    await userEvent.click(screen.getByRole('button', { name: /sign in with magic link/i }))
    await userEvent.type(screen.getByPlaceholderText(/you@company.com/i), 'test@test.com')
    await userEvent.type(screen.getByPlaceholderText(/AM333/i), 'AM333')
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument())
  })

  it('sends the magic link even when the sub-account code is left blank (value is unused by signIn)', async () => {
    // Team Login's "Sub-account code" field is passed to signIn but AuthContext
    // discards it entirely — it must not be able to block submission of an
    // otherwise-valid request just because a user doesn't know an internal code.
    const signIn = vi.fn().mockResolvedValue({ error: null })
    renderLoginPage({ signIn })
    await userEvent.click(screen.getByRole('button', { name: /sign in with magic link/i }))
    await userEvent.type(screen.getByPlaceholderText(/you@company.com/i), 'cecillia@amwelltechnologies.com')
    // Sub-account code intentionally left blank
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('cecillia@amwelltechnologies.com', ''))
  })

  it('shows forgot password form and sends reset email', async () => {
    const sendPasswordReset = vi.fn().mockResolvedValue({ error: null })
    renderLoginPage({ sendPasswordReset })
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    await userEvent.type(screen.getByPlaceholderText(/you@company.com/i), 'test@test.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    await waitFor(() => expect(screen.getByText(/password reset email sent/i)).toBeInTheDocument())
  })
})
