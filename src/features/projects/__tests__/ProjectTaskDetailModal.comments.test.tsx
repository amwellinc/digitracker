import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectTask, User } from '@/types'

// Regression coverage: project_task_comments' own RLS policy (and
// is_project_member(), which gates every project table identically) lets
// ANY project member read and post comments on ANY task in that project --
// and ProjectGuard only lets a project member reach this modal at all. The
// frontend's own canComment gate used to be narrower than that (manager,
// assignee, or associate only), silently hiding the comment box from a
// plain member who wasn't personally assigned to this specific task. Found
// live: an ordinary Staff user added to PROJECT-AMUSA could see a task but
// not comment on it.

let currentUser: Partial<User> = { id: 'staff1', name: 'Plain Staff', role: 'Staff' }
let assigneeRows: Array<{ user_id: string }> = []
const commentInsert = vi.fn().mockResolvedValue({ error: null })

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
        if (table === 'project_task_comments') return { ...chain({ data: [] }), insert: commentInsert }
        if (table === 'notifications') return { insert: vi.fn().mockResolvedValue({ error: null }) }
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
  { id: 'staff1', name: 'Plain Staff', role: 'Staff' },
] as User[]

function renderModal() {
  return render(<ProjectTaskDetailModal projectId="p1" task={task} members={members} onClose={vi.fn()} onUpdated={vi.fn()} />)
}

describe('ProjectTaskDetailModal — comments', () => {
  beforeEach(() => {
    currentUser = { id: 'staff1', name: 'Plain Staff', role: 'Staff' }
    assigneeRows = []
    commentInsert.mockClear()
  })

  it('shows the comment box to a plain project member who neither created nor was assigned to the task', async () => {
    renderModal()
    expect(await screen.findByPlaceholderText(/write a comment/i)).toBeInTheDocument()
  })

  it('lets that plain member actually post a comment', async () => {
    renderModal()
    const box = await screen.findByPlaceholderText(/write a comment/i)
    await userEvent.type(box, 'Looks good to me')
    await userEvent.click(screen.getByRole('button', { name: /post/i }))
    await waitFor(() => expect(commentInsert).toHaveBeenCalledWith(
      expect.objectContaining({ project_task_id: 't1', user_id: 'staff1', body: 'Looks good to me' })
    ))
  })
})
