import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AuthProvider } from '../AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithOtp:       vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword:  vi.fn(),
      signOut:             vi.fn().mockResolvedValue({}),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
  },
}))

function TestConsumer() {
  const { user, loading } = useAuth()
  if (loading) return <div>loading</div>
  return <div>{user ? `user:${user.email}` : 'no-user'}</div>
}

describe('AuthProvider', () => {
  it('shows loading then no-user when session is null', async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('no-user')).toBeInTheDocument())
  })
})

// signIn only ever sends the magic link — it never pre-checks whether the
// email belongs to a registered user before sending it (see LoginPage.test.tsx:
// "must not be able to block submission of an otherwise-valid request just
// because a user doesn't know an internal sub-account code"). Whether the
// account actually exists is discovered later, when loadUser() runs after
// the user clicks the link and comes back — not synchronously from signIn.
describe('AuthContext.signIn', () => {
  function SignInTest({ onResult }: { onResult: (r: { error: string | null }) => void }) {
    const { signIn } = useAuth()
    return (
      <button onClick={async () => onResult(await signIn('x@x.com', 'AM333'))}>
        go
      </button>
    )
  }

  it('sends the magic link and reports no error on success', async () => {
    let result: { error: string | null } = { error: 'not set' }
    render(<AuthProvider><SignInTest onResult={r => { result = r }} /></AuthProvider>)
    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(result.error).toBeNull())
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'x@x.com',
      options: { emailRedirectTo: window.location.origin },
    })
  })

  it('surfaces the error message when signInWithOtp itself fails', async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValueOnce({
      data: { user: null, session: null }, error: { message: 'Email rate limit exceeded' } as never,
    })
    let result: { error: string | null } = { error: null }
    render(<AuthProvider><SignInTest onResult={r => { result = r }} /></AuthProvider>)
    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(result.error).toBe('Email rate limit exceeded'))
  })
})

// Regression test for the login-error bug: signInWithPassword used to arm a
// hardcoded 6s timer after a successful Supabase auth and assume "still
// loading after 6s" meant the app account didn't exist. That raced against
// loadUser()'s real DB round trip (RLS-gated, unindexed email lookup) and
// produced a false "Account not found" error for correctly-authenticated
// users whenever the lookup was merely slow, not failed. The fix makes
// signInWithPassword await loadUser's actual outcome instead of guessing.
describe('AuthContext.signInWithPassword — no false "account not found" on a slow (but successful) lookup', () => {
  function SignInPasswordTest({ onResult }: { onResult: (r: { error: string | null }) => void }) {
    const { signInWithPassword } = useAuth()
    return (
      <button onClick={async () => onResult(await signInWithPassword('a@b.com', 'AM333', 'pw'))}>
        go
      </button>
    )
  }

  it('resolves with no error once the account is found, even after the old 6s cutoff has passed', async () => {
    vi.useFakeTimers()

    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
      data: { user: { email: 'a@b.com' }, session: {} } as never, error: null,
    })

    // loadUser's email lookup, deliberately left pending so the test controls
    // exactly when it resolves.
    let resolveLookup!: (v: { data: unknown }) => void
    const slowLookup = new Promise<{ data: unknown }>(resolve => { resolveLookup = resolve })
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnValue(slowLookup),
    } as never)

    let result: { error: string | null } | undefined
    render(<AuthProvider><SignInPasswordTest onResult={r => { result = r }} /></AuthProvider>)
    fireEvent.click(screen.getByRole('button'))

    // Advance well past the old hardcoded 6s window while the lookup is
    // still pending — nothing should resolve `result` yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result).toBeUndefined()

    // Now the (slow, but successful) lookup completes.
    await act(async () => {
      resolveLookup({ data: { id: '1', email: 'a@b.com', role: 'Staff' } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result).toEqual({ error: null })

    vi.useRealTimers()
  })
})
