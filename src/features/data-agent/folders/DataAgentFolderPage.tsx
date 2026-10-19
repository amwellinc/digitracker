import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { DataAgentConnection } from '@/types/dataAgent'
import { DataAgentDashboard } from '../dashboard/DataAgentDashboard'
import { NewMigrationModal } from '../upload/NewMigrationModal'

// One folder per GHL connection — its own name, migration history
// ("files"), team view, and chat, instead of everything for a
// sub-account's several concurrent projects blending into one dashboard.
export function DataAgentFolderPage() {
  const { connectionId } = useParams<{ connectionId: string }>()
  const navigate = useNavigate()
  const [connection, setConnection] = useState<DataAgentConnection | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    if (!connectionId) return
    void supabase.from('data_agent_connections').select('id, sub_account, label, ghl_location_id, last_verified_at')
      .eq('id', connectionId).maybeSingle()
      .then(({ data, error }) => {
        if (error) { setLoadError('Could not load this connection.'); return }
        if (!data) { setLoadError('Connection not found.'); return }
        setConnection(data as DataAgentConnection)
      })
  }, [connectionId])

  if (loadError) return <p role="alert" className="text-sm text-red-600">{loadError}</p>
  if (!connection || !connectionId) return null

  return (
    <div className="space-y-4">
      <div>
        <Link to="/data-agent" className="text-xs font-semibold text-violet-700 hover:underline">← All Projects</Link>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span aria-hidden>📁</span>{connection.label}
          </h1>
          <p className="text-sm text-gray-500">Location ID: {connection.ghl_location_id}</p>
        </div>
        <button onClick={() => setShowNew(true)} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
          New Migration
        </button>
      </div>
      <DataAgentDashboard subAccount={connection.sub_account} connectionId={connectionId} />
      {showNew && (
        <NewMigrationModal
          subAccount={connection.sub_account}
          initialConnectionId={connectionId}
          onClose={() => setShowNew(false)}
          onCreated={migrationId => navigate(`/data-agent/migrations/${migrationId}`)}
        />
      )}
    </div>
  )
}
