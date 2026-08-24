// Shared idle threshold: how long a clocked-in session can go without real
// mouse/keyboard/scroll input before it's surfaced as "Idle" to Admin/Manager.
// Matches ClockContext's STALE_MS (abandoned-session detection) so there's a
// single consistent definition of "20 minutes" across the app.
export const IDLE_THRESHOLD_MS = 20 * 60 * 1000

// Hard cap: a session idle for longer than this while status is "working"
// (never while on lunch) is auto clocked-out by ClockContext. Distinct from
// IDLE_THRESHOLD_MS above, which only controls the cosmetic "Idle" badge —
// this one actually disconnects the session.
export const IDLE_DISCONNECT_MS = 40 * 60 * 1000

export function isIdle(lastActivityAt: string | null | undefined): boolean {
  if (!lastActivityAt) return false
  return Date.now() - new Date(lastActivityAt).getTime() > IDLE_THRESHOLD_MS
}

// Pure decision behind ClockContext's idle-disconnect check, extracted so
// the actual policy — never while on lunch, 40 min of no real input while
// working — is directly unit-testable without mocking timers/Supabase.
export function shouldIdleDisconnect(
  status: 'working' | 'lunch' | 'clocked_out',
  lastActivityMs: number,
  now: number = Date.now(),
): boolean {
  if (status !== 'working') return false
  return now - lastActivityMs > IDLE_DISCONNECT_MS
}
