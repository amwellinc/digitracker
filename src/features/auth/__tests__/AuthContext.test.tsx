import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AuthProvider } from '../AuthContext'
import { useAuth } from '@/hooks/useAuth'

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

describe('AuthContext.signIn', () => {
  it('returns error when user not found in sub_account', async () => {
    let result: { error: string | null } = { error: null }
    function SignInTest() {
      const { signIn } = useAuth()
      return (
        <button onClick={async () => { result = await signIn('x@x.com', 'AM333') }}>
          go
        </button>
      )
    }
    render(<AuthProvider><SignInTest /></AuthProvider>)
    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(result.error).toBe('Not registered. Contact your administrator.')
    })
  })
})
