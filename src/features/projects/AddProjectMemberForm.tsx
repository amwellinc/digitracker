import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { User } from '@/types'

interface Props {
  projectId: string
  existingMemberIds: string[]
  onAdded: () => void
}

// Direct "add a teammate" control — add_project_member already allows
// Admin/Manager to add someone from their own sub_account (see migrations
// 058 and 20261007010000), but the only UI that called it was buried
// inside task creation's "Assign To" picker: open New Task, open the
// dropdown, use a small search box at the bottom, pick someone, then
// actually submit the task. Nothing let an Admin just add a teammate to
// the project on its own, without creating a task as a side effect.
//
// The first version searched live as you typed, with no button at all
// until a match appeared — with nothing typed, or no match, there was
// nothing visibly clickable, reading as a feature with no button. This
// version always shows an explicit Search button next to the input.
export function AddProjectMemberForm({ projectId, existingMemberIds, onAdded }: Props) {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'Super-Admin'
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Pick<User, 'id' | 'name' | 'role' | 'sub_account'>[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function runSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.sub_account || !search.trim()) return
    setSearching(true)
    setMsg(null)
    // add_project_member already lets a Super-Admin add someone from ANY
    // workspace (it only enforces "your own workspace" for a plain
    // Admin/Manager) — scoping this search to the caller's own
    // sub_account unconditionally meant a Super-Admin could never even
    // FIND a cross-workspace person to add, let alone that the RPC would
    // have allowed it. Found live: invite-associate's own "add them as a
    // normal member instead" guidance was a dead end for exactly this
    // case, since this search couldn't surface them either.
    let query = supabase.from('users').select('id, name, role, sub_account').eq('status', 'active')
    if (!isSuperAdmin) query = query.eq('sub_account', user.sub_account)
    const { data } = await query.ilike('name', `%${search.trim()}%`)
    setSearching(false)
    setSearched(true)
    const known = new Set(existingMemberIds)
    setCandidates(((data ?? []) as Pick<User, 'id' | 'name' | 'role' | 'sub_account'>[]).filter(c => !known.has(c.id)))
  }

  async function addMember(c: Pick<User, 'id' | 'name' | 'role'>) {
    setAddingId(c.id)
    setMsg(null)
    const { error } = await supabase.rpc('add_project_member', { p_project_id: projectId, p_user_id: c.id })
    setAddingId(null)
    if (error) {
      setMsg({ type: 'error', text: `Could not add ${c.name}: ${error.message}` })
      return
    }
    setMsg({ type: 'success', text: `${c.name} added to this project.` })
    setSearch('')
    setCandidates([])
    setSearched(false)
    onAdded()
  }

  return (
    <div className="border border-violet-200 bg-violet-50/50 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-violet-800">
        {isSuperAdmin ? 'Add a teammate from any workspace' : 'Add a teammate from your workspace'}
      </p>
      <form onSubmit={e => void runSearch(e)} className="flex flex-col sm:flex-row gap-2">
        <input
          value={search} onChange={e => { setSearch(e.target.value); setSearched(false) }}
          placeholder="Search by name…" aria-label="Search your workspace to add a teammate"
          className="input flex-1 sm:max-w-xs"
        />
        <button type="submit" disabled={searching || !search.trim()}
          className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {searched && candidates.length === 0 && (
        <p className="text-xs text-gray-400">{isSuperAdmin ? 'No one matched that name.' : 'No one in your workspace matched that name.'}</p>
      )}
      {candidates.length > 0 && (
        <div className="space-y-1 max-w-xs">
          {candidates.map(c => (
            <button key={c.id} type="button" onClick={() => void addMember(c)} disabled={addingId === c.id}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-violet-300 text-left disabled:opacity-50">
              <span className="text-sm text-gray-700">
                {c.name} <span className="text-gray-400">({c.role}{isSuperAdmin ? ` · ${c.sub_account}` : ''})</span>
              </span>
              <span className="text-xs font-semibold text-violet-600">{addingId === c.id ? 'Adding…' : '+ Add'}</span>
            </button>
          ))}
        </div>
      )}
      {msg && (
        <p role={msg.type === 'error' ? 'alert' : 'status'} className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
