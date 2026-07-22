import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Task, User } from '@/types'

interface Props {
  task?: Task
  assigneeIds?: string[]
  onClose: () => void
  onSaved: () => void
}

interface Attachment { file: File; preview: string }

export function CreateTaskModal({ task, assigneeIds: initAssignees = [], onClose, onSaved }: Props) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [members, setMembers] = useState<User[]>([])
  const [title, setTitle] = useState(task?.title ?? '')
  const [desc, setDesc] = useState(task?.description ?? '')
  const [dueDate, setDueDate] = useState(task?.due_date ? task.due_date.slice(0, 16) : '')
  const [recurring, setRecurring] = useState<Task['recurring']>(task?.recurring ?? null)
  const [selectedIds, setSelectedIds] = useState<string[]>(initAssignees)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUserDrop, setShowUserDrop] = useState(false)

  useEffect(() => {
    if (!user) return
    const q = user.role === 'Manager'
      ? supabase.rpc('get_manager_downline')
      : supabase.from('users').select('*').eq('sub_account', user.sub_account).order('name')
    void q.then(({ data }) => {
      const scoped = ((data ?? []) as User[]).filter(u => u.status === 'active')
      // Include self (Manager's own downline RPC excludes them) so you can
      // assign a task to yourself.
      const withSelf = scoped.some(u => u.id === user.id) ? scoped : [user, ...scoped]
      setMembers(withSelf)
    })
  }, [user])

  function toggleUser(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
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
    const uploaded: Task['attachments'] = [...(task?.attachments ?? [])]
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
      const { error: updErr } = await supabase.from('tasks')
        .update({ ...payload, attachments: uploads }).eq('id', task.id)
      if (updErr) { setError(updErr.message); setSaving(false); return }

      // Sync assignees: delete all then re-insert
      await supabase.from('task_assignees').delete().eq('task_id', task.id)
      if (selectedIds.length > 0) {
        await supabase.from('task_assignees').insert(
          selectedIds.map(uid => ({ task_id: task.id, user_id: uid }))
        )
      }
    } else {
      // Create new
      const { data: newTask, error: insErr } = await supabase.from('tasks')
        .insert({ ...payload, attachments: [] }).select().single()
      if (insErr || !newTask) { setError(insErr?.message ?? 'Failed'); setSaving(false); return }

      const tid = (newTask as Task).id
      const uploads = await uploadAttachments(tid)
      if (uploads.length > 0) {
        await supabase.from('tasks').update({ attachments: uploads }).eq('id', tid)
      }

      // Insert assignees junction rows
      if (selectedIds.length > 0) {
        await supabase.from('task_assignees').insert(
          selectedIds.map(uid => ({ task_id: tid, user_id: uid }))
        )
      }

      // Notify assignees
      for (const uid of selectedIds) {
        if (uid !== user.id) {
          await sendNotification(uid, 'task_assigned', `${user.name} assigned you a task: "${title.trim()}"`)
        }
      }
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  const selectedMembers = members.filter(m => selectedIds.includes(m.id))

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
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {members.map(m => (
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
              <select value={recurring ?? ''} onChange={e => setRecurring((e.target.value || null) as Task['recurring'])}
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
