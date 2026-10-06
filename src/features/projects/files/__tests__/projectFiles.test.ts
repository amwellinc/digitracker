import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectFile, ProjectFolder } from '@/types'

const uploadMock = vi.fn()
const removeMock = vi.fn()
const signMock = vi.fn()
const insertMock = vi.fn()
const deleteEqMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: uploadMock, remove: removeMock, createSignedUrl: signMock }) },
    from: () => ({ insert: insertMock, delete: () => ({ eq: deleteEqMock }) }),
  },
}))

import {
  buildFolderTree, findPath, filesForView, legacyPathFromUrl, resolveAttachment,
  viewFromParam, paramFromView, uploadProjectFile, deleteProjectFile, signedUrl, storageKeyName,
  openProjectFile,
} from '../projectFiles'

const folder = (o: Partial<ProjectFolder>): ProjectFolder => ({
  id: 'f', project_id: 'p1', task_id: 't1', parent_id: null, name: 'x', is_task_root: false,
  created_by: null, created_at: '2026-10-01T00:00:00Z', ...o,
})
const file = (o: Partial<ProjectFile>): ProjectFile => ({
  id: 'x', project_id: 'p1', folder_id: null, task_id: null, bucket: 'project-files', storage_path: 'p1/x/a.pdf',
  name: 'a.pdf', size_bytes: 1, mime_type: null, uploaded_by: 'u1', source: 'folder', created_at: '2026-10-01T00:00:00Z', ...o,
})

describe('folder tree', () => {
  const tasks = [{ id: 't1', title: 'Setup' }, { id: 't2', title: 'Backlinks' }]
  const folders = [
    folder({ id: 'root1', is_task_root: true, name: 'task-root' }),
    folder({ id: 'contracts', parent_id: 'root1', name: 'Contracts' }),
    folder({ id: 'signed', parent_id: 'contracts', name: 'Signed' }),
  ]

  it('puts Common first, then a folder per task with nested sub-folders', () => {
    const tree = buildFolderTree(tasks, folders)
    expect(tree.map(n => n.label)).toEqual(['Common', 'Task: Setup', 'Task: Backlinks'])
    expect(tree[1].folderId).toBe('root1')
    expect(tree[1].children[0].label).toBe('Contracts')
    expect(tree[1].children[0].children[0].label).toBe('Signed')
    expect(tree[2].folderId).toBeNull()
  })

  it('finds the breadcrumb path to a nested folder', () => {
    const tree = buildFolderTree(tasks, folders)
    expect(findPath(tree, 'signed').map(n => n.label)).toEqual(['Task: Setup', 'Contracts', 'Signed'])
    expect(findPath(tree, 'missing')).toEqual([])
  })

  it('round-trips URL params', () => {
    for (const v of [{ kind: 'common' }, { kind: 'task', taskId: 't1' }, { kind: 'folder', folderId: 'f9' }] as const) {
      expect(viewFromParam(paramFromView(v))).toEqual(v)
    }
    expect(viewFromParam(null)).toEqual({ kind: 'common' })
  })
})

describe('filesForView', () => {
  const files = [
    file({ id: 'a', task_id: 't1', created_at: '2026-10-01T00:00:00Z', name: 'Brief.pdf' }),
    file({ id: 'b', task_id: 't1', folder_id: 'contracts', created_at: '2026-10-03T00:00:00Z' }),
    file({ id: 'c', created_at: '2026-10-02T00:00:00Z', name: 'logo.png' }),
  ]
  it('Common lists every file newest first', () => {
    expect(filesForView(files, { kind: 'common' }).map(f => f.id)).toEqual(['b', 'c', 'a'])
  })
  it('task view lists only files directly in that task', () => {
    expect(filesForView(files, { kind: 'task', taskId: 't1' }).map(f => f.id)).toEqual(['a'])
  })
  it('folder view lists that folder; search is case-insensitive', () => {
    expect(filesForView(files, { kind: 'folder', folderId: 'contracts' }).map(f => f.id)).toEqual(['b'])
    expect(filesForView(files, { kind: 'common' }, 'BRIEF').map(f => f.id)).toEqual(['a'])
  })
})

