import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { computeDashboardStats, type DashboardMigrationLike } from './dashboardStats'

interface MigrationRow extends DashboardMigrationLike { id: string; original_filename: string }
interface MemberRow { user_id: string; users: { name: string } | null }

export function DataAgentDashboard({ subAccount }: { subAccount: string }) {
  const [migrations, setMigrations] = useState<MigrationRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void supabase.from('data_agent_migrations').select('id, status, row_count, accuracy_rating, created_at, original_filename')
      .eq('sub_account', subAccount).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setLoadError('Could not load migration history.'); return }
        setMigrations((data ?? []) as MigrationRow[])
      })
    void supabase.from('data_agent_members').select('user_id, users(name)').eq('sub_account', subAccount)
      .then(({ data, error }) => {
        if (error) { setLoadError('Could not load team members.'); return }
        setMembers((data ?? []) as unknown as MemberRow[])
      })
  }, [subAccount])

  const stats = computeDashboardStats(migrations)

  return (
    <div className="space-y-5">
      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Migrations Completed" value={stats.completedCount} testId="completed-count" />
        <StatCard label="Records Processed" value={stats.recordsProcessed} testId="records-processed" />
        <StatCard label="Avg. Accuracy" value={stats.avgAccuracy !== null ? `${stats.avgAccuracy.toFixed(1)}%` : '—'} testId="avg-accuracy" />
        <StatCard label="Team Members" value={members.length} testId="member-count" />
      </div>

      {stats.latest && (
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-400">Most recent</p>
          <p className="text-sm font-medium text-gray-900">{stats.latest.original_filename}</p>
          <span data-testid="latest-status" className="text-xs font-semibold text-gray-600">{stats.latest.status}</span>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Migration History</h3>
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {migrations.filter(m => m.id !== stats.latest?.id).map(m => (
            <li key={m.id} className="px-4 py-2 text-sm">
              <Link to={`/data-agent/migrations/${m.id}`} className="text-violet-700 hover:underline">{m.original_filename}</Link>
              <span className="text-gray-400 ml-2 text-xs">{m.status}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Team</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          {members.map(m => <li key={m.user_id}>{m.users?.name}</li>)}
        </ul>
      </div>
    </div>
  )
}

function StatCard({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p data-testid={testId} className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  )
}
