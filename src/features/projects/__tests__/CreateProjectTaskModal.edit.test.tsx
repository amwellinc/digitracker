import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectTask, User } from '@/types'

const currentUser: Partial<User> = { id: 'admin1', name: 'Admin', role: 'Admin', sub_account: 'ACME' }
const assigneesInsert = vi.fn()
const assigneesDelete = vi.fn()
const assigneesDeleteFilters: Array<[string, unknown]> = []
const tasksUpdate = vi.fn()

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock('@/lib/supabase', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'ilike', 'order']) c[k] = () => c
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
    return c
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'project_task_assignees') return {
          insert: (rows: unknown) => { assigneesInsert(rows); return Promise.resolve({ error: null }) },
          delete: () => {
            assigneesDelete()
            const c: Record<string, unknown> = {}
            for (const k of ['eq', 'in']) c[k] = (col: string, v: unknown) => { assigneesDeleteFilters.push([k + ':' + col, v]); return c }
            c.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
            return c
          },
        }
        if (table === 'project_tasks') return { update: (v: unknown) => { tasksUpdate(v); return { eq: () => Promise.resolve({ error: null }) } } }
        if (table === 'notifications') return { insert: vi.fn().mockResolvedValue({ error: null }) }
        return chain({ data: [] })
      },
      rpc: vi.fn().mockResolvedValue({ error: null }),
      storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
    },
  }
})

import { CreateProjectTaskModal } from '../CreateProjectTaskModal'

const task = {
  id: 't1', project_id: 'p1', title: 'Design review', description: null, creator_id: 'admin1',
  assignee_id: 'a1', status: 'pending', due_date: null, recurring: null, attachments: [], created_at: '2026-10-01T00:00:00Z',
} as ProjectTask
const members = [
  { id: 'admin1', name: 'Admin', role: 'Admin' },
  { id: 'a1', name: 'Guest', role: 'Associate' },
  { id: 's1', name: 'Staffer', role: 'Staff' },
] as User[]

function renderEdit(assigneeIds: string[]) {
  return render(<CreateProjectTaskModal projectId="p1" members={members} task={task} assigneeIds={assigneeIds}
    onClose={vi.fn()} onCreated={vi.fn()} />)
}

describe('CreateProjectTaskModal — editing assignees', () => {
  beforeEach(() => {
    assigneesInsert.mockClear()
    assigneesDelete.mockClear()
    assigneesDeleteFilters.length = 0
    tasksUpdate.mockClear()
  })

  it('does not delete or re-insert assignees when they are unchanged', async () => {
    renderEdit(['a1'])
    await userEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(tasksUpdate).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Save Changes')).toBeInTheDocument())
    expect(assigneesDelete).not.toHaveBeenCalled()
    expect(assigneesInsert).not.toHaveBeenCalled()
  })

  it('inserts only the newly added assignee', async () => {
    renderEdit(['a1'])
    await userEvent.click(screen.getByText('1 selected'))
    await userEvent.click(screen.getByText('Staffer'))
    await userEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(assigneesInsert).toHaveBeenCalledTimes(1))
    expect(assigneesInsert).toHaveBeenCalledWith([{ project_task_id: 't1', user_id: 's1' }])
    expect(assigneesDelete).not.toHaveBeenCalled()
  })

  it('deletes only the removed assignee', async () => {
    renderEdit(['a1', 's1'])
    await userEvent.click(screen.getByText('2 selected'))
    await userEvent.click(screen.getByText('Staffer'))
    await userEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(assigneesDelete).toHaveBeenCalledTimes(1))
    expect(assigneesDeleteFilters).toEqual([['eq:project_task_id', 't1'], ['in:user_id', ['s1']]])
    expect(assigneesInsert).not.toHaveBeenCalled()
  })
})