describe('legacy attachment links', () => {
  const base = 'https://mllrjejqyddgaxxtjsqf.supabase.co/storage/v1/object/sign/task-attachments/'
  it('extracts and decodes the object path, even from an expired link', () => {
    expect(legacyPathFromUrl(`${base}t1/1700-My%20Report%20%C3%A9.pdf?token=expired`))
      .toEqual({ bucket: 'task-attachments', path: 't1/1700-My Report é.pdf' })
  })
  it('returns null for foreign or malformed URLs', () => {
    expect(legacyPathFromUrl('https://example.com/a.pdf')).toBeNull()
    expect(legacyPathFromUrl(`${base}t1/bad%E0%A4.pdf?token=x`)).toBeNull()
  })
  it('resolveAttachment prefers bucket+path, falls back to the legacy url', () => {
    expect(resolveAttachment({ bucket: 'project-files', path: 'p1/x/a.pdf', name: 'a', size: 1, type: '' }))
      .toEqual({ bucket: 'project-files', path: 'p1/x/a.pdf' })
    expect(resolveAttachment({ url: `${base}t1/a.pdf?token=x`, name: 'a', size: 1, type: '' }))
      .toEqual({ bucket: 'task-attachments', path: 't1/a.pdf' })
    expect(resolveAttachment({ name: 'a', size: 1, type: '' })).toBeNull()
  })
})

describe('storageKeyName', () => {
  it('turns the macOS narrow no-break space into a plain space', () => {
    expect(storageKeyName('Screenshot 2026-10-05 at 10.15.32\u202fAM.png')).toBe('Screenshot 2026-10-05 at 10.15.32 AM.png')
  })
  it('strips accents', () => {
    expect(storageKeyName('Résumé Café.pdf')).toBe('Resume Cafe.pdf')
  })
  it('replaces emoji and CJK with a single underscore per run', () => {
    expect(storageKeyName('report 🎉🎉 報告書.docx')).toBe('report.docx')
    expect(storageKeyName('報告書 final.pdf')).toBe('final.pdf')
  })
  it('replaces characters Storage rejects', () => {
    expect(storageKeyName('a#b[c]%d.txt')).toBe('a_b_c_d.txt')
    expect(storageKeyName('‘quoted’ name.txt')).toBe('quoted_ name.txt')
  })
  it('falls back to "file" (keeping the extension) when nothing usable is left', () => {
    expect(storageKeyName('🎉🎉.png')).toBe('file.png')
    expect(storageKeyName('###')).toBe('file')
    expect(storageKeyName('')).toBe('file')
  })
  it('caps the length at 150 and keeps the extension', () => {
    const out = storageKeyName(`${'a'.repeat(300)}.pdf`)
    expect(out).toHaveLength(150)
    expect(out.endsWith('.pdf')).toBe(true)
    expect(out.startsWith('aaaa')).toBe(true)
  })
  it('only ever emits Storage-safe characters', () => {
    for (const n of ['Ünïcødé “x” 😀.jpg', '\u202f.\u202f', 'a/b\\c.png', '. leading.dots._']) {
      expect(storageKeyName(n)).toMatch(/^[A-Za-z0-9._() -]+$/)
    }
  })
})

