import { describe, it, expect } from 'vitest'
import { notifIcon } from '../notifIcon'

describe('notifIcon', () => {
  it.each([
    ['project_added', '🗂'], ['project_task_assigned', '✅'], ['project_task_comment', '💬'],
    ['project_task_created', '🆕'], ['project_task_status', '🔄'], ['task_reply', '💬'], ['unknown', '🔔'],
  ])('%s → %s', (type, icon) => expect(notifIcon(type)).toBe(icon))
})
