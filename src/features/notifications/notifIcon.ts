export function notifIcon(type: string): string {
  switch (type) {
    case 'task_assigned':         return '✅'
    case 'task_reply':            return '💬'
    case 'task_completed':        return '🏁'
    case 'task_closed':           return '🔒'
    case 'leave_request':         return '📋'
    case 'leave_approved':        return '✅'
    case 'leave_rejected':        return '❌'
    case 'holiday_added':         return '🗓'
    case 'new_subscription':      return '💳'
    case 'project_added':         return '🗂'
    case 'project_task_assigned': return '✅'
    case 'project_task_comment':  return '💬'
    case 'project_task_created':  return '🆕'
    case 'project_task_status':   return '🔄'
    default:                      return '🔔'
  }
}
