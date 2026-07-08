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
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'http://x.com/1.jpg' } }),
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}))

const mockUser: User = {
  id: 'u1', email: 'a@a.com', name: 'Alice', role: 'Staff',
  sub_account: 'AM333', manager_id: null, annual_leave: 14,
  time_off: 5, profile_image: null, reporting_time_in: '10:00',
  reporting_time_out: '19:00', created_at: '2026-01-01T00:00:00Z',
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{ user: mockUser, loading: false, signIn: vi.fn(), signOut: vi.fn() }}>
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

  it('start() returns false and sets error when window selected', async () => {
    const windowTrack = { getSettings: vi.fn().mockReturnValue({ displaySurface: 'window' }), stop: vi.fn() }
    const windowStream = { getVideoTracks: vi.fn().mockReturnValue([windowTrack]), getTracks: vi.fn().mockReturnValue([windowTrack]) }
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(windowStream as never)

    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    let ok = true
    await act(async () => { ok = await result.current.start() })
    expect(ok).toBe(false)
    expect(result.current.error).toMatch(/entire screen/i)
  })

  it('stop() sets isCapturing false', async () => {
    const { result } = renderHook(() => useScreenCapture(vi.fn()), { wrapper })
    await act(async () => { await result.current.start() })
    act(() => { result.current.stop() })
    expect(result.current.isCapturing).toBe(false)
  })
})
