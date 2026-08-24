import { describe, it, expect } from 'vitest'
import { IDLE_DISCONNECT_MS, isIdle, shouldIdleDisconnect } from '../activity'

describe('shouldIdleDisconnect', () => {
  const now = 1_000_000_000_000 // arbitrary fixed instant

  it('does not disconnect a session idle for exactly 40 minutes', () => {
    expect(shouldIdleDisconnect('working', now - IDLE_DISCONNECT_MS, now)).toBe(false)
  })

  it('disconnects a "working" session idle for more than 40 minutes', () => {
    const lastActivity = now - IDLE_DISCONNECT_MS - 60_000 // 41 minutes idle
    expect(shouldIdleDisconnect('working', lastActivity, now)).toBe(true)
  })

  it('does not disconnect a "working" session idle for less than 40 minutes', () => {
    const lastActivity = now - (39 * 60 * 1000)
    expect(shouldIdleDisconnect('working', lastActivity, now)).toBe(false)
  })

  it('never disconnects while on lunch, no matter how long — not part of the 1 hour lunch', () => {
    const lastActivity = now - (3 * 60 * 60 * 1000) // 3 hours idle
    expect(shouldIdleDisconnect('lunch', lastActivity, now)).toBe(false)
  })

  it('does not apply to an already clocked-out session', () => {
    const lastActivity = now - IDLE_DISCONNECT_MS - 60_000
    expect(shouldIdleDisconnect('clocked_out', lastActivity, now)).toBe(false)
  })
})

describe('isIdle (cosmetic 20-minute "Idle" badge, separate from the 40-minute disconnect)', () => {
  it('returns false with no last-activity timestamp', () => {
    expect(isIdle(null)).toBe(false)
    expect(isIdle(undefined)).toBe(false)
  })

  it('returns true once last activity is older than 20 minutes', () => {
    const old = new Date(Date.now() - 25 * 60 * 1000).toISOString()
    expect(isIdle(old)).toBe(true)
  })

  it('returns false for recent activity', () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(isIdle(recent)).toBe(false)
  })
})
