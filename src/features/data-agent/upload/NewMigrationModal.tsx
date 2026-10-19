import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { DataAgentConnection } from '@/types/dataAgent'

interface Props {
  subAccount: string
  // When opened from inside a connection's own folder page, this pins the
  // picker to that connection instead of defaulting to the first one in
  // the list — starting a migration from within a folder should target
  // that folder, not whichever connection happens to be oldest.
  initialConnectionId?: string
  onCreated: (migrationId: string) => void
  onClose: () => void
}

export function NewMigrationModal({ subAccount, initialConnectionId, onCreated, onClose }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'
  // null = still loading connections. A sub-account can have several now
  // (e.g. one per end-client GHL account) — without a picker here, there
  // was no way to choose which one a migration targets, and nothing told
  // the user which account a migration would even go to.
  const [connections, setConnections] = useState<DataAgentConnection[] | null>(null)
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? '')
  const [objectTypes, setObjectTypes] = useState<string[]>([])
  const [target, setTarget] = useState('contact')
  const [sourceSystem, setSourceSystem] = useState<'' | 'salesforce' | 'hubspot'>('')
  const [instructions, setInstructions] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void supabase.from('data_agent_connections').select('id, sub_account, label, ghl_location_id, last_verified_at')
      .eq('sub_account', subAccount).order('connected_at')
      .then(({ data }) => {
        const rows = (data ?? []) as DataAgentConnection[]
        setConnections(rows)
        if (rows.length === 0) return
        const initialStillValid = initialConnectionId && rows.some(r => r.id === initialConnectionId)
        setConnectionId(initialStillValid ? initialConnectionId! : rows[0].id)
      })
  }, [subAccount, initialConnectionId])

  useEffect(() => {
    if (!connectionId) { setObjectTypes([]); return }
    void supabase.from('data_agent_ghl_schema_cache').select('object_type').eq('connection_id', connectionId)
      .then(({ data }) => setObjectTypes((data ?? []).map((r: { object_type: string }) => r.object_type)))
  }, [connectionId])

  async function handleUpload() {
    if (!file || !connectionId) return
    setUploading(true); setError(null)
    // Storage keys reject some characters outright, and the backend's own
    // storagePath validator (data-agent-upload/index.ts) is deliberately
    // strict about what can follow the subAccount prefix — sanitizing here
    // means a filename with spaces, unicode, "#", "%", etc. still uploads
    // instead of failing with a cryptic "Invalid key" error. The real
    // name is preserved separately below as originalFilename for display.
    const safeFilename = file.name.replace(/[^A-Za-z0-9._-]/g, '_')
    const storagePath = `${subAccount}/${crypto.randomUUID()}-${safeFilename}`
    const { error: uploadErr } = await supabase.storage.from('data-agent-uploads').upload(storagePath, file)
    if (uploadErr) { setUploading(false); setError(uploadErr.message); return }

    const { data, error: fnErr } = await supabase.functions.invoke('data-agent-upload', {
      body: {
        subAccount, connectionId, targetObjectType: target, sourceSystem: sourceSystem || null, storagePath, originalFilename: file.name,
        instructions: instructions.trim() || null,
      },
    })
    setUploading(false)
    // data-agent-upload returns HTTP 200 for every business outcome (see
    // its own comment) so a real failure shows up as `data.error`, not a
    // thrown `fnErr` — `fnErr` only fires for a genuine network/relay
    // failure, which has no useful `.message` of its own either.
    if (fnErr) { setError('Could not reach the upload service — check your connection and try again.'); return }
    const result = data as { migrationId?: string; error?: string }
    if (!result.migrationId) { setError(result.error ?? 'Upload failed for an unknown reason.'); return }
    onCreated(result.migrationId)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900">New Migration</h2>

        {connections?.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              This workspace isn&apos;t connected to a GHL CRM account yet.{' '}
              {isAdmin
                ? 'Close this and use "+ New Project" to set one up — otherwise there\'s nothing to map or write to.'
                : 'Ask an Admin to set one up — otherwise there\'s nothing to map or write to.'}
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="da-connection" className="block text-xs font-medium text-gray-600 mb-1">GHL account</label>
              <select id="da-connection" aria-label="GHL account" value={connectionId} onChange={e => setConnectionId(e.target.value)} className="input w-full">
                {(connections ?? []).map(c => <option key={c.id} value={c.id}>{c.label} ({c.ghl_location_id})</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="da-target" className="block text-xs font-medium text-gray-600 mb-1">Target</label>
              <select id="da-target" aria-label="target" value={target} onChange={e => setTarget(e.target.value)} className="input w-full">
                <option value="contact">Contacts</option>
                {objectTypes.filter(t => t !== 'contact').map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="da-source" className="block text-xs font-medium text-gray-600 mb-1">Source system (optional)</label>
              <select id="da-source" value={sourceSystem} onChange={e => setSourceSystem(e.target.value as '' | 'salesforce' | 'hubspot')} className="input w-full">
                <option value="">Not sure / other</option>
                <option value="salesforce">Salesforce</option>
                <option value="hubspot">HubSpot</option>
              </select>
            </div>

            <div>
              <label htmlFor="da-instructions" className="block text-xs font-medium text-gray-600 mb-1">Instructions for the agent (optional)</label>
              <textarea id="da-instructions" value={instructions} onChange={e => setInstructions(e.target.value)} rows={2}
                placeholder={'e.g. "Analyze this file, map accordingly, and report any errors or issues" or "Tag these as the Spring Promo list"'}
                className="input w-full text-sm" />
              <p className="text-xs text-gray-400 mt-1">Guides the AI&apos;s column mapping — it won&apos;t perform actions outside mapping (e.g. it can&apos;t create a GHL Smart List for you).</p>
            </div>

            <div>
              <label htmlFor="da-file" className="block text-xs font-medium text-gray-600 mb-1">CSV file</label>
              <input id="da-file" type="file" accept=".csv" aria-label="CSV file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </div>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancel</button>
              <button onClick={() => void handleUpload()} disabled={!file || !connectionId || uploading}
                className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
