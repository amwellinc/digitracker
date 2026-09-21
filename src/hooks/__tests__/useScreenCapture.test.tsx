import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { useScreenCapture } from '../useScreenCapture'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'u/1.jpg' }, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'http://x.com/signed.jpg' }, error: null }),
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { timezone: 'Asia/Singapore' } }),
    }),
  },
}))

const mockUser: User = {
  id: 'u1', email: 'a@a.com', name: 'Alice', role: 'Staff',
  sub_account: 'AM333', manager_id: null, annual_leave: 14,
  time_off: 5, profile_image: null, reporting_time_in: '10:00',
  reporting_time_out: '19:00', country: 'SG', phone: null, status: 'active', created_at: '2026-01-01T00:00:00Z',
  appointed_as: null, address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null, emergency_contact_phone: null,
  department_id: null,
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{
      user: mockUser, loading: false,
      accountBlockedMessage: null,
      isSuperAdmin: false,
      visitingAccount: null,
      visitSubAccount: vi.fn(),
      exitVisit: vi.fn(),
      viewAsUser: null,
      startViewAs: vi.fn(),
      exitViewAs: vi.fn(),
      signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(), signOut: vi.fn(), refreshUser: vi.fn(),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

const monitorTrack = {
  getSettings: vi.fn().mockReturnValue({ displaySurface: 'monitor' }),
  stop: vi.fn(),
  onended: null as null | (() => void),
}
const monitorStream = {
  getVideoTracks: vi.fn().mockReturnValue([monitorTrack]),
  getTracks: vi.fn().mockReturnValue([monitorTrack]),
}

describe('useScreenCapture', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: vi.fn().mockResolvedValue(monitorStream) },
      writable: true, configurable: true,
    })
    // jsdom doesn't implement HTMLVideoElement.play — stub it
    Object.defineProperty(HTMLVideoElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
  })
  afterEach(() => { vi.clearAllMocks() })

  it('initialises with isCapturing false', () => {
    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    expect(result.current.isCapturing).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('start() sets isCapturing true on monitor selection', async () => {
    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    await act(async () => { await result.current.start() })
    expect(result.current.isCapturing).toBe(true)
  })

  it('start() rejects a shared window, stops the stream, and shows an error', async () => {
    const windowTrack = { getSettings: vi.fn().mockReturnValue({ displaySurface: 'window' }), stop: vi.fn(), onended: null }
    const windowStream = { getVideoTracks: vi.fn().mockReturnValue([windowTrack]), getTracks: vi.fn().mockReturnValue([windowTrack]) }
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(windowStream as never)

    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    let ok = true
    await act(async () => { ok = await result.current.start() })
    expect(ok).toBe(false)
    expect(result.current.isCapturing).toBe(false)
    expect(result.current.error).toMatch(/entire screen/i)
    expect(windowTrack.stop).toHaveBeenCalled()
  })

  it('start() rejects a shared browser tab the same way', async () => {
    const tabTrack = { getSettings: vi.fn().mockReturnValue({ displaySurface: 'browser' }), stop: vi.fn(), onended: null }
    const tabStream = { getVideoTracks: vi.fn().mockReturnValue([tabTrack]), getTracks: vi.fn().mockReturnValue([tabTrack]) }
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(tabStream as never)

    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    let ok = true
    await act(async () => { ok = await result.current.start() })
    expect(ok).toBe(false)
    expect(result.current.isCapturing).toBe(false)
    expect(tabTrack.stop).toHaveBeenCalled()
  })

  it('start() accepts the stream when the browser does not report displaySurface at all', async () => {
    const unknownTrack = { getSettings: vi.fn().mockReturnValue({}), stop: vi.fn(), onended: null }
    const unknownStream = { getVideoTracks: vi.fn().mockReturnValue([unknownTrack]), getTracks: vi.fn().mockReturnValue([unknownTrack]) }
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(unknownStream as never)

    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    let ok = false
    await act(async () => { ok = await result.current.start() })
    expect(ok).toBe(true)
    expect(result.current.isCapturing).toBe(true)
  })

  it('stop() sets isCapturing false', async () => {
    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    await act(async () => { await result.current.start() })
    act(() => { result.current.stop() })
    expect(result.current.isCapturing).toBe(false)
  })
})
