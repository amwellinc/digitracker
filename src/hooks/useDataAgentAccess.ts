import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'

export function useDataAgentAccess(): { hasAccess: boolean; entitled: boolean } {
  const { user } = useAuth()
  const [entitled, setEntitled] = useState(false)
  const [isMember, setIsMember] = useState(false)

  useEffect(() => {
    if (!user?.sub_account) { setEntitled(false); setIsMember(false); return }
    let cancelled = false

    void supabase
      .from('data_agent_entitlements')
      .select('enabled')
      .eq('sub_account', user.sub_account)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setEntitled(Boolean((data as { enabled?: boolean } | null)?.enabled))
      })

    if (user.role === 'Admin' || user.role === 'Super-Admin') {
      setIsMember(true)
    } else {
      // RLS already scopes this to the caller's own sub_account; this hook
      // only gates nav/route visibility, never real data access, so a
      // single user_id filter is sufficient here.
      void supabase
        .from('data_agent_members')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setIsMember(Boolean((data as { user_id?: string } | null)?.user_id))
        })
    }

    return () => { cancelled = true }
  }, [user?.sub_account, user?.role, user?.id])

  return { hasAccess: entitled && isMember, entitled }
}