describe('upload, sign and delete', () => {
  beforeEach(() => {
    uploadMock.mockReset(); removeMock.mockReset(); signMock.mockReset(); insertMock.mockReset(); deleteEqMock.mockReset()
  })
  const f = new File(['hello'], 'My Report.pdf', { type: 'application/pdf' })

  it('uploads to <project>/<fileId>/<name> then inserts the row', async () => {
    uploadMock.mockResolvedValue({ error: null })
    insertMock.mockResolvedValue({ error: null })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: 't1', folderId: null, source: 'comment', file: f, userId: 'u1' })
    expect(res.error).toBeNull()
    const path = uploadMock.mock.calls[0][0] as string
    expect(path).toMatch(/^p1\/[0-9a-f-]{36}\/My Report\.pdf$/)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p1', task_id: 't1', folder_id: null, bucket: 'project-files', storage_path: path,
      name: 'My Report.pdf', size_bytes: 5, mime_type: 'application/pdf', uploaded_by: 'u1', source: 'comment',
    }))
  })

  it('uses a Storage-safe key but keeps the original name on the row', async () => {
    uploadMock.mockResolvedValue({ error: null })
    insertMock.mockResolvedValue({ error: null })
    const shot = new File(['x'], 'Screenshot at 10.15\u202fAM é#.png', { type: 'image/png' })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: null, folderId: null, source: 'folder', file: shot, userId: 'u1' })
    const path = uploadMock.mock.calls[0][0] as string
    expect(path).toMatch(/^p1\/[0-9a-f-]{36}\/Screenshot at 10\.15 AM e\.png$/)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ storage_path: path, name: 'Screenshot at 10.15\u202fAM é#.png' }))
    expect(res.file?.name).toBe('Screenshot at 10.15\u202fAM é#.png')
  })

  it('removes the uploaded object when the row insert fails', async () => {
    uploadMock.mockResolvedValue({ error: null })
    insertMock.mockResolvedValue({ error: { message: 'row-level security' } })
    removeMock.mockResolvedValue({ error: null })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: null, folderId: null, source: 'folder', file: f, userId: 'u1' })
    expect(res.error).toMatch(/row-level security/)
    expect(removeMock).toHaveBeenCalledWith([uploadMock.mock.calls[0][0]])
  })

  it('mentions failed cleanup when insert and remove both fail', async () => {
    uploadMock.mockResolvedValue({ error: null })
    insertMock.mockResolvedValue({ error: { message: 'row-level security' } })
    removeMock.mockResolvedValue({ error: { message: 'denied' } })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: null, folderId: null, source: 'folder', file: f, userId: 'u1' })
    expect(res.error).toMatch(/could not be cleaned up: denied/)
  })

  it('reports an upload error without inserting', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'too large' } })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: null, folderId: null, source: 'folder', file: f, userId: 'u1' })
    expect(res.error).toMatch(/too large/)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('signs for 300 seconds', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    expect(await signedUrl('project-files', 'p1/x/a.pdf')).toBe('https://signed')
    expect(signMock).toHaveBeenCalledWith('p1/x/a.pdf', 300)
  })

  it('asks Storage to send the file as a download when a download name is given', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'https://signed?download=a.pdf' }, error: null })
    expect(await signedUrl('project-files', 'p1/x/a.pdf', 'My Report é.pdf')).toBe('https://signed?download=a.pdf')
    expect(signMock).toHaveBeenCalledWith('p1/x/a.pdf', 300, { download: 'My Report é.pdf' })
  })

  it('deletes the object before the row; imported files delete only the row', async () => {
    removeMock.mockResolvedValue({ data: [{ name: 'p1/x/a.pdf' }], error: null })
    deleteEqMock.mockResolvedValue({ error: null })
    expect(await deleteProjectFile(file({ id: 'a' }))).toBeNull()
    expect(removeMock).toHaveBeenCalledWith(['p1/x/a.pdf'])
    removeMock.mockClear()
    expect(await deleteProjectFile(file({ id: 'b', bucket: 'task-attachments', source: 'import' }))).toBeNull()
    expect(removeMock).not.toHaveBeenCalled()
    expect(deleteEqMock).toHaveBeenLastCalledWith('id', 'b')
  })

  it('keeps the row when Storage silently removed nothing (RLS filtered the object)', async () => {
    removeMock.mockResolvedValue({ data: [], error: null })
    expect(await deleteProjectFile(file({ id: 'a', name: 'a.pdf' }))).toBe("You don't have permission to delete a.pdf")
    expect(deleteEqMock).not.toHaveBeenCalled()
  })

  it('reports a Storage remove error without deleting the row', async () => {
    removeMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await deleteProjectFile(file({ id: 'a' }))).toMatch(/boom/)
    expect(deleteEqMock).not.toHaveBeenCalled()
  })
})

describe('openProjectFile', () => {
  beforeEach(() => { signMock.mockReset() })

  it('opens a blank tab before resolving the signed URL, then navigates it there', async () => {
    const fakeWin = { opener: {}, location: { href: '' } } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin)
    signMock.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })

    const err = await openProjectFile(file({ bucket: 'project-files', storage_path: 'p1/x/a.pdf', name: 'a.pdf' }))

    expect(err).toBeNull()
    expect(openSpy).toHaveBeenNthCalledWith(1, '', '_blank')
    expect(fakeWin.opener).toBeNull()
    expect(fakeWin.location.href).toBe('https://signed')
    openSpy.mockRestore()
  })

  it('closes the blank tab and reports an error when signing fails', async () => {
    const closeMock = vi.fn()
    const fakeWin = { opener: {}, location: { href: '' }, close: closeMock } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin)
    signMock.mockResolvedValue({ data: null, error: { message: 'denied' } })

    const err = await openProjectFile(file({ name: 'a.pdf' }))

    expect(err).toBe('Could not open a.pdf.')
    expect(closeMock).toHaveBeenCalled()
    openSpy.mockRestore()
  })
})
