export interface TimezoneOption {
  value: string
  label: string
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: 'Asia/Singapore',    label: 'Singapore (UTC+8)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur / Malaysia (UTC+8)' },
  { value: 'Asia/Manila',       label: 'Manila / Philippines (UTC+8)' },
  { value: 'Asia/Shanghai',     label: 'China (UTC+8)' },
  { value: 'Asia/Tokyo',        label: 'Tokyo / Japan (UTC+9)' },
  { value: 'Asia/Seoul',        label: 'Seoul / South Korea (UTC+9)' },
  { value: 'Asia/Jakarta',      label: 'Jakarta / Indonesia WIB (UTC+7)' },
  { value: 'Asia/Bangkok',      label: 'Bangkok / Thailand (UTC+7)' },
  { value: 'Asia/Ho_Chi_Minh',  label: 'Ho Chi Minh City (UTC+7)' },
  { value: 'Asia/Kolkata',      label: 'India (UTC+5:30)' },
  { value: 'Asia/Karachi',      label: 'Pakistan (UTC+5)' },
  { value: 'Asia/Dubai',        label: 'Dubai / UAE (UTC+4)' },
  { value: 'Europe/Moscow',     label: 'Moscow (UTC+3)' },
  { value: 'Africa/Nairobi',    label: 'Nairobi / East Africa (UTC+3)' },
  { value: 'Europe/Paris',      label: 'Paris / Central Europe (UTC+1/+2)' },
  { value: 'Europe/London',     label: 'London (UTC+0/+1)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo / Brazil (UTC-3)' },
  { value: 'America/New_York',  label: 'New York (UTC-5/-4)' },
  { value: 'America/Chicago',   label: 'Chicago (UTC-6/-5)' },
  { value: 'America/Denver',    label: 'Denver (UTC-7/-6)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (UTC-8/-7)' },
  { value: 'Pacific/Auckland',  label: 'Auckland / New Zealand (UTC+12/+13)' },
  { value: 'Australia/Sydney',  label: 'Sydney / Australia (UTC+10/+11)' },
  { value: 'UTC',               label: 'UTC (Coordinated Universal Time)' },
]

export const DEFAULT_TIMEZONE = 'Asia/Singapore'

/**
 * Returns "YYYY-MM-DD" for today in the given IANA timezone.
 * Uses Intl.DateTimeFormat with en-CA locale which natively formats as YYYY-MM-DD.
 * Falls back to browser local timezone on any error.
 */
export function todayInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  } catch {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
}
