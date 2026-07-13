import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

// Module-level cache so multiple components share one fetch per sub_account
const tzCache = new Map<string, string>()

export function useSubAccountTimezone(): string {
  const { user } = useAuth()
  const subAccount = user?.sub_account ?? ''

  const [timezone, setTimezone] = useState<string>(() =>
    tzCache.get(subAccount) ?? DEFAULT_TIMEZONE
  )

  useEffect(() => {
    if (!subAccount) return
    if (tzCache.has(subAccount)) {
      setTimezone(tzCache.get(subAccount)!)
      return
    }
    void supabase
      .from('sub_accounts')
      .select('timezone')
      .eq('code', subAccount)
      .single()
      .then(({ data }) => {
        const tz = (data as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE
        tzCache.set(subAccount, tz)
        setTimezone(tz)
      })
  }, [subAccount])

  return timezone
}

// Invalidate the cache entry so a fresh fetch happens after a timezone save
export function invalidateTimezoneCache(subAccount: string) {
  tzCache.delete(subAccount)
}
