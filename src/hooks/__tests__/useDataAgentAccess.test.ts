import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingleMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => maybeSingleMock() }),
          maybeSingle: () => maybeSingleMock(),
        }),
      }),
    })),
  },
}))

const authState: { user: { role: string; sub_account: string } | null } = { user: null }
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authState.user }) }))

import { useDataAgentAccess } from '../useDataAgentAccess'

describe('useDataAgentAccess', () => {
  beforeEach(() => { maybeSingleMock.mockReset() })

  it('has no access when the sub-account is not entitled', async () => {
    authState.user = { role: 'Admin', sub_account: 'AM333' }
    maybeSingleMock.mockResolvedValue({ data: null })
    const { result } = renderHook(() => useDataAgentAccess())
    await waitFor(() => expect(result.current.entitled).toBe(false))
    expect(result.current.hasAccess).toBe(false)
  })

  it('gives an Admin access once entitled, with no membership row needed', async () => {
    authState.user = { role: 'Admin', sub_account: 'AM333' }
    maybeSingleMock.mockResolvedValue({ data: { enabled: true } })
    const { result } = renderHook(() => useDataAgentAccess())
    await waitFor(() => expect(result.current.hasAccess).toBe(true))
  })

  it('denies a plain Staff user even when entitled, with no membership row', async () => {
    authState.user = { role: 'Staff', sub_account: 'AM333' }
    maybeSingleMock.mockResolvedValue({ data: { enabled: true } })
    const { result } = renderHook(() => useDataAgentAccess())
    await waitFor(() => expect(result.current.entitled).toBe(true))
    expect(result.current.hasAccess).toBe(false)
  })

  it('starts loading and resolves to false once both checks complete', async () => {
    authState.user = { role: 'Admin', sub_account: 'AM333' }
    maybeSingleMock.mockResolvedValue({ data: { enabled: true } })
    const { result } = renderHook(() => useDataAgentAccess())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasAccess).toBe(true)
  })
})
