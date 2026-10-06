import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectFile } from '@/types'

const { limitMock, orderMock, eqMock, selectMock, fromMock } = vi.hoisted(() => {
  const limitMock = vi.fn()
  const orderMock = vi.fn((..._a: unknown[]) => ({ limit: limitMock }))
  const eqMock = vi.fn((..._a: unknown[]) => ({ order: orderMock }))
  const selectMock = vi.fn((..._a: unknown[]) => ({ eq: eqMock }))
  const fromMock = vi.fn((_table: string) => ({ select: selectMock }))
  return { limitMock, orderMock, eqMock, selectMock, fromMock }
})
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))

const openProjectFileMock = vi.fn()
vi.mock('../projectFiles', async (orig) => ({
  ...(await orig<typeof import('../projectFiles')>()),
  openProjectFile: (...a: unknown[]) => openProjectFileMock(...a),
}))

import { RecentFilesCard } from '../RecentFilesCard'

const file = (o: Partial<ProjectFile>): ProjectFile => ({
  id: 'x', project_id: 'p1', folder_id: null, task_id: null, bucket: 'project-files', storage_path: 'p1/x/a.pdf',
  name: 'a.pdf', size_bytes: 2048, mime_type: null, uploaded_by: 'u1', source: 'folder', created_at: '2026-10-01T00:00:00Z', ...o,
})

describe('RecentFilesCard', () => {
  beforeEach(() => {
    fromMock.mockClear(); selectMock.mockClear(); eqMock.mockClear(); orderMock.mockClear(); limitMock.mockReset()
    openProjectFileMock.mockReset()
  })

  it('queries the newest 8 files for the project and lists them', async () => {
    limitMock.mockResolvedValue({ data: [file({ id: 'a', name: 'Brief.pdf' }), file({ id: 'b', name: 'Logo.png' })], error: null })
    render(<RecentFilesCard projectId="p1" onViewAll={vi.fn()} />)

    expect(await screen.findByText('Brief.pdf')).toBeInTheDocument()
    expect(screen.getByText('Logo.png')).toBeInTheDocument()
    expect(fromMock).toHaveBeenCalledWith('project_files')
    expect(eqMock).toHaveBeenCalledWith('project_id', 'p1')
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(limitMock).toHaveBeenCalledWith(8)
  })

  it('shows an empty state when there are no files', async () => {
    limitMock.mockResolvedValue({ data: [], error: null })
    render(<RecentFilesCard projectId="p1" onViewAll={vi.fn()} />)
    expect(await screen.findByText(/no files saved yet/i)).toBeInTheDocument()
  })

  it('shows an error when the query fails', async () => {
    limitMock.mockResolvedValue({ data: null, error: { message: 'denied' } })
    render(<RecentFilesCard projectId="p1" onViewAll={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load files: denied/i)
  })

  it('opens a file on click', async () => {
    limitMock.mockResolvedValue({ data: [file({ name: 'Brief.pdf' })], error: null })
    openProjectFileMock.mockResolvedValue(null)
    render(<RecentFilesCard projectId="p1" onViewAll={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Brief\.pdf/ }))
    expect(openProjectFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Brief.pdf' }))
  })

  it('calls onViewAll when "View all" is clicked', async () => {
    limitMock.mockResolvedValue({ data: [], error: null })
    const onViewAll = vi.fn()
    render(<RecentFilesCard projectId="p1" onViewAll={onViewAll} />)
    await userEvent.click(screen.getByRole('button', { name: /view all/i }))
    expect(onViewAll).toHaveBeenCalled()
  })
})
