import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useRealtime } from '@/hooks/useRealtime'
import type { ProjectTask, ProjectTaskAssignee, User } from '@/types'
import {
  getAlertLevel, fmtDue, STATUS_COLOR, STATUS_LABEL,
  type TaskFilter,
} from '../tasks/taskUtils'
import { CreateProjectTaskModal } from './CreateProjectTaskModal'
import { ProjectTaskDetailModal } from './ProjectTaskDetailModal'
import { presenceFromStatus } from './projectPresence'

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
  task: ProjectTask
  assigneeIds: string[]
  commentCount: number
}

// Raw shape of get_project_member_status RPC rows — kept separate from the
// User[]-shaped `members` list because the presence header needs
// status/last_activity_at, which the assignee picker doesn't.
interface ProjectMemberStatusRow {
  user_id: string
  name: string
  profile_image: string | null
  status: 'working' | 'lunch' | null
  last_activity_at: string | null
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

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const canManage = user?.role === 'Admin' || user?.role === 'Manager' || user?.role === 'Super-Admin'

  const [members, setMembers] = useState<User[]>([])
  const [memberStatus, setMemberStatus] = useState<ProjectMemberStatusRow[]>([])
  const [rows, setRows] = useState<TaskRow[]>([])
  const [filter, setFilter] = useState<TaskFilter>('mine')
  const [byUserId, setByUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [detailRow, setDetailRow] = useState<TaskRow | null>(null)
  const [tick, setTick] = useState(0)

  const loadMemberStatus = useCallback(async () => {
    if (!projectId) return
    const { data } = await supabase.rpc('get_project_member_status', { p_project_id: projectId })
    const memberRows = (data ?? []) as ProjectMemberStatusRow[]
    setMemberStatus(memberRows)

    // get_project_member_status only returns {user_id, name, profile_image,
    // status, last_activity_at} — project members are shown by name/avatar
    // only (presence-only cross-tenant exposure), so the remaining User
    // fields are filled with inert placeholders rather than real data the
    // RPC doesn't (and shouldn't) expose.
    const m: User[] = memberRows.map(r => ({
      id: r.user_id,
      name: r.name,
      profile_image: r.profile_image,
      email: '',
      role: 'Staff',
      sub_account: '',
      manager_id: null,
      annual_leave: 0,
      time_off: 0,
      reporting_time_in: '',
      reporting_time_out: '',
      country: 'SG',
      phone: null,
      status: 'active',
      created_at: '',
      appointed_as: null,
      address_line1: null,
      address_line2: null,
      address_city: null,
      address_pin_code: null,
      last_ip_address: null,
      last_ip_captured_at: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      department_id: null,
    }))
    setMembers(m)
  }, [projectId])

  useEffect(() => { void loadMemberStatus() }, [loadMemberStatus])

  useEffect(() => {
    if (!byUserId && members.length > 0 && user) setByUserId(user.id)
  }, [members, byUserId, user])

  // Presence dots refresh on the same realtime cadence TeamAvatarRow.tsx uses.
  useRealtime({ table: 'time_logs', onInsert: loadMemberStatus, onUpdate: loadMemberStatus })

  const loadTasks = useCallback(async () => {
    if (!user || !projectId) return
    setLoading(true)

    const { data: tasksData } = await supabase.from('project_tasks').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
    const tasks = (tasksData ?? []) as ProjectTask[]

    const { data: assigneesData } = await supabase.from('project_task_assignees').select('*')
    const allAssignees = (assigneesData ?? []) as ProjectTaskAssignee[]

    // Count comments per task
    const { data: commentsData } = await supabase.from('project_task_comments').select('project_task_id')
    const commentCounts: Record<string, number> = {}
    ;(commentsData ?? []).forEach((c: { project_task_id: string }) => {
      commentCounts[c.project_task_id] = (commentCounts[c.project_task_id] ?? 0) + 1
    })

    const taskRows: TaskRow[] = tasks.map(t => ({
      task: t,
      assigneeIds: allAssignees.filter(a => a.project_task_id === t.id).map(a => a.user_id),
      commentCount: commentCounts[t.id] ?? 0,
    }))

    setRows(taskRows)
    setLoading(false)
  }, [user, projectId])

  useEffect(() => { void loadTasks() }, [loadTasks, tick])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('project-page-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tasks' }, () => setTick(t => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_task_assignees' }, () => setTick(t => t + 1))
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage your tasks and team assignments</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-violet-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-violet-700 transition-colors flex items-center gap-1.5 self-start sm:self-auto"
            style={{ minHeight: '44px' }}
          >
            + New Task
          </button>
        )}
      </div>

      {/* Presence header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-4 flex-wrap">
        {memberStatus.map(m => (
          <div key={m.user_id} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              presenceFromStatus(m.status, m.last_activity_at) === 'online' ? 'bg-green-500'
                : presenceFromStatus(m.status, m.last_activity_at) === 'idle' ? 'bg-amber-500'
                : 'bg-gray-300'
            }`} />
            <span className="text-sm text-gray-700">{m.name}</span>
          </div>
        ))}
      </div>

      {/* Filter strip + user selector */}
      <div className="space-y-2">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {FILTERS.map(f => {
            const count = filterCount(f.id)
            return (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 flex-shrink-0 whitespace-nowrap ${
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
          <div className="flex items-center gap-2">
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
             filter === 'mine' && canManage ? 'You have no tasks assigned or created.' :
             filter === 'mine' ? 'You have no tasks assigned yet — check back once your Admin or Manager assigns one.' :
             'Nothing in this category yet.'}
          </p>
          {canManage && (
            <button onClick={() => setShowCreate(true)}
              className="mt-4 text-sm text-violet-600 hover:underline">Create your first task →</button>
          )}
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
        <CreateProjectTaskModal
          projectId={projectId!}
          members={members}
          onClose={() => setShowCreate(false)}
          onCreated={() => setTick(t => t + 1)}
        />
      )}
      {detailRow && (
        <ProjectTaskDetailModal
          projectId={projectId!}
          task={detailRow.task}
          members={members}
          onClose={() => setDetailRow(null)}
          onUpdated={() => setTick(t => t + 1)}
        />
      )}
    </div>
  )
}
