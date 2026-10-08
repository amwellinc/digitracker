export interface TimezoneOption {
  value: string
  label: string
}

export const DEFAULT_TIMEZONE = 'Asia/Singapore'

// "Europe/Prague" -> "Europe / Prague", "America/Argentina/Buenos_Aires" ->
// "America / Argentina / Buenos Aires".
function formatTzLabel(tz: string): string {
  return tz.split('/').map(part => part.replace(/_/g, ' ')).join(' / ')
}

// Intl.supportedValuesOf is ES2022+ and this project's tsconfig lib target
// predates it, so it's not in the ambient Intl type — access it via a
// narrow local cast instead of bumping the project-wide lib target for one
// call site.
type IntlWithSupportedValues = typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
const supportedValuesOf = (Intl as IntlWithSupportedValues).supportedValuesOf

// Every IANA zone the runtime knows about, not a hand-picked shortlist —
// any timezone (e.g. Europe/Prague for a Czech sub-account) is selectable.
// Falls back to just the current default on a runtime old enough to lack
// Intl.supportedValuesOf (all modern evergreen browsers have it).
export const TIMEZONE_OPTIONS: TimezoneOption[] = (
  typeof supportedValuesOf === 'function' ? supportedValuesOf('timeZone') : [DEFAULT_TIMEZONE]
)
  .map(tz => ({ value: tz, label: formatTzLabel(tz) }))
  .sort((a, b) => a.label.localeCompare(b.label))

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
