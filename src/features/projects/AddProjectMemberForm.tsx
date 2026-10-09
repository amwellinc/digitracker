import { useEffect, useState } from 'react'
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
export function AddProjectMemberForm({ projectId, existingMemberIds, onAdded }: Props) {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Pick<User, 'id' | 'name' | 'role'>[]>([])
  const [addingId, setAddingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!user?.sub_account || !search.trim()) { setCandidates([]); return }
    let cancelled = false
    void supabase
      .from('users')
      .select('id, name, role')
      .eq('sub_account', user.sub_account)
      .eq('status', 'active')
      .ilike('name', `%${search.trim()}%`)
      .then(({ data }) => {
        if (cancelled) return
        const known = new Set(existingMemberIds)
        setCandidates(((data ?? []) as Pick<User, 'id' | 'name' | 'role'>[]).filter(c => !known.has(c.id)))
      })
    return () => { cancelled = true }
  }, [search, user?.sub_account, existingMemberIds])

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
    onAdded()
  }

  return (
    <div className="border border-violet-200 bg-violet-50/50 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-violet-800">Add a teammate from your workspace</p>
      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by name…" aria-label="Search your workspace to add a teammate"
        className="input w-full sm:max-w-xs"
      />
      {candidates.length > 0 && (
        <div className="space-y-1 max-w-xs">
          {candidates.map(c => (
            <button key={c.id} type="button" onClick={() => void addMember(c)} disabled={addingId === c.id}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-violet-300 text-left disabled:opacity-50">
              <span className="text-sm text-gray-700">{c.name} <span className="text-gray-400">({c.role})</span></span>
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
