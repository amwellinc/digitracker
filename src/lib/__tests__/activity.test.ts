import { describe, it, expect } from 'vitest'
import { isIdle } from '../activity'

describe('isIdle (cosmetic 20-minute "Idle" badge — does not disconnect the session)', () => {
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
