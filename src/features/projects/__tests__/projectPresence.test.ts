import { describe, it, expect } from 'vitest'
import { presenceFromStatus } from '../projectPresence'

describe('presenceFromStatus', () => {
  it('is offline when there is no active session', () => {
    expect(presenceFromStatus(null, null)).toBe('offline')
  })

  it('is online when working and recently active', () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(presenceFromStatus('working', recent)).toBe('online')
  })

  it('is idle when working but inactive for over 20 minutes', () => {
    const old = new Date(Date.now() - 25 * 60 * 1000).toISOString()
    expect(presenceFromStatus('working', old)).toBe('idle')
  })

  it('is online while on lunch, never idle, regardless of last activity', () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(presenceFromStatus('lunch', old)).toBe('online')
  })
})
