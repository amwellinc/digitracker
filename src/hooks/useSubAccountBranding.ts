import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'

export interface SubAccountBranding {
  companyName: string | null
  logoUrl: string | null
}

const EMPTY_BRANDING: SubAccountBranding = { companyName: null, logoUrl: null }

// Module-level cache so multiple components share one fetch per sub_account
const brandingCache = new Map<string, SubAccountBranding>()

export function useSubAccountBranding(): SubAccountBranding {
  const { user } = useAuth()
  const subAccount = user?.sub_account ?? ''

  const [branding, setBranding] = useState<SubAccountBranding>(() =>
    brandingCache.get(subAccount) ?? EMPTY_BRANDING
  )

  useEffect(() => {
    if (!subAccount) return
    if (brandingCache.has(subAccount)) {
      setBranding(brandingCache.get(subAccount)!)
      return
    }
    void supabase
      .from('sub_accounts')
      .select('company_name, logo_url')
      .eq('code', subAccount)
      .single()
      .then(({ data }) => {
        const row = data as { company_name?: string | null; logo_url?: string | null } | null
        const next: SubAccountBranding = {
          companyName: row?.company_name?.trim() || null,
          logoUrl: row?.logo_url || null,
        }
        brandingCache.set(subAccount, next)
        setBranding(next)
      })
  }, [subAccount])

  return branding
}

// Invalidate the cache entry so a fresh fetch happens after a branding save
export function invalidateBrandingCache(subAccount: string) {
  brandingCache.delete(subAccount)
}
