import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Task, TaskAssignee, User } from '@/types'
import {
  getAlertLevel, fmtDue, STATUS_COLOR, STATUS_LABEL,
  type TaskFilter,
} from './taskUtils'
import { CreateTaskModal } from './CreateTaskModal'
import { TaskDetailModal } from './TaskDetailModal'

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'all',      label: 'All Tasks' },
  { id: 'mine',     label: 'My Tasks' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'pending',  label: 'Pending' },
  { id: 'overdue',  label: 'Overdue' },
  { id: 'closed',   label: 'Closed' },
  { id: 'archived', label: 'Archived' },
]

interface TaskRow {
  task: Task
  assigneeIds: string[]
  commentCount: number
}

function AlertIcon({ level }: { level: ReturnType<typeof getAlertLevel> }) {
  if (level === 'overdue') return <span title="Overdue" className="text-red-500 text-base">🔴</span>
  if (level === 'soon') return <span title="Due within 7 days" className="text-amber-500 text-base">⚠️</span>
  return null
}

function TaskCard({ row, members, onOpen }: { row: TaskRow; members: User[]; onOpen: () => void }) {
  const { task, assigneeIds, commentCount } = row
  const alert = getAlertLevel(task)
  const assignees = members.filter(m => assigneeIds.includes(m.id))

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[task.status]}`}>
              {STATUS_LABEL[task.status]}
            </span>
            {task.recurring && (
              <span className="text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">🔁 {task.recurring}</span>
            )}
          </div>
          <p className="font-medium text-gray-900 leading-snug truncate">{task.title}</p>
          {task.description && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{task.description}</p>
          )}
        </div>
        <AlertIcon level={alert} />
      </div>

      <div className="flex items-center gap-3 mt-3">
        {/* Assignee avatars */}
        {assignees.length > 0 && (
          <div className="flex -space-x-1.5">
            {assignees.slice(0, 4).map(a => (
              <div key={a.id} title={a.name}
                className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center ring-1 ring-white">
                {a.name.slice(0, 2).toUpperCase()}
              </div>
            ))}
            {assignees.length > 4 && (
              <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center ring-1 ring-white">
                +{assignees.length - 4}
              </div>
            )}
          </div>
        )}

        {/* Due date */}
        {task.due_date && (
          <span className={`text-xs ${alert === 'overdue' ? 'text-red-500 font-medium' : alert === 'soon' ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
            📅 {fmtDue(task.due_date)}
          </span>
        )}

        {/* Comment count */}
        {commentCount > 0 && (
          <span className="text-xs text-gray-400 ml-auto">💬 {commentCount}</span>
        )}

        {/* Attachment count */}
        {task.attachments?.length > 0 && (
          <span className="text-xs text-gray-400">📎 {task.attachments.length}</span>
        )}
      </div>
    </button>
  )
}

