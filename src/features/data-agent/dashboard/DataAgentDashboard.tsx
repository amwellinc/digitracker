import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { computeDashboardStats, type DashboardMigrationLike } from './dashboardStats'
import { DataAgentChat } from '../chat/DataAgentChat'
import { DataAgentTeamAccess } from '../team/DataAgentTeamAccess'

interface MigrationRow extends DashboardMigrationLike { id: string; original_filename: string }
interface MemberRow { user_id: string; users: { name: string } | null }

// One per connection ("folder") — migrations are scoped to connectionId
// since a sub-account can run several GHL connections/projects in
// parallel now, and this dashboard shows only the one folder's work.
// Team stays scoped to the whole sub-account by design: team access is
// granted per sub-account (Settings), not per individual connection.
export function DataAgentDashboard({ subAccount, connectionId }: { subAccount: string; connectionId: string }) {
  const [migrations, setMigrations] = useState<MigrationRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [migrationsError, setMigrationsError] = useState<string | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)

  useEffect(() => {
    void supabase.from('data_agent_migrations').select('id, status, row_count, accuracy_rating, created_at, original_filename')
      .eq('connection_id', connectionId).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setMigrationsError('Could not load migration history.'); return }
        setMigrations((data ?? []) as MigrationRow[])
      })
  }, [connectionId])

  useEffect(() => {
    // data_agent_members has TWO foreign keys into users (user_id and
    // added_by) — a bare `users(name)` embed is ambiguous to PostgREST
    // (it can't tell which relationship to follow) and errors out. The
    // `!user_id` hint picks the right one explicitly.
    void supabase.from('data_agent_members').select('user_id, users!user_id(name)').eq('sub_account', subAccount)
      .then(({ data, error }) => {
        if (error) { setMembersError('Could not load team members.'); return }
        setMembers((data ?? []) as unknown as MemberRow[])
      })
  }, [subAccount])

  const stats = computeDashboardStats(migrations)

  return (
    <div className="space-y-5">
      {migrationsError && <p role="alert" className="text-sm text-red-600">{migrationsError}</p>}
      {membersError && <p role="alert" className="text-sm text-red-600">{membersError}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Migrations Completed" value={stats.completedCount} testId="completed-count" />
        <StatCard label="Records Processed" value={stats.recordsProcessed} testId="records-processed" />
        <StatCard label="Avg. Accuracy" value={stats.avgAccuracy !== null ? `${stats.avgAccuracy.toFixed(1)}%` : '—'} testId="avg-accuracy" />
        <StatCard label="Team Members" value={members.length} testId="member-count" />
      </div>

      {stats.latest && (
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-400">Most recent</p>
          {/* Must stay a Link — the Migration History list below excludes
              stats.latest (it's already shown here), so this is the only
              click-through path to the latest migration's detail page.
              A plain-text callout here would be a navigation dead-end,
              exactly for the abandoned-mid-mapping case (Review Focus #4)
              where clicking through to resume mapping matters most. */}
          <Link to={`/data-agent/migrations/${stats.latest.id}`} className="text-sm font-medium text-violet-700 hover:underline">
            {stats.latest.original_filename}
          </Link>
          <span data-testid="latest-status" className="text-xs font-semibold text-gray-600 ml-2">{stats.latest.status}</span>
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
        <DataAgentTeamAccess subAccount={subAccount} />
      </div>

      <DataAgentChat subAccount={subAccount} connectionId={connectionId} />
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
