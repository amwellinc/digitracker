import { createContext, useCallback, useEffect, useReducer } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  loading: boolean
}

type AuthAction =
  | { type: 'SIGNED_IN'; user: User }
  | { type: 'SIGNED_OUT' }

function reducer(_state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SIGNED_IN': return { user: action.user, loading: false }
    case 'SIGNED_OUT': return { user: null, loading: false }
  }
}

export interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: (email: string, subAccount: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { user: null, loading: true })

  const loadUser = useCallback(async (authId: string) => {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', authId)
      .single()
    if (data) dispatch({ type: 'SIGNED_IN', user: data as User })
    else dispatch({ type: 'SIGNED_OUT' })
  }, [])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) void loadUser(session.user.id)
      else dispatch({ type: 'SIGNED_OUT' })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) void loadUser(session.user.id)
      else dispatch({ type: 'SIGNED_OUT' })
    })

    return () => subscription.unsubscribe()
  }, [loadUser])

  const signIn = useCallback(async (email: string, subAccount: string) => {
    const { data: registered } = await supabase.rpc('check_user_registered', {
      p_email: email.toLowerCase().trim(),
      p_sub_account: subAccount.trim(),
    })

    if (!registered) return { error: 'Not registered. Contact your administrator.' }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase().trim(),
      options: { emailRedirectTo: import.meta.env.VITE_APP_URL ?? window.location.origin },
    })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    dispatch({ type: 'SIGNED_OUT' })
  }, [])

  return (
    <AuthContext.Provider value={{ user: state.user, loading: state.loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
