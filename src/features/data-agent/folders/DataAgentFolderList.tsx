import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { DataAgentConnection } from '@/types/dataAgent'

// Each GHL connection is its own "folder" — a sub-account can run several
// migration projects in parallel (e.g. an agency migrating multiple
// end-client GHL accounts), and before this existed, every connection's
// migrations, chat, and stats were blended into one shared dashboard with
// no way to tell projects apart.
//
// Creating a folder (name + GHL Location ID + Private Integration Token)
// happens right here, not in Settings — project setup belongs next to the
// projects it creates. Only an Admin/Super-Admin can create one;
// add_data_agent_connection enforces this server-side too, so the role
// check here is a UI nicety, not the real security boundary.
export function DataAgentFolderList({ subAccount }: { subAccount: string }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'
  const [connections, setConnections] = useState<DataAgentConnection[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [label, setLabel] = useState('')
  const [locationId, setLocationId] = useState('')
  const [pit, setPit] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()

  const loadConnections = useCallback(async () => {
    const { data, error } = await supabase.from('data_agent_connections').select('id, sub_account, label, ghl_location_id, last_verified_at')
      .eq('sub_account', subAccount).order('connected_at')
    if (error) { setLoadError('Could not load connections.'); return }
    setConnections((data ?? []) as DataAgentConnection[])
  }, [subAccount])

  useEffect(() => { void loadConnections() }, [loadConnections])

  async function addConnection() {
    setAdding(true); setAddError(null)
    const { data, error } = await supabase.rpc('add_data_agent_connection', {
      p_sub_account: subAccount, p_label: label.trim(), p_ghl_location_id: locationId.trim(), p_pit: pit.trim(),
    })
    setAdding(false)
    if (error) { setAddError(error.message); return }
    // Straight into the new project — the token was just entered to get
    // here, so landing somewhere else first would be a dead-end detour.
    navigate(`/data-agent/connections/${data as string}`)
  }

  if (loadError) return <p role="alert" className="text-sm text-red-600">{loadError}</p>

  if (connections?.length === 0 && !showAddForm) {
    return (
      <div className="border border-gray-200 rounded-lg p-6 text-center space-y-2">
        <p className="text-sm text-gray-600">No GHL connections yet for this workspace.</p>
        {isAdmin ? (
          <button onClick={() => setShowAddForm(true)} className="text-sm font-semibold text-violet-700 hover:underline">
            + Create your first project
          </button>
        ) : (
          <p className="text-xs text-gray-400">Ask an Admin to set one up.</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex justify-end">
          <button onClick={() => setShowAddForm(v => !v)}
            className="text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-md px-3 py-1.5">
            {showAddForm ? 'Cancel' : '+ New Project'}
          </button>
        </div>
      )}
      {showAddForm && (
        <div className="border border-violet-200 rounded-lg p-4 space-y-3 bg-violet-50/40">
          <div>
            <label htmlFor="da-new-label" className="block text-xs font-medium text-gray-600 mb-1">Project name</label>
            <input id="da-new-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Acme Corp — Production" className="input w-full" />
          </div>
          <div>
            <label htmlFor="da-new-location" className="block text-xs font-medium text-gray-600 mb-1">GHL Location ID</label>
            <input id="da-new-location" value={locationId} onChange={e => setLocationId(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label htmlFor="da-new-pit" className="block text-xs font-medium text-gray-600 mb-1">Private Integration Token</label>
            <input id="da-new-pit" type="password" autoComplete="off" value={pit} onChange={e => setPit(e.target.value)} className="input w-full" />
          </div>
          {addError && <p role="alert" className="text-sm text-red-600">{addError}</p>}
          <button onClick={() => void addConnection()} disabled={adding || !label.trim() || !locationId.trim() || !pit.trim()}
            className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
            {adding ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      )}
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
    </div>
  )
}
