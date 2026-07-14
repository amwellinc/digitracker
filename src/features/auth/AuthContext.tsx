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
  // View As — Super Admin impersonates a staff/manager to see their exact view
  viewAsUser: User | null
  startViewAs: (targetUser: User) => void
  exitViewAs: () => void
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
  const [viewAsUser, setViewAsUser] = useState<User | null>(null)

  const loadUser = useCallback(async (authEmail: string) => {
    // Use limit(1) + maybeSingle() instead of single() so we never error when
    // the same email appears in multiple sub-account rows. maybeSingle() returns
    // null (not an error) for 0 rows; limit(1) prevents the "multiple rows" error.
    const { data } = await supabase
      .from('users')
      .select('*')
      .ilike('email', authEmail.trim())   // case-insensitive match
      .order('created_at', { ascending: true })  // deterministic pick if multiple rows exist
      .limit(1)
      .maybeSingle()
    if (data) dispatch({ type: 'SIGNED_IN', user: data as User })
    else {
      // Valid Supabase auth session but no matching app user — sign out cleanly
      await supabase.auth.signOut()
      dispatch({ type: 'SIGNED_OUT' })
    }
  }, [])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) void loadUser(session.user.email)
      else dispatch({ type: 'SIGNED_OUT' })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      // Password recovery: Supabase auto-exchanges the ?code= from the email link.
      // Don't treat this as a normal sign-in — redirect to the reset page instead.
      if (_e === 'PASSWORD_RECOVERY') {
        if (!window.location.hash.startsWith('#/reset-password')) {
          window.location.replace(window.location.origin + '/#/reset-password')
        }
        return
      }
      if (session?.user?.email) void loadUser(session.user.email)
      else dispatch({ type: 'SIGNED_OUT' })
    })

    return () => subscription.unsubscribe()
  }, [loadUser])

  // Magic-link sign-in (OTP).
  // Redirects to origin root so Supabase PKCE code lands in window.location.search
  // (not buried inside the hash where Supabase JS can't find it).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const signIn = useCallback(async (email: string, _subAccount: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase().trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    return { error: error?.message ?? null }
  }, [])

  // Email + password sign-in
  const signInWithPassword = useCallback(async (
    email: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _subAccount: string,
    password: string,
  ) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    })
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { error: 'Incorrect password. Use "Forgot password?" to set one, or sign in with a magic link.' }
      }
      return { error: error.message }
    }
    return { error: null }
  }, [])

  // Send password reset email.
  // No custom redirectTo — Supabase uses the project's configured Site URL
  // (https://digitracker.digi5y.co), which requires no allowlist entry.
  // Supabase JS auto-exchanges the PKCE code on load and fires PASSWORD_RECOVERY.
  // The onAuthStateChange handler above catches that and redirects to /#/reset-password.
  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.toLowerCase().trim(),
    )
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    setVisitingAccount(null)
    setViewAsUser(null)
    await supabase.auth.signOut()
    dispatch({ type: 'SIGNED_OUT' })
  }, [])

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.email) await loadUser(session.user.email)
  }, [loadUser])

  const visitSubAccount = useCallback((account: SubAccount) => setVisitingAccount(account), [])
  const exitVisit       = useCallback(() => setVisitingAccount(null), [])
  const startViewAs     = useCallback((targetUser: User) => {
    setVisitingAccount(null)
    setViewAsUser(targetUser)
  }, [])
  const exitViewAs      = useCallback(() => setViewAsUser(null), [])
  const isSuperAdmin    = state.user?.role === 'Super-Admin'

  let effectiveUser: User | null = state.user
  if (viewAsUser) {
    effectiveUser = viewAsUser
  } else if (visitingAccount && state.user) {
    effectiveUser = { ...state.user, sub_account: visitingAccount.code, role: 'Admin' }
  }

  return (
    <AuthContext.Provider value={{
      user: effectiveUser,
      loading: state.loading,
      isSuperAdmin,
      visitingAccount,
      visitSubAccount,
      exitVisit,
      viewAsUser,
      startViewAs,
      exitViewAs,
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
