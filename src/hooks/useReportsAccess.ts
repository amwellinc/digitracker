import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'

// Module-level cache so multiple components share one fetch per sub_account
const cache = new Map<string, boolean>()

// Admins always have Reports access; Managers only if their sub_account has
// opted in. Staff never see Reports regardless of this flag.
export function useReportsAccess(): boolean {
  const { user } = useAuth()
  const subAccount = user?.sub_account ?? ''

  const [managersCanView, setManagersCanView] = useState<boolean>(() =>
    cache.get(subAccount) ?? false
  )

  useEffect(() => {
    if (!subAccount || user?.role !== 'Manager') return
    if (cache.has(subAccount)) {
      setManagersCanView(cache.get(subAccount)!)
      return
    }
    void supabase
      .from('sub_accounts')
      .select('managers_can_view_reports')
      .eq('code', subAccount)
      .single()
      .then(({ data }) => {
        const allowed = Boolean((data as { managers_can_view_reports?: boolean } | null)?.managers_can_view_reports)
        cache.set(subAccount, allowed)
        setManagersCanView(allowed)
      })
  }, [subAccount, user?.role])

  if (user?.role === 'Admin') return true
  if (user?.role === 'Manager') return managersCanView
  return false
}

export function invalidateReportsAccessCache(subAccount: string) {
  cache.delete(subAccount)
}
