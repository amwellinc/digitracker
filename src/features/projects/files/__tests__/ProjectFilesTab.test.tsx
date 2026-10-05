import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectFile, ProjectFolder, User } from '@/types'

const folders: ProjectFolder[] = [
  { id: 'r1', project_id: 'p1', task_id: 't1', parent_id: null, name: 'Setup', is_task_root: true, created_by: null, created_at: '2026-10-01T00:00:00Z' },
  { id: 'f1', project_id: 'p1', task_id: 't1', parent_id: 'r1', name: 'Contracts', is_task_root: false, created_by: 'u1', created_at: '2026-10-01T00:00:00Z' },
]
function file(id: string, name: string, extra: Partial<ProjectFile>): ProjectFile {
  return {
    id, project_id: 'p1', folder_id: null, task_id: null, bucket: 'project-files', storage_path: `p1/${id}/${name}`,
    name, size_bytes: 2048, mime_type: 'application/pdf', uploaded_by: 'u1', source: 'folder',
    created_at: '2026-10-02T00:00:00Z', ...extra,
  }
}
const files: ProjectFile[] = [
  file('a', 'brief.pdf', { uploaded_by: 'u2' }),
  file('b', 'plan.pdf', { task_id: 't1', uploaded_by: 'u2' }),
  file('c', 'mine.pdf', { task_id: 't1', uploaded_by: 'u1' }),
  file('d', 'nda.pdf', { task_id: 't1', folder_id: 'f1' }),
  file('e', 'shot.png', { task_id: 't1', uploaded_by: 'u1', source: 'comment' }),
]

const rpc = vi.fn()
const signMock = vi.fn()
const inserts: Array<{ table: string; row: unknown }> = []
let folderDeleteResult: { error: { code: string; message: string } | null } = { error: null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => signMock(...a), upload: vi.fn(), remove: vi.fn() }) },
    from: (table: string) => ({
      select: () => ({ eq: () => Promise.resolve({ data: table === 'project_folders' ? folders : files, error: null }) }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new1', is_task_root: false, created_at: 'now', ...row }, error: null }) }) }
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve(table === 'project_folders' ? folderDeleteResult : { error: null }) }),
    }),
  },
}))

let authUser = { id: 'u1', role: 'Associate' }
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authUser }) }))

import { ProjectFilesTab } from '../ProjectFilesTab'

const members = [{ id: 'u1', name: 'Ana', role: 'Associate' }, { id: 'u2', name: 'Ben', role: 'Manager' }] as unknown as User[]

function renderTab(query = 'tab=files') {
  return render(
    <MemoryRouter initialEntries={[`/projects/p1?${query}`]}>
      <Link to="/projects/p1?tab=files&folder=common">outside link to Common</Link>
      <ProjectFilesTab projectId="p1" tasks={[{ id: 't1', title: 'Setup' }]} members={members} />
    </MemoryRouter>,
  )
}

