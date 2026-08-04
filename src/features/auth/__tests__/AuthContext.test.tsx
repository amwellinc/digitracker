import { render, screen, waitFor } from '@testing-library/react'
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
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({}),
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
