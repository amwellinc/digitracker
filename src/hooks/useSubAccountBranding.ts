import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'
import { applyBrandColor, DEFAULT_COLOR, isValidBrandColor } from '@/lib/theme'

export interface SubAccountBranding {
  companyName: string | null
  logoUrl: string | null
  brandColor: string
}

const EMPTY_BRANDING: SubAccountBranding = {
  companyName: null,
  logoUrl: null,
  brandColor: DEFAULT_COLOR,
}

// Module-level cache so multiple components share one fetch per sub_account
const brandingCache = new Map<string, SubAccountBranding>()
const BRANDING_UPDATED_EVENT = 'dt:sub-account-branding-updated'

export function useSubAccountBranding(): SubAccountBranding {
  const { user } = useAuth()
  const subAccount = user?.sub_account ?? ''

  const [branding, setBranding] = useState<SubAccountBranding>(() =>
    brandingCache.get(subAccount) ?? EMPTY_BRANDING
  )

  useEffect(() => {
    if (!subAccount) {
      setBranding(EMPTY_BRANDING)
      applyBrandColor(DEFAULT_COLOR)
      return
    }

    if (brandingCache.has(subAccount)) {
      const cached = brandingCache.get(subAccount)!
      setBranding(cached)
      applyBrandColor(cached.brandColor)
    } else {
      void supabase
        .from('sub_accounts')
        .select('company_name, logo_url, brand_color')
        .eq('code', subAccount)
        .single()
        .then(({ data }) => {
          const row = data as {
            company_name?: string | null
            logo_url?: string | null
            brand_color?: string | null
          } | null
          const next: SubAccountBranding = {
            companyName: row?.company_name?.trim() || null,
            logoUrl: row?.logo_url || null,
            brandColor: row?.brand_color && isValidBrandColor(row.brand_color)
              ? row.brand_color
              : DEFAULT_COLOR,
          }
          brandingCache.set(subAccount, next)
          setBranding(next)
          applyBrandColor(next.brandColor)
        })
    }

    function handleBrandingUpdated(event: Event) {
      const detail = (event as CustomEvent<{ subAccount: string }>).detail
      if (detail?.subAccount !== subAccount) return
      const updated = brandingCache.get(subAccount)
      if (!updated) return
      setBranding(updated)
      applyBrandColor(updated.brandColor)
    }

    window.addEventListener(BRANDING_UPDATED_EVENT, handleBrandingUpdated)
    return () => window.removeEventListener(BRANDING_UPDATED_EVENT, handleBrandingUpdated)
  }, [subAccount])

  return branding
}

export function updateBrandingCache(subAccount: string, branding: SubAccountBranding) {
  brandingCache.set(subAccount, branding)
  window.dispatchEvent(new CustomEvent(BRANDING_UPDATED_EVENT, { detail: { subAccount } }))
}
