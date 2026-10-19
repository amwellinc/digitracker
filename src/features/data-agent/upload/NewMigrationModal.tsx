import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface Props {
  subAccount: string
  onCreated: (migrationId: string) => void
  onClose: () => void
}

export function NewMigrationModal({ subAccount, onCreated, onClose }: Props) {
  const [objectTypes, setObjectTypes] = useState<string[]>([])
  const [target, setTarget] = useState('contact')
  const [sourceSystem, setSourceSystem] = useState<'' | 'salesforce' | 'hubspot'>('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // null = still checking. Without this, a workspace with no GHL
  // connection yet could pick a file and click Upload, only to get a
  // server-side "No schema cached — run Test Connection in Settings
  // first" error after the fact, with no link to where that even is.
  const [hasConnection, setHasConnection] = useState<boolean | null>(null)

  useEffect(() => {
    void supabase.from('data_agent_connections').select('sub_account').eq('sub_account', subAccount).maybeSingle()
      .then(({ data }) => setHasConnection(!!data))
  }, [subAccount])

  useEffect(() => {
    void supabase.from('data_agent_ghl_schema_cache').select('object_type').eq('sub_account', subAccount)
      .then(({ data }) => setObjectTypes((data ?? []).map((r: { object_type: string }) => r.object_type)))
  }, [subAccount])

  async function handleUpload() {
    if (!file) return
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
      body: { subAccount, targetObjectType: target, sourceSystem: sourceSystem || null, storagePath, originalFilename: file.name },
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

        {hasConnection === false ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              This workspace isn&apos;t connected to a GHL CRM sub-account yet. Set up the connection
              in Settings before starting a migration — otherwise there&apos;s nothing to map or write to.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancel</button>
              <Link to="/settings?tab=data-agent" onClick={onClose}
                className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
                Go to Settings
              </Link>
            </div>
          </div>
        ) : (
          <>
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
              <label htmlFor="da-file" className="block text-xs font-medium text-gray-600 mb-1">CSV file</label>
              <input id="da-file" type="file" accept=".csv" aria-label="CSV file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </div>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancel</button>
              <button onClick={() => void handleUpload()} disabled={!file || uploading}
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
