import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { DataAgentConnection } from '@/types/dataAgent'

// Connection setup/management (rename, test, rotate token, remove) lives
// on the folder itself, not in Settings — and only an Admin/Super-Admin
// ever sees these controls, since the underlying RPCs enforce that role
// server-side anyway; this keeps non-admin team members from even seeing
// a token-rotation control they could never use. Rename exists because a
// connection with migration history can never be deleted (by design, to
// protect undo/history) — including every connection backfilled with the
// literal label 'Default Connection' when multi-connection support
// shipped — so renaming is the only way to ever change its name again.
export function DataAgentConnectionPanel({ connection, onChanged }: { connection: DataAgentConnection; onChanged: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const [rotateToken, setRotateToken] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [newLabel, setNewLabel] = useState(connection.label)

  if (!isAdmin) return null

  async function renameConnection() {
    if (!newLabel.trim()) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('update_data_agent_connection_label', { p_connection_id: connection.id, p_label: newLabel.trim() })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setRenaming(false)
    onChanged()
  }

  async function testConnection() {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.functions.invoke('data-agent-test-connection', { body: { connectionId: connection.id } })
    setBusy(false)
    if (error) { setMsg(`Connection test failed: ${error.message}`); return }
    const body = data as { ok: boolean; error?: string }
    setMsg(body.ok ? 'Verified — schema refreshed.' : `Connection test failed: ${body.error}`)
    if (body.ok) onChanged()
  }

  async function rotateTokenFor() {
    if (!rotateToken.trim()) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('update_data_agent_connection_token', { p_connection_id: connection.id, p_pit: rotateToken.trim() })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setMsg('Token updated.')
    setRotating(false); setRotateToken('')
  }

  async function removeConnection() {
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('delete_data_agent_connection', { p_connection_id: connection.id })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    navigate('/data-agent')
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-900">Connection (Admin)</p>
        <div className="flex gap-1">
          <button onClick={() => { setRenaming(v => !v); setNewLabel(connection.label) }}
            className="text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md px-2 py-1">
            Rename
          </button>
          <button onClick={() => void testConnection()} disabled={busy}
            className="text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 rounded-md px-2 py-1">
            {busy ? 'Working…' : 'Test'}
          </button>
          <button onClick={() => { setRotating(v => !v); setRotateToken('') }}
            className="text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md px-2 py-1">
            Rotate token
          </button>
          <button onClick={() => void removeConnection()} disabled={busy}
            className="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-md px-2 py-1">
            Remove
          </button>
        </div>
      </div>
      {renaming && (
        <div className="flex gap-2">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            aria-label="Project name" className="input flex-1 text-xs" />
          <button onClick={() => void renameConnection()} disabled={busy || !newLabel.trim()}
            className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-3">
            Save
          </button>
        </div>
      )}
      {rotating && (
        <div className="flex gap-2">
          <input type="password" autoComplete="off" value={rotateToken} onChange={e => setRotateToken(e.target.value)}
            placeholder="New Private Integration Token" aria-label="New Private Integration Token" className="input flex-1 text-xs" />
          <button onClick={() => void rotateTokenFor()} disabled={busy || !rotateToken.trim()}
            className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-3">
            Save
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
      {connection.last_verified_at && <p className="text-xs text-gray-400">Last verified {new Date(connection.last_verified_at).toLocaleString()}</p>}
    </div>
  )
}
