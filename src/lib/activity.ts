// Shared idle threshold: how long a clocked-in session can go without real
// mouse/keyboard/scroll input before it's surfaced as "Idle" to Admin/Manager.
// Matches ClockContext's STALE_MS (abandoned-session detection) so there's a
// single consistent definition of "20 minutes" across the app.
export const IDLE_THRESHOLD_MS = 20 * 60 * 1000

export function isIdle(lastActivityAt: string | null | undefined): boolean {
  if (!lastActivityAt) return false
  return Date.now() - new Date(lastActivityAt).getTime() > IDLE_THRESHOLD_MS
}