describe('ProjectFilesTab', () => {
  beforeEach(() => {
    rpc.mockReset()
    signMock.mockReset()
    inserts.length = 0
    folderDeleteResult = { error: null }
    authUser = { id: 'u1', role: 'Associate' }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('shows Common, task and sub-folder nodes, and Common lists every file', async () => {
    renderTab()
    const nav = await screen.findByRole('navigation', { name: 'Folders' })
    expect(within(nav).getByRole('button', { name: /Common/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /Task: Setup/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /Contracts/ })).toBeInTheDocument()
    for (const n of ['brief.pdf', 'plan.pdf', 'mine.pdf', 'nda.pdf']) expect(await screen.findByText(n)).toBeInTheDocument()
  })

  it('clicking a task lists only that task root files', async () => {
    renderTab()
    const nav = await screen.findByRole('navigation', { name: 'Folders' })
    await screen.findByText('brief.pdf')
    await userEvent.click(within(nav).getByRole('button', { name: /Task: Setup/ }))
    expect(await screen.findByText('plan.pdf')).toBeInTheDocument()
    expect(screen.getByText('mine.pdf')).toBeInTheDocument()
    expect(screen.queryByText('brief.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('nda.pdf')).not.toBeInTheDocument()
  })

  it('associates can upload and delete only their own files, and cannot manage folders', async () => {
    renderTab('tab=files&folder=task:t1')
    await screen.findByText('plan.pdf')
    expect(screen.queryByRole('button', { name: /New folder/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete plan.pdf' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete mine.pdf' })).toBeInTheDocument()
  })

  it('managers create a folder under the task root returned by the RPC', async () => {
    authUser = { id: 'u2', role: 'Manager' }
    rpc.mockResolvedValue({ data: 'r1', error: null })
    renderTab('tab=files&folder=task:t1')
    await screen.findByText('plan.pdf')
    await userEvent.click(screen.getByRole('button', { name: /New folder/ }))
    await userEvent.type(screen.getByLabelText('Folder name'), 'Invoices{Enter}')
    expect(rpc).toHaveBeenCalledWith('ensure_task_root_folder', { p_task_id: 't1' })
    const ins = inserts.find(i => i.table === 'project_folders')
    expect(ins?.row).toEqual({ project_id: 'p1', task_id: 't1', parent_id: 'r1', name: 'Invoices', created_by: 'u2' })
  })

  it('explains that a folder must be empty when its delete is refused', async () => {
    authUser = { id: 'u2', role: 'Manager' }
    folderDeleteResult = { error: { code: '23503', message: 'fk' } }
    renderTab('tab=files&folder=f1')
    await screen.findByText('nda.pdf')
    await userEvent.click(screen.getByRole('button', { name: /Delete folder/ }))
    expect(await screen.findByText('Folder must be empty before it can be deleted.')).toBeInTheDocument()
  })

  it('Download asks for a signed URL that downloads under the original name', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    renderTab('tab=files&folder=task:t1')
    await screen.findByText('plan.pdf')
    await userEvent.click(screen.getByRole('button', { name: 'Download plan.pdf' }))
    expect(signMock).toHaveBeenCalledWith('p1/b/plan.pdf', 300, { download: 'plan.pdf' })
    expect(win.location.href).toBe('https://signed')
  })

  it('warns that deleting a task/comment attachment breaks the link there', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab('tab=files&folder=task:t1')
    await screen.findByText('shot.png')
    await userEvent.click(screen.getByRole('button', { name: 'Delete shot.png' }))
    expect(confirm.mock.calls[0][0]).toMatch(/also attached to a comment/)
    expect(confirm.mock.calls[0][0]).toMatch(/link there will stop working/)
    await userEvent.click(screen.getByRole('button', { name: 'Delete mine.pdf' }))
    expect(confirm.mock.calls[1][0]).not.toMatch(/attached/)
  })

  it('limits folder names to 100 characters', async () => {
    authUser = { id: 'u2', role: 'Manager' }
    renderTab('tab=files&folder=task:t1')
    await screen.findByText('plan.pdf')
    await userEvent.click(screen.getByRole('button', { name: /New folder/ }))
    expect(screen.getByLabelText('Folder name')).toHaveAttribute('maxLength', '100')
  })

  it('closes the folder form and clears its message when the view changes from outside', async () => {
    authUser = { id: 'u2', role: 'Manager' }
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } })
    renderTab('tab=files&folder=task:t1')
    await screen.findByText('plan.pdf')
    await userEvent.click(screen.getByRole('button', { name: /New folder/ }))
    await userEvent.type(screen.getByLabelText('Folder name'), 'Invoices{Enter}')
    expect(await screen.findByText('rpc failed')).toBeInTheDocument()
    await userEvent.click(screen.getByText('outside link to Common'))
    await screen.findByText('brief.pdf')
    expect(screen.queryByLabelText('Folder name')).not.toBeInTheDocument()
    expect(screen.queryByText('rpc failed')).not.toBeInTheDocument()
    expect(inserts).toHaveLength(0)
  })
})
