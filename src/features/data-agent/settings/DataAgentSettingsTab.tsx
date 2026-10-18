import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface ConnectionRow { ghl_location_id: string; last_verified_at: string | null }
interface MemberRow { user_id: string; users: { name: string } | null }

export function DataAgentSettingsTab() {
  const { user } = useAuth()
  const subAccount = user?.sub_account ?? ''
  const [locationId, setLocationId] = useState('')
  const [pit, setPit] = useState('')
  const [connection, setConnection] = useState<ConnectionRow | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!subAccount) return
    void supabase.from('data_agent_connections').select('ghl_location_id, last_verified_at')
      .eq('sub_account', subAccount).maybeSingle()
      .then(({ data }) => {
        const row = data as ConnectionRow | null
        if (row) { setConnection(row); setLocationId(row.ghl_location_id) }
      })
  }, [subAccount])

  async function saveConnection() {
    setSaving(true); setSaveMsg(null)
    const { error } = await supabase.rpc('save_data_agent_connection', {
      p_sub_account: subAccount, p_ghl_location_id: locationId.trim(), p_pit: pit.trim(),
    })
    setSaving(false)
    setSaveMsg(error ? error.message : 'Connection saved.')
    if (!error) setPit('')
  }

  async function testConnection() {
    setTesting(true); setTestMsg(null)
    const { data, error } = await supabase.functions.invoke('data-agent-test-connection', { body: { subAccount } })
    setTesting(false)
    if (error) { setTestMsg(`Connection test failed: ${error.message}`); return }
    const body = data as { ok: boolean; error?: string }
    setTestMsg(body.ok ? 'Connection verified — schema refreshed.' : `Connection test failed: ${body.error}`)
  }

  return (
    <div className="space-y-6 max-w-lg">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">GHL Connection</h3>
        <div>
          <label htmlFor="da-location" className="block text-xs font-medium text-gray-600 mb-1">GHL Location ID</label>
          <input id="da-location" value={locationId} onChange={e => setLocationId(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label htmlFor="da-pit" className="block text-xs font-medium text-gray-600 mb-1">Private Integration Token</label>
          <input id="da-pit" type="password" value={pit} onChange={e => setPit(e.target.value)} className="input w-full"
            placeholder={connection ? 'Enter a new token to replace the saved one' : ''} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => void saveConnection()} disabled={saving || !locationId.trim() || !pit.trim()}
            className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
            {saving ? 'Saving…' : 'Save Connection'}
          </button>
          <button onClick={() => void testConnection()} disabled={testing || !connection}
            className="text-sm font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 rounded-md px-4 py-2">
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
        {saveMsg && <p className="text-sm text-gray-600">{saveMsg}</p>}
        {testMsg && <p className="text-sm text-gray-600">{testMsg}</p>}
        {connection?.last_verified_at && (
          <p className="text-xs text-gray-400">Last verified {new Date(connection.last_verified_at).toLocaleString()}</p>
        )}
      </section>
      <DataAgentTeamAccess subAccount={subAccount} />
    </div>
  )
}

function DataAgentTeamAccess({ subAccount }: { subAccount: string }) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!subAccount) return
    void supabase.from('data_agent_members').select('user_id, users(name)').eq('sub_account', subAccount)
      .then(({ data }) => setMembers((data ?? []) as unknown as MemberRow[]))
  }, [subAccount])

  async function grant(userId: string) {
    await supabase.from('data_agent_members').insert({ sub_account: subAccount, user_id: userId })
    const { data } = await supabase.from('data_agent_members').select('user_id, users(name)').eq('sub_account', subAccount)
    setMembers((data ?? []) as unknown as MemberRow[])
  }

  async function runSearch() {
    if (!search.trim()) return
    const { data } = await supabase.from('users').select('id, name').eq('sub_account', subAccount)
      .eq('status', 'active').ilike('name', `%${search.trim()}%`)
    const known = new Set(members.map(m => m.user_id))
    const candidates = ((data ?? []) as { id: string; name: string }[]).filter(c => !known.has(c.id))
    if (candidates.length > 0) await grant(candidates[0].id)
    setSearch('')
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Team Access</h3>
      <p className="text-xs text-gray-500">
        Admins always have access. Grant access to other team members here.
      </p>
      <ul className="space-y-1">
        {members.map(m => <li key={m.user_id} className="text-sm text-gray-700">{m.users?.name}</li>)}
      </ul>
      <div className="flex gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name…"
          aria-label="Search your team to grant access" className="input flex-1" />
        <button onClick={() => void runSearch()} className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-3 py-2">
          Grant Access
        </button>
      </div>
    </section>
  )
}
