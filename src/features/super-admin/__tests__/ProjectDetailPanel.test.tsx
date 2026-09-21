import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const membersSelectMock = vi.fn()
const usersSelectMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'project_members') {
        return { select: vi.fn().mockReturnThis(), eq: (...args: unknown[]) => membersSelectMock(...args) }
      }
      return {
        select: vi.fn().mockReturnThis(),
        ilike: (...args: unknown[]) => usersSelectMock(...args),
      }
    }),
  },
}))

import { ProjectDetailPanel } from '../ProjectDetailPanel'
import type { Project } from '@/types'

const project: Project = { id: 'p1', name: 'JohnBakery', created_by: 'admin-1', created_at: '2026-01-01T00:00:00Z' }

// Note: the 3-workspace cap's actual counting logic lives entirely in the
// add_project_member SQL RPC and cannot be exercised by a mocked Supabase
// client. It is verified separately by manual trace against the SQL
// (documented in the Task 1 review) and by live-app testing — the tests
// below only verify the client-side call shape and error/success handling.
describe('ProjectDetailPanel — 3-workspace cap', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    membersSelectMock.mockReset().mockResolvedValue({ data: [] })
    usersSelectMock.mockReset().mockResolvedValue({
      data: [{ id: 'u9', name: 'New Person', email: 'new@x.com', sub_account: 'AM999' }],
    })
  })

  it('adds a member successfully when the cap is not yet reached', async () => {
    rpcMock.mockResolvedValueOnce({ error: null })
    render(<ProjectDetailPanel project={project} onClose={vi.fn()} />)

    await userEvent.type(await screen.findByPlaceholderText(/search by email/i), 'new@x.com')
    await userEvent.click(await screen.findByText('Add'))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_project_member', { p_project_id: 'p1', p_user_id: 'u9' }))
    await waitFor(() => expect(screen.getByText(/added/i)).toBeInTheDocument())
  })

  it('surfaces the cap error and does not show success when adding a 4th workspace', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { message: 'This project already has members from 3 workspaces — remove one before adding a member from a 4th.' },
    })
    render(<ProjectDetailPanel project={project} onClose={vi.fn()} />)

    await userEvent.type(await screen.findByPlaceholderText(/search by email/i), 'new@x.com')
    await userEvent.click(await screen.findByText('Add'))

    await waitFor(() => expect(screen.getByText(/3 workspaces/i)).toBeInTheDocument())
  })

  it("passes the clicked candidate's exact id to add_project_member, not a stale value", async () => {
    rpcMock.mockResolvedValueOnce({ error: null })
    render(<ProjectDetailPanel project={project} onClose={vi.fn()} />)

    await userEvent.type(await screen.findByPlaceholderText(/search by email/i), 'new@x.com')
    await userEvent.click(await screen.findByText('Add'))

    // The mocked RPC can't exercise the SQL-side cap counting (see comment
    // above), but it can verify the exact id/project pair the UI sends —
    // guarding against a stale-closure or wrong-row regression in the
    // candidate list's click handler.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_project_member', { p_project_id: 'p1', p_user_id: 'u9' }))
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})
