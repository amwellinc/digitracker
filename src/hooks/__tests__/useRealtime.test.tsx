import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const mockUnsubscribe = vi.fn()
  const mockSubscribe = vi.fn().mockReturnValue({ unsubscribe: mockUnsubscribe })
  const mockOn = vi.fn()
  const mockChannel = { on: mockOn, subscribe: mockSubscribe }
  mockOn.mockReturnValue(mockChannel)

  return {
    supabase: {
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
  }
})

import { useRealtime } from '../useRealtime'

describe('useRealtime', () => {
  it('subscribes to the given table on mount', async () => {
    const { supabase } = await import('@/lib/supabase')
    renderHook(() => useRealtime({ table: 'time_logs' }))
    expect(supabase.channel).toHaveBeenCalledWith(expect.stringContaining('time_logs'))
  })

  it('calls removeChannel on unmount', async () => {
    const { supabase } = await import('@/lib/supabase')
    const { unmount } = renderHook(() => useRealtime({ table: 'time_logs' }))
    unmount()
    expect(supabase.removeChannel).toHaveBeenCalled()
  })
})
