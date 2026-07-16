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

export interface CurrencyPricing {
  currency: string
  symbol: string
  country: string
  flag: string
  prices: { basic: number; business: number; professional: number }
}

export const PLAN_CURRENCIES: CurrencyPricing[] = [
  { currency: 'USD', symbol: '$',   country: 'United States', flag: '🇺🇸', prices: { basic: 19.90,   business: 39.90,   professional: 99.90    } },
  { currency: 'SGD', symbol: 'S$',  country: 'Singapore',     flag: '🇸🇬', prices: { basic: 26.90,   business: 53.90,   professional: 134.90   } },
  { currency: 'INR', symbol: '₹',   country: 'India',         flag: '🇮🇳', prices: { basic: 1650,    business: 3310,    professional: 8290     } },
  { currency: 'MYR', symbol: 'RM',  country: 'Malaysia',      flag: '🇲🇾', prices: { basic: 93.90,   business: 187.90,  professional: 469.90   } },
  { currency: 'PHP', symbol: '₱',   country: 'Philippines',   flag: '🇵🇭', prices: { basic: 1115,    business: 2235,    professional: 5595     } },
  { currency: 'AUD', symbol: 'A$',  country: 'Australia',     flag: '🇦🇺', prices: { basic: 30.90,   business: 61.90,   professional: 154.90   } },
  { currency: 'GBP', symbol: '£',   country: 'United Kingdom',flag: '🇬🇧', prices: { basic: 15.90,   business: 31.90,   professional: 79.90    } },
  { currency: 'AED', symbol: 'AED', country: 'UAE',           flag: '🇦🇪', prices: { basic: 73.90,   business: 147.90,  professional: 369.90   } },
  { currency: 'IDR', symbol: 'Rp',  country: 'Indonesia',     flag: '🇮🇩', prices: { basic: 315000,  business: 630000,  professional: 1575000  } },
  { currency: 'THB', symbol: '฿',   country: 'Thailand',      flag: '🇹🇭', prices: { basic: 720,     business: 1440,    professional: 3600     } },
  { currency: 'JPY', symbol: '¥',   country: 'Japan',         flag: '🇯🇵', prices: { basic: 2990,    business: 5990,    professional: 14990    } },
]
