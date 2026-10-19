import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { DataAgentConnection } from '@/types/dataAgent'
import { DataAgentTeamAccess } from '../team/DataAgentTeamAccess'

export function DataAgentSettingsTab() {
  const { user } = useAuth()
  const subAccount = user?.sub_account ?? ''

  return (
    <div className="space-y-6 max-w-lg">
      <DataAgentConnections subAccount={subAccount} />
      <DataAgentTeamAccess subAccount={subAccount} />
    </div>
  )
}

// A sub-account can have several GHL connections — e.g. an agency running
// Data Agent for multiple end-client GHL accounts, or a business
// migrating into both a sandbox and a production location. Each one is
// independently named (`label`), tested, and token-rotated; New Migration
// (NewMigrationModal.tsx) lets the user pick which one a given migration
// targets.
function DataAgentConnections({ subAccount }: { subAccount: string }) {
  const [connections, setConnections] = useState<DataAgentConnection[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [label, setLabel] = useState('')
  const [locationId, setLocationId] = useState('')
  const [pit, setPit] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({})
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [rotateToken, setRotateToken] = useState('')

  const loadConnections = useCallback(async () => {
    if (!subAccount) return
    const { data, error } = await supabase.from('data_agent_connections')
      .select('id, sub_account, label, ghl_location_id, last_verified_at').eq('sub_account', subAccount).order('connected_at')
    if (error) { setLoadError('Could not load connections.'); return }
    setConnections((data ?? []) as DataAgentConnection[])
  }, [subAccount])

  useEffect(() => { void loadConnections() }, [loadConnections])

  async function addConnection() {
    setAdding(true); setAddError(null)
    const { error } = await supabase.rpc('add_data_agent_connection', {
      p_sub_account: subAccount, p_label: label.trim(), p_ghl_location_id: locationId.trim(), p_pit: pit.trim(),
    })
    setAdding(false)
    if (error) { setAddError(error.message); return }
    setLabel(''); setLocationId(''); setPit(''); setShowAddForm(false)
    await loadConnections()
  }

  async function testConnection(connectionId: string) {
    setRowBusy(connectionId); setRowMsg(prev => ({ ...prev, [connectionId]: '' }))
    const { data, error } = await supabase.functions.invoke('data-agent-test-connection', { body: { connectionId } })
    setRowBusy(null)
    if (error) { setRowMsg(prev => ({ ...prev, [connectionId]: `Connection test failed: ${error.message}` })); return }
    const body = data as { ok: boolean; error?: string }
    setRowMsg(prev => ({ ...prev, [connectionId]: body.ok ? 'Verified — schema refreshed.' : `Connection test failed: ${body.error}` }))
    if (body.ok) await loadConnections()
  }

  async function rotateTokenFor(connectionId: string) {
    if (!rotateToken.trim()) return
    setRowBusy(connectionId)
    const { error } = await supabase.rpc('update_data_agent_connection_token', { p_connection_id: connectionId, p_pit: rotateToken.trim() })
    setRowBusy(null)
    if (error) { setRowMsg(prev => ({ ...prev, [connectionId]: error.message })); return }
    setRowMsg(prev => ({ ...prev, [connectionId]: 'Token updated.' }))
    setRotatingId(null); setRotateToken('')
  }

  async function deleteConnection(connectionId: string) {
    setRowBusy(connectionId)
    const { error } = await supabase.rpc('delete_data_agent_connection', { p_connection_id: connectionId })
    setRowBusy(null)
    if (error) { setRowMsg(prev => ({ ...prev, [connectionId]: error.message })); return }
    await loadConnections()
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">GHL Connections</h3>
        <button onClick={() => setShowAddForm(v => !v)}
          className="text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-md px-3 py-1.5">
          {showAddForm ? 'Cancel' : '+ Add Connection'}
        </button>
      </div>

      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}

      {connections.length === 0 && !showAddForm && (
        <p className="text-xs text-gray-400">No GHL connections yet — add one to start a migration.</p>
      )}

      <ul className="space-y-2">
        {connections.map(c => (
          <li key={c.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              {/* The label + location id together are the "which account
                  is this" indication that was previously missing entirely —
                  a bare, unlabeled connection gave no way to tell GHL
                  accounts apart once more than one existed. */}
              <div>
                <p className="text-sm font-semibold text-gray-900">{c.label}</p>
                <p className="text-xs text-gray-500">Location ID: {c.ghl_location_id}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => void testConnection(c.id)} disabled={rowBusy === c.id}
                  className="text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 rounded-md px-2 py-1">
                  {rowBusy === c.id ? 'Testing…' : 'Test'}
                </button>
                <button onClick={() => { setRotatingId(rotatingId === c.id ? null : c.id); setRotateToken('') }}
                  className="text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md px-2 py-1">
                  Rotate token
                </button>
                <button onClick={() => void deleteConnection(c.id)} disabled={rowBusy === c.id}
                  className="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-md px-2 py-1">
                  Remove
                </button>
              </div>
            </div>
            {rotatingId === c.id && (
              <div className="flex gap-2">
                <input type="password" autoComplete="off" value={rotateToken} onChange={e => setRotateToken(e.target.value)}
                  placeholder="New Private Integration Token" aria-label={`New token for ${c.label}`} className="input flex-1 text-xs" />
                <button onClick={() => void rotateTokenFor(c.id)} disabled={rowBusy === c.id || !rotateToken.trim()}
                  className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-3">
                  Save
                </button>
              </div>
            )}
            {rowMsg[c.id] && <p className="text-xs text-gray-600">{rowMsg[c.id]}</p>}
            {c.last_verified_at && <p className="text-xs text-gray-400">Last verified {new Date(c.last_verified_at).toLocaleString()}</p>}
          </li>
        ))}
      </ul>

      {showAddForm && (
        <div className="border border-violet-200 rounded-lg p-3 space-y-3 bg-violet-50/40">
          <div>
            <label htmlFor="da-new-label" className="block text-xs font-medium text-gray-600 mb-1">Connection name</label>
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
            {adding ? 'Adding…' : 'Add Connection'}
          </button>
        </div>
      )}
    </section>
  )
}

