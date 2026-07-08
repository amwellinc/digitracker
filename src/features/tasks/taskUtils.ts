import type { Task } from '@/types'

export type AlertLevel = 'overdue' | 'soon' | null

export function getAlertLevel(task: Task): AlertLevel {
  if (!task.due_date) return null
  if (['completed', 'closed', 'archived'].includes(task.status)) return null
  const now = Date.now()
  const due = new Date(task.due_date).getTime()
  if (due < now) return 'overdue'
  if (due - now < 7 * 24 * 60 * 60 * 1000) return 'soon'
  return null
}

export function fmtDue(due: string | null): string {
  if (!due) return ''
  const d = new Date(due)
  const now = new Date()
  const diffDays = Math.ceil((d.getTime() - now.getTime()) / 86400000)
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  if (diffDays === 0) return 'Due today'
  if (diffDays === 1) return 'Due tomorrow'
  if (diffDays < 8) return `Due in ${diffDays}d`
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: diffDays > 180 ? 'numeric' : undefined })
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed',
  closed: 'Closed', archived: 'Archived',
}

export const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
  archived: 'bg-gray-50 text-gray-400',
}

export type TaskFilter = 'all' | 'mine' | 'assigned' | 'by_user' | 'pending' | 'overdue' | 'closed' | 'archived'
