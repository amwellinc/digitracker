import { createContext, useCallback, useEffect, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, SubAccount } from '@/types'

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
  isSuperAdmin: boolean
  visitingAccount: SubAccount | null
  visitSubAccount: (account: SubAccount) => void
  exitVisit: () => void
  // Magic-link (OTP) — kept for Super Admin and first-time access
  signIn: (email: string, subAccount: string) => Promise<{ error: string | null }>
  // Email + password
  signInWithPassword: (email: string, subAccount: string, password: string) => Promise<{ error: string | null }>
  // Password reset email
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { user: null, loading: true })
  const [visitingAccount, setVisitingAccount] = useState<SubAccount | null>(null)

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

  // Magic-link sign-in (OTP) — first-time access or Super Admin
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

  // Email + password sign-in
  const signInWithPassword = useCallback(async (
    email: string,
    subAccount: string,
    password: string,
  ) => {
    // Verify user exists in our system first
    const { data: registered } = await supabase.rpc('check_user_registered', {
      p_email: email.toLowerCase().trim(),
      p_sub_account: subAccount.trim(),
    })
    if (!registered) return { error: 'Not registered. Contact your administrator.' }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    })

    if (error) {
      // Friendly message when no password is set yet
      if (error.message.includes('Invalid login credentials')) {
        return { error: 'Incorrect password. Use "Forgot password?" to set one, or sign in with a magic link.' }
      }
      return { error: error.message }
    }
    return { error: null }
  }, [])

  // Send password reset email (also works as "set password" for new users who logged in via magic link)
  const sendPasswordReset = useCallback(async (email: string) => {
    const appUrl = import.meta.env.VITE_APP_URL ?? window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.toLowerCase().trim(),
      { redirectTo: `${appUrl}/#/reset-password` },
    )
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    setVisitingAccount(null)
    await supabase.auth.signOut()
    dispatch({ type: 'SIGNED_OUT' })
  }, [])

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) await loadUser(session.user.id)
  }, [loadUser])

  const visitSubAccount  = useCallback((account: SubAccount) => setVisitingAccount(account), [])
  const exitVisit        = useCallback(() => setVisitingAccount(null), [])
  const isSuperAdmin     = state.user?.role === 'Super-Admin'

  const effectiveUser: User | null = visitingAccount && state.user
    ? { ...state.user, sub_account: visitingAccount.code, role: 'Admin' }
    : state.user

  return (
    <AuthContext.Provider value={{
      user: effectiveUser,
      loading: state.loading,
      isSuperAdmin,
      visitingAccount,
      visitSubAccount,
      exitVisit,
      signIn,
      signInWithPassword,
      sendPasswordReset,
      signOut,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
