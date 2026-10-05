import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectTask, User } from '@/types'

let currentUser: Partial<User> = { id: 'a1', name: 'Guest', role: 'Associate' }
let assigneeRows: Array<{ user_id: string }> = []
const notificationsInsert = vi.fn().mockResolvedValue({ error: null })
const tasksUpdate = vi.fn()

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock('@/lib/supabase', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'order']) c[k] = () => c
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
    return c
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'project_task_assignees') return chain({ data: assigneeRows })
        if (table === 'project_task_comments') return { ...chain({ data: [] }), insert: vi.fn().mockResolvedValue({ error: null }) }
        if (table === 'notifications') return { insert: notificationsInsert }
        if (table === 'project_tasks') return { update: (v: unknown) => { tasksUpdate(v); return { eq: () => Promise.resolve({ error: null }) } } }
        return chain({ data: [] })
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: vi.fn(),
      storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
    },
  }
})

import { ProjectTaskDetailModal } from '../ProjectTaskDetailModal'

const task = {
  id: 't1', project_id: 'p1', title: 'Design review', description: null, creator_id: 'admin1',
  assignee_id: null, status: 'pending', due_date: null, recurring: null, attachments: [], created_at: '2026-10-01T00:00:00Z',
} as ProjectTask
const members = [
  { id: 'admin1', name: 'Admin', role: 'Admin' },
  { id: 'a1', name: 'Guest', role: 'Associate' },
  { id: 'a2', name: 'Other Guest', role: 'Associate' },
] as User[]

function renderModal() {
  return render(<ProjectTaskDetailModal projectId="p1" task={task} members={members} onClose={vi.fn()} onUpdated={vi.fn()} />)
}

describe('ProjectTaskDetailModal — associates', () => {
  beforeEach(() => {
    currentUser = { id: 'a1', name: 'Guest', role: 'Associate' }
    notificationsInsert.mockClear()
    tasksUpdate.mockClear()
  })

  it('hides Edit/Delete and status buttons on a task not assigned to the associate', async () => {
    assigneeRows = [{ user_id: 'admin1' }]
    renderModal()
    await waitFor(() => expect(screen.queryByText('Edit')).not.toBeInTheDocument())
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
    expect(screen.queryByText('Close')).not.toBeInTheDocument()
  })

  it('lets an assigned associate change status without inserting client-side notifications', async () => {
    assigneeRows = [{ user_id: 'a1' }]
    renderModal()
    await userEvent.click(await screen.findByText(/→/))
    expect(tasksUpdate).toHaveBeenCalledWith({ status: 'in_progress' })
    expect(notificationsInsert).not.toHaveBeenCalled()
  })

  it('a staff/admin status change does not client-notify associate assignees', async () => {
    currentUser = { id: 'admin1', name: 'Admin', role: 'Admin' }
    assigneeRows = [{ user_id: 'a2' }]
    renderModal()
    await userEvent.click(await screen.findByText(/→/))
    await waitFor(() => expect(tasksUpdate).toHaveBeenCalled())
    const targets = notificationsInsert.mock.calls.map(c => (c[0] as { user_id: string }).user_id)
    expect(targets).not.toContain('a2')
  })
})
