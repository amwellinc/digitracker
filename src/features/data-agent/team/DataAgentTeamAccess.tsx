import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface MemberRow { user_id: string; users: { name: string } | null }
interface CandidateRow { id: string; name: string }

// Deliberately mirrors AddProjectMemberForm's search-then-explicit-grant
// pattern (src/features/projects/AddProjectMemberForm.tsx) rather than
// auto-granting the first name match — an access grant to the wrong
// person (e.g. two teammates both matching a partial "jo") must never
// happen silently.
//
// Rendered in each folder's own Team section (DataAgentDashboard) — this
// is purely "select an existing user, no invite email" by design: it
// only ever searches this workspace's own active users and grants access
// via add_data_agent_member, which also notifies the granted user in-app.
export function DataAgentTeamAccess({ subAccount }: { subAccount: string }) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [grantingId, setGrantingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadMembers = useCallback(async () => {
    // data_agent_members has TWO foreign keys into users (user_id and
    // added_by) — a bare `users(name)` embed is ambiguous to PostgREST
    // and errors out. The `!user_id` hint picks the right relationship.
    const { data, error } = await supabase.from('data_agent_members').select('user_id, users!user_id(name)').eq('sub_account', subAccount)
    if (error) { setMsg({ type: 'error', text: 'Could not load team members.' }); return }
    setMembers((data ?? []) as unknown as MemberRow[])
  }, [subAccount])

  useEffect(() => { if (subAccount) void loadMembers() }, [subAccount, loadMembers])

  async function runSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!search.trim()) return
    setSearching(true); setMsg(null)
    const { data } = await supabase.from('users').select('id, name').eq('sub_account', subAccount)
      .eq('status', 'active').ilike('name', `%${search.trim()}%`)
    setSearching(false); setSearched(true)
    const known = new Set(members.map(m => m.user_id))
    setCandidates(((data ?? []) as CandidateRow[]).filter(c => !known.has(c.id)))
  }

  async function grant(candidate: CandidateRow) {
    setGrantingId(candidate.id); setMsg(null)
    // Via RPC, not a direct table insert — add_data_agent_member writes
    // the membership row AND an in-app notification to the granted user
    // in the same server-side transaction, so every caller gets the
    // notification automatically (a direct client insert here never
    // would have).
    const { error } = await supabase.rpc('add_data_agent_member', { p_sub_account: subAccount, p_user_id: candidate.id })
    setGrantingId(null)
    if (error) { setMsg({ type: 'error', text: `Could not grant ${candidate.name}: ${error.message}` }); return }
    setMsg({ type: 'success', text: `${candidate.name} now has Data Agent access and has been notified.` })
    setSearch(''); setCandidates([]); setSearched(false)
    await loadMembers()
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Team Access</h3>
      <p className="text-xs text-gray-500">
        Admins always have access. Select an existing team member below to grant access — no invite email is sent.
      </p>
      <ul className="space-y-1">
        {members.length === 0 && <li className="text-xs text-gray-400">No team members yet.</li>}
        {members.map(m => <li key={m.user_id} className="text-sm text-gray-700">{m.users?.name}</li>)}
      </ul>
      <form onSubmit={e => void runSearch(e)} className="flex gap-2">
        <input value={search} onChange={e => { setSearch(e.target.value); setSearched(false) }} placeholder="Search by name…"
          aria-label="Search your team to grant access" className="input flex-1" />
        <button type="submit" disabled={searching || !search.trim()}
          className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-3 py-2">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {searched && candidates.length === 0 && (
        <p className="text-xs text-gray-400">No one in your workspace matched that name.</p>
      )}
      {candidates.length > 0 && (
        <div className="space-y-1">
          {candidates.map(c => (
            <button key={c.id} type="button" onClick={() => void grant(c)} disabled={grantingId === c.id}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-violet-300 text-left disabled:opacity-50">
              <span className="text-sm text-gray-700">{c.name}</span>
              <span className="text-xs font-semibold text-violet-600">{grantingId === c.id ? 'Granting…' : '+ Grant'}</span>
            </button>
          ))}
        </div>
      )}
      {msg && (
        <p role={msg.type === 'error' ? 'alert' : 'status'} className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </section>
  )
}
