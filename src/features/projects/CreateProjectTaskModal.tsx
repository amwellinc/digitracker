import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { ProjectTask, User } from '@/types'

interface Props {
  projectId: string
  members: User[]
  onClose: () => void
  onCreated: () => void
  task?: ProjectTask
  assigneeIds?: string[]
}

interface Attachment { file: File; preview: string }

export function CreateProjectTaskModal({ projectId, members, task, assigneeIds: initAssignees = [], onClose, onCreated }: Props) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState(task?.title ?? '')
  const [desc, setDesc] = useState(task?.description ?? '')
  const [dueDate, setDueDate] = useState(task?.due_date ? task.due_date.slice(0, 16) : '')
  const [recurring, setRecurring] = useState<ProjectTask['recurring']>(task?.recurring ?? null)
  const [selectedIds, setSelectedIds] = useState<string[]>(initAssignees)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUserDrop, setShowUserDrop] = useState(false)

  // Admin/Manager can assign someone who isn't a project member yet — as
  // long as they're in the assigner's own workspace, adding them can never
  // push the project past its 3-workspace cap (that workspace is already
  // represented, since the assigner themselves is a member). `search`/
  // `candidates` find that person; `addedCandidates` holds anyone picked
  // this way so their name/avatar render even though they're not in the
  // `members` prop yet. add_project_member is called for each of them on
  // submit, before the task/assignee rows are written.
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Pick<User, 'id' | 'name' | 'role'>[]>([])
  const [addedCandidates, setAddedCandidates] = useState<User[]>([])
  const canAddFromWorkspace = user?.role === 'Admin' || user?.role === 'Manager' || user?.role === 'Super-Admin'
  const pickable = [...members, ...addedCandidates]

  useEffect(() => {
    if (!canAddFromWorkspace || !user?.sub_account || !search.trim()) { setCandidates([]); return }
    let cancelled = false
    void supabase
      .from('users')
      .select('id, name, role')
      .eq('sub_account', user.sub_account)
      .eq('status', 'active')
      .ilike('name', `%${search.trim()}%`)
      .then(({ data }) => {
        if (cancelled) return
        const known = new Set(pickable.map(m => m.id))
        setCandidates(((data ?? []) as Pick<User, 'id' | 'name' | 'role'>[]).filter(c => !known.has(c.id)))
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, canAddFromWorkspace, user?.sub_account])

  function toggleUser(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function pickCandidate(c: Pick<User, 'id' | 'name' | 'role'>) {
    setAddedCandidates(prev => [...prev, {
      id: c.id, name: c.name, role: c.role, email: '', sub_account: user?.sub_account ?? '',
      manager_id: null, annual_leave: 0, time_off: 0, profile_image: null,
      reporting_time_in: '', reporting_time_out: '', country: 'SG', phone: null,
      status: 'active', created_at: '', appointed_as: null, address_line1: null,
      address_line2: null, address_city: null, address_pin_code: null,
      last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
      emergency_contact_phone: null, department_id: null,
    }])
    setSelectedIds(prev => [...prev, c.id])
    setSearch('')
    setCandidates([])
  }

  function addFiles(files: FileList | null) {
    if (!files) return
    const newA: Attachment[] = []
    Array.from(files).forEach(f => {
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : ''
      newA.push({ file: f, preview })
    })
    setAttachments(p => [...p, ...newA])
  }

  async function uploadAttachments(taskId: string) {
    const uploaded: ProjectTask['attachments'] = [...(task?.attachments ?? [])]
    for (const a of attachments) {
      const path = `${taskId}/${Date.now()}-${a.file.name}`
      const { error: upErr } = await supabase.storage.from('task-attachments')
        .upload(path, a.file, { contentType: a.file.type })
      if (upErr) continue
      const { data: signed } = await supabase.storage.from('task-attachments')
        .createSignedUrl(path, 60 * 60 * 24 * 30)
      if (signed?.signedUrl) {
        uploaded.push({ url: signed.signedUrl, name: a.file.name, size: a.file.size, type: a.file.type })
      }
    }
    return uploaded
  }

  async function sendNotification(recipientId: string, type: string, msg: string) {
    await supabase.from('notifications').insert({ user_id: recipientId, type, message: msg, read: false })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !title.trim()) return
    setError(null)
    setSaving(true)

    // Grant project membership to anyone picked via the workspace search
    // before writing the task itself — an assignee who isn't a project
    // member can't see project_tasks at all under RLS, so this has to
    // happen first, not as an afterthought.
    for (const c of addedCandidates) {
      if (!selectedIds.includes(c.id)) continue
      const { error: memberErr } = await supabase.rpc('add_project_member', { p_project_id: projectId, p_user_id: c.id })
      if (memberErr) { setError(`Could not add ${c.name} to the project: ${memberErr.message}`); setSaving(false); return }
    }

    const primaryAssignee = selectedIds[0] ?? null
    const payload = {
      title: title.trim(),
      description: desc.trim() || null,
      creator_id: user.id,
      assignee_id: primaryAssignee,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      recurring: recurring ?? null,
    }

    if (task) {
      // Update existing
      const uploads = await uploadAttachments(task.id)
      const { error: updErr } = await supabase.from('project_tasks')
        .update({ ...payload, attachments: uploads }).eq('id', task.id)
      if (updErr) { setError(updErr.message); setSaving(false); return }

      // Sync assignees: delete all then re-insert
      const { error: delErr } = await supabase.from('project_task_assignees').delete().eq('project_task_id', task.id)
      if (delErr) { setError(`Task saved, but assignees failed to update: ${delErr.message}`); setSaving(false); return }
      if (selectedIds.length > 0) {
        const { error: assignErr } = await supabase.from('project_task_assignees').insert(
          selectedIds.map(uid => ({ project_task_id: task.id, user_id: uid }))
        )
        if (assignErr) { setError(`Task saved, but assignees failed to update: ${assignErr.message}`); setSaving(false); return }
      }
    } else {
      // Create new. The id is generated client-side and the insert never
      // requests a representation back (no .select()) — Supabase implements
      // "return the inserted row" as an INSERT wrapped in a CTE with
      // RETURNING, read by an outer SELECT, which is a meaningfully
      // different query shape under RLS than a bare INSERT. Knowing the id
      // upfront means we never need that shape at all.
      const tid = crypto.randomUUID()
      const { error: insErr } = await supabase.from('project_tasks').insert({ id: tid, ...payload, project_id: projectId, attachments: [] })
      if (insErr) { setError(insErr.message); setSaving(false); return }

      const uploads = await uploadAttachments(tid)
      if (uploads.length > 0) {
        const { error: attachErr } = await supabase.from('project_tasks').update({ attachments: uploads }).eq('id', tid)
        if (attachErr) { setError(`Task created, but attachments failed to save: ${attachErr.message}`); setSaving(false); return }
      }

      // Insert assignees junction rows
      if (selectedIds.length > 0) {
        const { error: assignErr } = await supabase.from('project_task_assignees').insert(
          selectedIds.map(uid => ({ project_task_id: tid, user_id: uid }))
        )
        if (assignErr) { setError(`Task created, but assignees failed to save: ${assignErr.message}`); setSaving(false); return }
      }

      // Notify assignees
      for (const uid of selectedIds) {
        if (uid !== user.id) {
          await sendNotification(uid, 'task_assigned', `${user.name} assigned you a task: "${title.trim()}"`)
        }
      }
    }

    setSaving(false)
    onCreated()
    onClose()
  }

  const selectedMembers = pickable.filter(m => selectedIds.includes(m.id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{task ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required
              placeholder="Task title…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
              placeholder="Task details…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
          </div>

          {/* Assignees multi-select */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
            <button type="button" onClick={() => setShowUserDrop(p => !p)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-violet-500">
              {selectedMembers.length === 0 ? (
                <span className="text-gray-400">Select assignees…</span>
              ) : (
                <>
                  {selectedMembers.slice(0, 4).map(m => (
                    <span key={m.id} className="w-6 h-6 rounded-full bg-violet-200 text-violet-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {m.name.slice(0, 2).toUpperCase()}
                    </span>
                  ))}
                  <span className="text-gray-700 text-xs">{selectedMembers.length} selected</span>
                </>
              )}
              <span className="ml-auto text-gray-400 text-xs">▼</span>
            </button>
            {showUserDrop && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {pickable.map(m => (
                  <label key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={selectedIds.includes(m.id)}
                      onChange={() => toggleUser(m.id)}
                      className="accent-violet-600" />
                    <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {m.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{m.name}</p>
                      <p className="text-xs text-gray-400">{m.role}</p>
                    </div>
                  </label>
                ))}
                {canAddFromWorkspace && (
                  <div className="border-t border-gray-100 p-2">
                    <input
                      value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Add someone else from your workspace…"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                    {candidates.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {candidates.map(c => (
                          <button key={c.id} type="button" onClick={() => pickCandidate(c)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-violet-50 text-left">
                            <span className="text-xs text-gray-700">{c.name} <span className="text-gray-400">({c.role})</span></span>
                            <span className="text-[10px] font-semibold text-violet-600">+ Add</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recurring</label>
              <select value={recurring ?? ''} onChange={e => setRecurring((e.target.value || null) as ProjectTask['recurring'])}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="">None</option>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
              </select>
            </div>
          </div>

          {/* File attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Attachments</label>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 text-sm text-violet-600 border border-dashed border-violet-300 rounded-lg px-3 py-2 hover:bg-violet-50 w-full justify-center">
              📎 Add files or images
            </button>
            <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              className="hidden" onChange={e => addFiles(e.target.files)} />
            {(attachments.length > 0 || (task?.attachments ?? []).length > 0) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {task?.attachments?.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200">
                    📄 {a.name}
                  </a>
                ))}
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-violet-50 rounded-lg px-2.5 py-1 text-xs text-violet-700">
                    {a.preview ? <img src={a.preview} className="w-5 h-5 rounded object-cover" alt="" /> : '📄'}
                    {a.file.name}
                    <button type="button" onClick={() => setAttachments(p => p.filter((_, j) => j !== i))}
                      className="text-violet-400 hover:text-violet-700 ml-1">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || !title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Saving…' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
