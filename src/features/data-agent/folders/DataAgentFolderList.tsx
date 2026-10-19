import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { DataAgentConnection } from '@/types/dataAgent'

// Each GHL connection is its own "folder" — a sub-account can run several
// migration projects in parallel (e.g. an agency migrating multiple
// end-client GHL accounts), and before this existed, every connection's
// migrations, chat, and stats were blended into one shared dashboard with
// no way to tell projects apart.
export function DataAgentFolderList({ subAccount }: { subAccount: string }) {
  const [connections, setConnections] = useState<DataAgentConnection[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void supabase.from('data_agent_connections').select('id, sub_account, label, ghl_location_id, last_verified_at')
      .eq('sub_account', subAccount).order('connected_at')
      .then(({ data, error }) => {
        if (error) { setLoadError('Could not load connections.'); return }
        setConnections((data ?? []) as DataAgentConnection[])
      })
  }, [subAccount])

  if (loadError) return <p role="alert" className="text-sm text-red-600">{loadError}</p>

  if (connections?.length === 0) {
    return (
      <div className="border border-gray-200 rounded-lg p-6 text-center space-y-2">
        <p className="text-sm text-gray-600">No GHL connections yet for this workspace.</p>
        <Link to="/settings?tab=data-agent" className="text-sm font-semibold text-violet-700 hover:underline">
          Set one up in Settings →
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {(connections ?? []).map(c => (
        <Link key={c.id} to={`/data-agent/connections/${c.id}`}
          className="block border border-gray-200 rounded-lg p-4 hover:border-violet-300 hover:shadow-sm transition-shadow">
          <div className="flex items-start gap-2">
            <span aria-hidden className="text-xl">📁</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{c.label}</p>
              <p className="text-xs text-gray-500">Location ID: {c.ghl_location_id}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
