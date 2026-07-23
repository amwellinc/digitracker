import type { UserCountry, UserRole } from '@/types'

export interface CountryOption {
  code: UserCountry
  flag: string
  label: string
  dialCode: string
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'SG', flag: '🇸🇬', label: 'Singapore',     dialCode: '+65' },
  { code: 'MY', flag: '🇲🇾', label: 'Malaysia',      dialCode: '+60' },
  { code: 'PH', flag: '🇵🇭', label: 'Philippines',   dialCode: '+63' },
  { code: 'IN', flag: '🇮🇳', label: 'India',         dialCode: '+91' },
  { code: 'AU', flag: '🇦🇺', label: 'Australia',     dialCode: '+61' },
  { code: 'US', flag: '🇺🇸', label: 'United States', dialCode: '+1'  },
  { code: 'GB', flag: '🇬🇧', label: 'United Kingdom',dialCode: '+44' },
  { code: 'ID', flag: '🇮🇩', label: 'Indonesia',     dialCode: '+62' },
  { code: 'TH', flag: '🇹🇭', label: 'Thailand',      dialCode: '+66' },
  { code: 'VN', flag: '🇻🇳', label: 'Vietnam',       dialCode: '+84' },
  { code: 'AE', flag: '🇦🇪', label: 'UAE',            dialCode: '+971'},
  { code: 'CN', flag: '🇨🇳', label: 'China',          dialCode: '+86' },
  { code: 'JP', flag: '🇯🇵', label: 'Japan',          dialCode: '+81' },
]

export const ROLE_OPTIONS: UserRole[] = ['Admin', 'Manager', 'Staff']

export const ROLE_COLORS: Record<UserRole, string> = {
  'Super-Admin': 'bg-purple-100 text-purple-800',
  'Admin':       'bg-violet-100 text-violet-700',
  'Manager':     'bg-blue-100 text-blue-700',
  'Staff':       'bg-gray-100 text-gray-600',
}

export const PLAN_LABELS: Record<string, string> = {
  free:         'Free',
  basic:        'Standard',
  business:     'Business',
  professional: 'Professional',
}

// Multi-currency pricing now lives in the currencies / plan_currency_pricing
// tables, managed live from Platform Admin -> Plans & Pricing.
