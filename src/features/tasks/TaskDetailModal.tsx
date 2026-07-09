import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Task, TaskComment, User } from '@/types'
import { STATUS_COLOR, STATUS_LABEL, getAlertLevel, fmtDue } from './taskUtils'
import { CreateTaskModal } from './CreateTaskModal'

interface Props {
  task: Task
  members: User[]
  assigneeIds: string[]
  onClose: () => void
  onChanged: () => void
}

function fmtTs(ts: string) {
  return new Date(ts).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
}

function FileChip({ url, name }: { url: string; name: string }) {
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name) || url.includes('image')
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-200 max-w-[180px] truncate">
      {isImage ? '🖼' : '📄'} <span className="truncate">{name}</span>
    </a>
  )
}

const NEXT_STATUS: Partial<Record<Task['status'], Task['status']>> = {
  pending: 'in_progress',
  in_progress: 'completed',
}

export function TaskDetailModal({ task: initialTask, members, assigneeIds, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [task, setTask] = useState(initialTask)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const [posting, setPosting] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const assignees = members.filter(m => assigneeIds.includes(m.id))
  const creator = members.find(m => m.id === task.creator_id)
  const alert = getAlertLevel(task)
  const canManage = user?.role === 'Admin' || user?.role === 'Manager' || user?.role === 'Super-Admin' || task.creator_id === user?.id
  const canComment = canManage || assigneeIds.includes(user?.id ?? '')

  useEffect(() => {
    void supabase.from('task_comments').select('*').eq('task_id', task.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setComments((data ?? []) as TaskComment[]))

    const ch = supabase.channel('task-detail-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_comments',
        filter: `task_id=eq.${task.id}` }, payload => {
        setComments(p => [...p, payload.new as TaskComment])
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [task.id])

  async function updateStatus(status: Task['status']) {
    setStatusUpdating(true)
    await supabase.from('tasks').update({ status }).eq('id', task.id)
    setTask(t => ({ ...t, status }))
    setStatusUpdating(false)
    onChanged()

    // Notifications
    const notifTargets = [...new Set([
      ...assigneeIds.filter(id => id !== user?.id),
      ...(status === 'completed' || status === 'closed' ? [task.creator_id].filter(id => id !== user?.id) : []),
    ])]
    const type = status === 'completed' ? 'task_completed' : status === 'closed' ? 'task_closed' : 'task_assigned'
    for (const uid of notifTargets) {
      await supabase.from('notifications').insert({
        user_id: uid, type, read: false,
        message: `Task "${task.title}" was marked ${STATUS_LABEL[status]} by ${user?.name}`,
      })
    }
  }

  async function postComment() {
    if (!commentBody.trim() && commentFiles.length === 0) return
    if (!user) return
    setPosting(true)

    type AttachObj = { url: string; name: string; size: number; type: string }
    const attachments: AttachObj[] = []
    for (const f of commentFiles) {
      const path = `${task.id}/${Date.now()}-${f.name}`
      const { error } = await supabase.storage.from('task-attachments').upload(path, f, { contentType: f.type })
      if (!error) {
        const { data } = await supabase.storage.from('task-attachments').createSignedUrl(path, 60 * 60 * 24 * 30)
        if (data?.signedUrl) attachments.push({ url: data.signedUrl, name: f.name, size: f.size, type: f.type })
      }
    }

    await supabase.from('task_comments').insert({
      task_id: task.id, user_id: user.id,
      body: commentBody.trim(), attachments,
    })

    // Notify task participants (except commenter)
    const notifTargets = [...new Set([task.creator_id, ...assigneeIds])].filter(id => id !== user.id)
    for (const uid of notifTargets) {
      await supabase.from('notifications').insert({
        user_id: uid, type: 'task_reply', read: false,
        message: `${user.name} replied to task "${task.title}"`,
      })
    }

    setCommentBody('')
    setCommentFiles([])
    setPosting(false)
  }

  async function deleteTask() {
    if (!window.confirm('Delete this task? This cannot be undone.')) return
    setDeleting(true)
    await supabase.from('tasks').delete().eq('id', task.id)
    onChanged()
    onClose()
  }

  if (showEdit) {
    return <CreateTaskModal task={task} assigneeIds={assigneeIds} onClose={() => setShowEdit(false)}
      onSaved={() => { setShowEdit(false); onChanged(); onClose() }} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[task.status]}`}>
                {STATUS_LABEL[task.status]}
              </span>
              {alert === 'overdue' && <span className="text-xs font-medium text-red-600 flex items-center gap-1">🔴 {fmtDue(task.due_date)}</span>}
              {alert === 'soon' && <span className="text-xs font-medium text-amber-600 flex items-center gap-1">⚠️ {fmtDue(task.due_date)}</span>}
              {!alert && task.due_date && <span className="text-xs text-gray-400">{fmtDue(task.due_date)}</span>}
              {task.recurring && <span className="text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">🔁 {task.recurring}</span>}
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{task.title}</h2>
            {task.description && <p className="text-sm text-gray-500 mt-1">{task.description}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canManage && (
              <>
                <button onClick={() => setShowEdit(true)}
                  className="text-xs text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-2.5 py-1">Edit</button>
                <button onClick={deleteTask} disabled={deleting}
                  className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2.5 py-1">
                  {deleting ? '…' : 'Delete'}
                </button>
              </>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-1">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Meta row */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-5 flex-wrap text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Created by</p>
              <p className="font-medium text-gray-700">{creator?.name ?? '—'}</p>
            </div>
            {assignees.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Assignees</p>
                <div className="flex items-center gap-1">
                  {assignees.map(a => (
                    <div key={a.id} title={a.name}
                      className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
                      {a.name.slice(0, 2).toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Status progression buttons */}
            <div className="ml-auto flex items-center gap-1.5">
              {NEXT_STATUS[task.status] && (
                <button onClick={() => void updateStatus(NEXT_STATUS[task.status]!)}
                  disabled={statusUpdating}
                  className="text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-50">
                  → {STATUS_LABEL[NEXT_STATUS[task.status]!]}
                </button>
              )}
              {task.status !== 'closed' && task.status !== 'archived' && (
                <button onClick={() => void updateStatus('closed')}
                  disabled={statusUpdating}
                  className="text-xs font-medium bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-300 disabled:opacity-50">
                  Close
                </button>
              )}
              {task.status !== 'archived' && (
                <button onClick={() => void updateStatus('archived')}
                  disabled={statusUpdating}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg">
                  Archive
                </button>
              )}
            </div>
          </div>

          {/* Task attachments */}
          {task.attachments?.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Attachments</p>
              <div className="flex flex-wrap gap-2">
                {task.attachments.map((a, i) => <FileChip key={i} url={a.url} name={a.name} />)}
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="px-5 py-4 space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Comments · {comments.length}
            </p>
            {comments.length === 0 && (
              <p className="text-sm text-gray-300 text-center py-4">No comments yet</p>
            )}
            {comments.map(c => {
              const author = members.find(m => m.id === c.user_id)
              const atts = Array.isArray(c.attachments) ? (c.attachments as Array<{ url: string; name: string }>) : []
              return (
                <div key={c.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {(author?.name ?? '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-800">{author?.name ?? 'Unknown'}</span>
                      <span className="text-xs text-gray-400">{fmtTs(c.created_at)}</span>
                    </div>
                    {c.body && <p className="text-sm text-gray-700 leading-relaxed">{c.body}</p>}
                    {atts.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {atts.map((a, i) => <FileChip key={i} url={a.url} name={a.name} />)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Comment input */}
        {canComment && (
          <div className="p-4 border-t border-gray-100">
            <div className="flex gap-2">
              <div className="w-8 h-8 rounded-full bg-violet-200 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                {user?.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <textarea
                  value={commentBody}
                  onChange={e => setCommentBody(e.target.value)}
                  placeholder="Write a comment…"
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void postComment() }}
                />
                {commentFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {commentFiles.map((f, i) => (
                      <span key={i} className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded flex items-center gap-1">
                        📎 {f.name}
                        <button type="button" onClick={() => setCommentFiles(p => p.filter((_, j) => j !== i))} className="text-violet-400">✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="text-xs text-gray-400 hover:text-gray-600">📎 Attach</button>
                  <input ref={fileRef} type="file" multiple className="hidden"
                    onChange={e => setCommentFiles(p => [...p, ...Array.from(e.target.files ?? [])])} />
                  <button type="button" onClick={postComment} disabled={posting || (!commentBody.trim() && commentFiles.length === 0)}
                    className="ml-auto text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-40">
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