export function TasksPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'Admin' || user?.role === 'Manager' || user?.role === 'Super-Admin'

  const [members, setMembers] = useState<User[]>([])
  const [rows, setRows] = useState<TaskRow[]>([])
  const [filter, setFilter] = useState<TaskFilter>('mine')
  const [byUserId, setByUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [detailRow, setDetailRow] = useState<TaskRow | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!user) return
    void supabase.from('users').select('*').eq('sub_account', user.sub_account).order('name')
      .then(({ data }) => {
        const m = (data ?? []) as User[]
        setMembers(m)
        if (!byUserId && m.length > 0) setByUserId(user.id)
      })
  }, [user, byUserId])

  const loadTasks = useCallback(async () => {
    if (!user) return
    setLoading(true)

    const { data: tasksData } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    const tasks = (tasksData ?? []) as Task[]

    const { data: assigneesData } = await supabase.from('task_assignees').select('*')
    const allAssignees = (assigneesData ?? []) as TaskAssignee[]

    // Count comments per task
    const { data: commentsData } = await supabase.from('task_comments').select('task_id')
    const commentCounts: Record<string, number> = {}
    ;(commentsData ?? []).forEach((c: { task_id: string }) => {
      commentCounts[c.task_id] = (commentCounts[c.task_id] ?? 0) + 1
    })

    const taskRows: TaskRow[] = tasks.map(t => ({
      task: t,
      assigneeIds: allAssignees.filter(a => a.task_id === t.id).map(a => a.user_id),
      commentCount: commentCounts[t.id] ?? 0,
    }))

    setRows(taskRows)
    setLoading(false)
  }, [user])

  useEffect(() => { void loadTasks() }, [loadTasks, tick])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('tasks-page-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => setTick(t => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, () => setTick(t => t + 1))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [])

  function applyFilter(allRows: TaskRow[]): TaskRow[] {
    const uid = user?.id ?? ''
    const now = Date.now()

    switch (filter) {
      case 'mine':
        return allRows.filter(r => r.task.creator_id === uid || r.assigneeIds.includes(uid) || r.task.assignee_id === uid)
      case 'assigned':
        return allRows.filter(r => r.task.creator_id === uid)
      case 'by_user':
        return allRows.filter(r => r.task.creator_id === byUserId || r.assigneeIds.includes(byUserId) || r.task.assignee_id === byUserId)
      case 'pending':
        return allRows.filter(r => r.task.status === 'pending')
      case 'overdue':
        return allRows.filter(r =>
          r.task.due_date && new Date(r.task.due_date).getTime() < now &&
          !['completed', 'closed', 'archived'].includes(r.task.status)
        )
      case 'closed':
        return allRows.filter(r => r.task.status === 'closed')
      case 'archived':
        return allRows.filter(r => r.task.status === 'archived')
      default:
        return allRows
    }
  }

  const visible = applyFilter(rows)
  const overdueCount = rows.filter(r =>
    r.task.due_date && new Date(r.task.due_date).getTime() < Date.now() &&
    !['completed', 'closed', 'archived'].includes(r.task.status) &&
    (r.task.creator_id === user?.id || r.assigneeIds.includes(user?.id ?? '') || canManage)
  ).length

  function filterCount(f: TaskFilter): number {
    const prevFilter = filter
    const tempRows = (() => {
      const uid = user?.id ?? ''
      const now = Date.now()
      switch (f) {
        case 'mine': return rows.filter(r => r.task.creator_id === uid || r.assigneeIds.includes(uid) || r.task.assignee_id === uid)
        case 'assigned': return rows.filter(r => r.task.creator_id === uid)
        case 'by_user': return rows.filter(r => r.task.creator_id === byUserId || r.assigneeIds.includes(byUserId) || r.task.assignee_id === byUserId)
        case 'pending': return rows.filter(r => r.task.status === 'pending')
        case 'overdue': return rows.filter(r => r.task.due_date && new Date(r.task.due_date).getTime() < now && !['completed', 'closed', 'archived'].includes(r.task.status))
        case 'closed': return rows.filter(r => r.task.status === 'closed')
        case 'archived': return rows.filter(r => r.task.status === 'archived')
        default: return rows
      }
    })()
    void prevFilter
    return tempRows.length
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage your tasks and team assignments</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-violet-600 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-violet-700 transition-colors flex items-center gap-1.5"
        >
          + New Task
        </button>
      </div>

      {/* Filter strip + user selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(f => {
            const count = filterCount(f.id)
            return (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                  filter === f.id ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {f.id === 'overdue' && overdueCount > 0 && (
                  <span className={`inline-flex w-4 h-4 rounded-full text-[10px] items-center justify-center font-bold ${
                    filter === f.id ? 'bg-white text-violet-600' : 'bg-red-500 text-white'
                  }`}>{overdueCount}</span>
                )}
                {f.label}
                {count > 0 && f.id !== 'overdue' && (
                  <span className={`text-[10px] font-bold ml-0.5 ${filter === f.id ? 'opacity-75' : 'text-gray-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* By-User selector: admin/manager only */}
        {canManage && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setFilter('by_user')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === 'by_user' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              By User
            </button>
            <select
              value={byUserId}
              onChange={e => { setByUserId(e.target.value); setFilter('by_user') }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.id === user?.id ? ' (You)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
          <span className="text-5xl mb-3">✅</span>
          <p className="text-base font-medium">No tasks found</p>
          <p className="text-sm mt-1">
            {filter === 'overdue' ? 'Great — nothing overdue!' :
             filter === 'mine' ? 'You have no tasks assigned or created.' :
             'Nothing in this category yet.'}
          </p>
          <button onClick={() => setShowCreate(true)}
            className="mt-4 text-sm text-violet-600 hover:underline">Create your first task →</button>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(row => (
            <TaskCard
              key={row.task.id}
              row={row}
              members={members}
              onOpen={() => setDetailRow(row)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onSaved={() => setTick(t => t + 1)}
        />
      )}
      {detailRow && (
        <TaskDetailModal
          task={detailRow.task}
          members={members}
          assigneeIds={detailRow.assigneeIds}
          onClose={() => setDetailRow(null)}
          onChanged={() => setTick(t => t + 1)}
        />
      )}
    </div>
  )
}
