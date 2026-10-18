export interface DashboardMigrationLike {
  status: string
  row_count: number
  accuracy_rating: number | null
  created_at: string
}

export interface DashboardStats<T extends DashboardMigrationLike> {
  completedCount: number
  recordsProcessed: number
  avgAccuracy: number | null
  latest: T | null
}

export function computeDashboardStats<T extends DashboardMigrationLike>(migrations: T[]): DashboardStats<T> {
  const completed = migrations.filter(m => m.status === 'completed')
  const ratings = completed.map(m => m.accuracy_rating).filter((r): r is number => r !== null)

  const latest = migrations.reduce<T | null>((acc, m) =>
    !acc || new Date(m.created_at).getTime() > new Date(acc.created_at).getTime() ? m : acc, null)

  return {
    completedCount: completed.length,
    recordsProcessed: completed.reduce((sum, m) => sum + m.row_count, 0),
    avgAccuracy: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    latest,
  }
}
