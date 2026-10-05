// Project Files (spec 2026-10-05-project-files-design.md): upload/sign/delete,
// legacy attachment links, and the folder tree shown on the Files tab.
import { supabase } from '@/lib/supabase'
import type { ProjectFile, ProjectFolder, StoredAttachment } from '@/types'

export const PROJECT_FILES_BUCKET = 'project-files'
const SIGNED_URL_SECONDS = 300
const LEGACY_PATH_RE = /\/storage\/v1\/object\/sign\/task-attachments\/([^?#]+)/

export type FileView = { kind: 'common' } | { kind: 'task'; taskId: string } | { kind: 'folder'; folderId: string }

export interface FolderNode {
  key: string
  label: string
  view: FileView
  folderId: string | null
  taskId: string | null
  children: FolderNode[]
}

function childrenOf(parentId: string, folders: ProjectFolder[], taskId: string | null): FolderNode[] {
  return folders
    .filter(f => !f.is_task_root && f.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(f => ({
      key: f.id, label: f.name, view: { kind: 'folder', folderId: f.id } as FileView, folderId: f.id, taskId,
      children: childrenOf(f.id, folders, taskId),
    }))
}

export function buildFolderTree(tasks: Array<{ id: string; title: string }>, folders: ProjectFolder[]): FolderNode[] {
  const common: FolderNode = { key: 'common', label: 'Common', view: { kind: 'common' }, folderId: null, taskId: null, children: [] }
  const taskNodes = tasks.map(t => {
    const root = folders.find(f => f.is_task_root && f.task_id === t.id)
    return {
      key: `task:${t.id}`, label: `Task: ${t.title}`, view: { kind: 'task', taskId: t.id } as FileView,
      folderId: root?.id ?? null, taskId: t.id,
      children: root ? childrenOf(root.id, folders, t.id) : [],
    }
  })
  return [common, ...taskNodes]
}

export function findPath(tree: FolderNode[], key: string): FolderNode[] {
  for (const node of tree) {
    if (node.key === key) return [node]
    const sub = findPath(node.children, key)
    if (sub.length) return [node, ...sub]
  }
  return []
}

export function viewFromParam(param: string | null): FileView {
  if (!param || param === 'common') return { kind: 'common' }
  if (param.startsWith('task:')) return { kind: 'task', taskId: param.slice(5) }
  return { kind: 'folder', folderId: param }
}

export function paramFromView(v: FileView): string {
  return v.kind === 'common' ? 'common' : v.kind === 'task' ? `task:${v.taskId}` : v.folderId
}

export function filesForView(files: ProjectFile[], view: FileView, search = ''): ProjectFile[] {
  const q = search.trim().toLowerCase()
  return files
    .filter(f => view.kind === 'common'
      || (view.kind === 'task' && f.task_id === view.taskId && f.folder_id === null)
      || (view.kind === 'folder' && f.folder_id === view.folderId))
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function legacyPathFromUrl(url: string): { bucket: 'task-attachments'; path: string } | null {
  const m = url.match(LEGACY_PATH_RE)
  if (!m) return null
  try {
    return { bucket: 'task-attachments', path: decodeURIComponent(m[1]) }
  } catch {
    return null
  }
}

export function resolveAttachment(a: StoredAttachment): { bucket: ProjectFile['bucket']; path: string } | null {
  if (a.bucket && a.path) return { bucket: a.bucket, path: a.path }
  return a.url ? legacyPathFromUrl(a.url) : null
}

export async function signedUrl(bucket: ProjectFile['bucket'], path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS)
  return error || !data?.signedUrl ? null : data.signedUrl
}

export async function uploadProjectFile(opts: {
  projectId: string; taskId: string | null; folderId: string | null
  source: 'folder' | 'task' | 'comment'; file: File; userId: string
}): Promise<{ file: ProjectFile; error: null } | { file: null; error: string }> {
  const id = crypto.randomUUID()
  const path = `${opts.projectId}/${id}/${opts.file.name}`
  // No upsert: the bucket has no storage UPDATE policy.
  const { error: upErr } = await supabase.storage.from(PROJECT_FILES_BUCKET)
    .upload(path, opts.file, { contentType: opts.file.type || undefined })
  if (upErr) return { file: null, error: `Upload failed for ${opts.file.name}: ${upErr.message}` }

  const row: ProjectFile = {
    id, project_id: opts.projectId, folder_id: opts.folderId, task_id: opts.taskId,
    bucket: PROJECT_FILES_BUCKET, storage_path: path, name: opts.file.name,
    size_bytes: opts.file.size, mime_type: opts.file.type || null, uploaded_by: opts.userId,
    source: opts.source, created_at: new Date().toISOString(),
  }
  const { created_at: _createdAt, ...insertRow } = row
  const { error: rowErr } = await supabase.from('project_files').insert(insertRow)
  if (rowErr) {
    const { error: cleanupErr } = await supabase.storage.from(PROJECT_FILES_BUCKET).remove([path])
    const suffix = cleanupErr ? ` (the uploaded file could not be cleaned up: ${cleanupErr.message})` : ''
    return { file: null, error: `Could not save ${opts.file.name}: ${rowErr.message}${suffix}` }
  }
  return { file: row, error: null }
}

export async function deleteProjectFile(f: ProjectFile): Promise<string | null> {
  if (f.bucket === PROJECT_FILES_BUCKET) {
    const { error } = await supabase.storage.from(PROJECT_FILES_BUCKET).remove([f.storage_path])
    if (error) return `Could not delete ${f.name}: ${error.message}`
  }
  const { error } = await supabase.from('project_files').delete().eq('id', f.id)
  return error ? `Could not delete ${f.name}: ${error.message}` : null
}
