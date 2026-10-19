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
      // Scoped to the caller's own sub_account explicitly, not just
      // user_id — a user can hold a data_agent_members row for more than
      // one sub_account (e.g. a service provider's staff member also
      // added to a granted client's member list, Task 20), and without
      // this filter .maybeSingle() throws on more than one row for the
      // same user_id. This hook only gates nav/route visibility, never
      // real data access — RLS is still the actual authorization boundary.
      void supabase
        .from('data_agent_members')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('sub_account', user.sub_account)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setIsMember(Boolean((data as { user_id?: string } | null)?.user_id))
        })
    }

    return () => { cancelled = true }
  }, [user?.sub_account, user?.role, user?.id])

  return { hasAccess: entitled && isMember, entitled }
}
