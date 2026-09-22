import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Project, User } from '@/types'

interface Member {
  user_id: string
  name: string
  email: string
  sub_account: string
  role: string
}

// Task creation within a project follows the member's existing company
// role (see migration 057) — Admin/Manager/Super-Admin only. This badge is
// what lets a Super-Admin see, while assigning members, who will actually
// be able to create tasks once added.
function RoleBadge({ role }: { role: string }) {
  const canCreate = role === 'Admin' || role === 'Manager' || role === 'Super-Admin'
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      canCreate ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'
    }`}>
      {role}
    </span>
  )
}

interface Props {
  project: Project
  onClose: () => void
}

export function ProjectDetailPanel({ project, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Pick<User, 'id' | 'name' | 'email' | 'sub_account' | 'role'>[]>([])
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .select('user_id, users(name, email, sub_account, role)')
      .eq('project_id', project.id)
    if (error) {
      setMsg({ type: 'error', text: `Could not load members: ${error.message}` })
      return
    }
    type Row = { user_id: string; users: { name: string; email: string; sub_account: string; role: string } | null }
    const rows = (data ?? []) as unknown as Row[]
    setMembers(
      rows
        .filter(r => r.users)
        .map(r => ({ user_id: r.user_id, name: r.users!.name, email: r.users!.email, sub_account: r.users!.sub_account, role: r.users!.role }))
    )
  }, [project.id])

  useEffect(() => { void loadMembers() }, [loadMembers])

  useEffect(() => {
    if (!search.trim()) { setCandidates([]); return }
    void supabase
      .from('users')
      .select('id, name, email, sub_account, role')
      .ilike('email', `%${search.trim()}%`)
      .then(({ data, error }) => {
        if (error) {
          setMsg({ type: 'error', text: `Search failed: ${error.message}` })
          return
        }
        setCandidates((data ?? []) as Pick<User, 'id' | 'name' | 'email' | 'sub_account' | 'role'>[])
      })
  }, [search])

  async function handleAdd(userId: string) {
    setMsg(null)
    const { error } = await supabase.rpc('add_project_member', { p_project_id: project.id, p_user_id: userId })
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: 'Member added.' })
    setSearch('')
    setCandidates([])
    void loadMembers()
  }

  async function handleRemove(userId: string) {
    setMsg(null)
    const { error } = await supabase.rpc('remove_project_member', { p_project_id: project.id, p_user_id: userId })
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    void loadMembers()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">{project.name}</h3>
        <p className="text-xs text-gray-400 mb-4">Members can come from up to 3 different workspaces.</p>

        {msg && (
          <p className={`text-sm mb-3 ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
        )}

        <div className="mb-4">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by email to add a member"
            className="input"
          />
          {candidates.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100">
              {candidates.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    {c.name} — {c.email} <span className="text-gray-400">({c.sub_account})</span>
                    <RoleBadge role={c.role} />
                  </span>
                  <button
                    onClick={() => handleAdd(c.id)}
                    className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-3 py-1"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {members.map(m => (
            <div key={m.user_id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
              <span className="flex items-center gap-2">
                {m.name} — {m.email} <span className="text-gray-400">({m.sub_account})</span>
                <RoleBadge role={m.role} />
              </span>
              <button
                onClick={() => handleRemove(m.user_id)}
                className="text-xs font-semibold text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-4">
          <button onClick={onClose} className="btn-ghost text-sm">Close</button>
        </div>
      </div>
    </div>
  )
}
