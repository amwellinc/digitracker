import { describe, it, expect } from 'vitest'
import { computeDashboardStats } from '../dashboardStats'

const m = (overrides: Partial<{ status: string; row_count: number; accuracy_rating: number | null; created_at: string }>) => ({
  status: 'completed', row_count: 10, accuracy_rating: 95, created_at: '2026-10-01T00:00:00Z', ...overrides,
})

describe('computeDashboardStats', () => {
  it('returns zeroed stats and no latest for an empty list', () => {
    expect(computeDashboardStats([])).toEqual({ completedCount: 0, recordsProcessed: 0, avgAccuracy: null, latest: null })
  })

  it('REVIEW FOCUS #4: excludes an abandoned mid-mapping migration from every aggregate, while still surfacing it as the latest with its real status', () => {
    const completed = m({ status: 'completed', row_count: 100, accuracy_rating: 90, created_at: '2026-10-01T00:00:00Z' })
    const abandoned = m({ status: 'mapping', row_count: 500, accuracy_rating: null, created_at: '2026-10-05T00:00:00Z' })
    const stats = computeDashboardStats([completed, abandoned])

    expect(stats.completedCount).toBe(1)
    expect(stats.recordsProcessed).toBe(100) // not 600 — the abandoned one's 500 rows never counted
    expect(stats.avgAccuracy).toBe(90)
    expect(stats.latest).toBe(abandoned) // most recent by created_at, regardless of status
    expect(stats.latest?.status).toBe('mapping') // shown honestly, not implied complete
  })

  it('averages accuracy only across completed migrations that actually have a rating', () => {
    const a = m({ accuracy_rating: 80, created_at: '2026-10-01T00:00:00Z' })
    const b = m({ accuracy_rating: null, created_at: '2026-10-02T00:00:00Z' }) // completed but 0 records written, so no sample
    const c = m({ accuracy_rating: 100, created_at: '2026-10-03T00:00:00Z' })
    expect(computeDashboardStats([a, b, c]).avgAccuracy).toBe(90)
  })

  it('picks the most recent migration as latest even when it is earlier in the array', () => {
    const older = m({ created_at: '2026-10-01T00:00:00Z' })
    const newer = m({ created_at: '2026-10-09T00:00:00Z' })
    expect(computeDashboardStats([older, newer]).latest).toBe(newer)
  })
})
