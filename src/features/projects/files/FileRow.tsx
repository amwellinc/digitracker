import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProjectFile } from '@/types'
import { deleteProjectFile, openProjectFile, type FolderNode } from './projectFiles'

export const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500'
const ACTION = `min-h-[44px] px-3 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors ${FOCUS}`

const SOURCE_BADGE: Record<ProjectFile['source'], { label: string; cls: string }> = {
  folder:  { label: 'Folder',   cls: 'bg-violet-50 text-violet-700' },
  task:    { label: 'Task',     cls: 'bg-sky-50 text-sky-700' },
  comment: { label: 'Comment',  cls: 'bg-amber-50 text-amber-700' },
  import:  { label: 'Imported', cls: 'bg-gray-100 text-gray-600' },
}

export function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileIcon(f: ProjectFile): string {
  const t = f.mime_type ?? ''
  if (t.startsWith('image/')) return '🖼'
  if (t.startsWith('video/')) return '🎞'
  if (t.includes('pdf')) return '📕'
  if (t.includes('sheet') || /\.(xlsx?|csv)$/i.test(f.name)) return '📊'
  return '📄'
}

export function deleteConfirmText(f: ProjectFile): string {
  const base = `Delete "${f.name}"? This cannot be undone.`
  if (f.source !== 'task' && f.source !== 'comment') return base
  return `${base}\n\nThis file is also attached to a ${f.source}; the attachment link there will stop working.`
}

export interface MoveOption { id: string | null; label: string }

// Destinations inside the file's own task: the task root plus its sub-folders.
export function moveOptions(taskNode: FolderNode | undefined): MoveOption[] {
  if (!taskNode) return []
  const out: MoveOption[] = [{ id: null, label: taskNode.label }]
  const walk = (nodes: FolderNode[], depth: number) => nodes.forEach(n => {
    out.push({ id: n.folderId, label: `${'— '.repeat(depth)}${n.label}` })
    walk(n.children, depth + 1)
  })
  walk(taskNode.children, 1)
  return out
}

export function FileRow({ file, uploaderName, canEdit, moveTo, onChanged, onRemoved }: {
  file: ProjectFile; uploaderName: string; canEdit: boolean; moveTo: MoveOption[]
  onChanged: (f: ProjectFile) => void; onRemoved: (id: string) => void
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'move'>('view')
  const [draft, setDraft] = useState(file.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const badge = SOURCE_BADGE[file.source]

  async function download() {
    setError(null)
    const err = await openProjectFile(file)
    if (err) setError(err)
  }

  async function save(patch: Partial<Pick<ProjectFile, 'name' | 'folder_id'>>) {
    setBusy(true); setError(null)
    const { error: err } = await supabase.from('project_files').update(patch).eq('id', file.id)
    setBusy(false)
    if (err) { setError(`Could not update ${file.name}: ${err.message}`); return }
    setMode('view')
    onChanged({ ...file, ...patch })
  }

  async function remove() {
    if (!window.confirm(deleteConfirmText(file))) return
    setBusy(true); setError(null)
    const err = await deleteProjectFile(file)
    setBusy(false)
    if (err) { setError(err); return }
    onRemoved(file.id)
  }

  const date = new Date(file.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <li className="group px-3 sm:px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50/70 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span aria-hidden="true" className="text-xl leading-none mt-0.5">{fileIcon(file)}</span>
          <div className="min-w-0 flex-1">
            {mode === 'rename' ? (
              <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (draft.trim()) void save({ name: draft.trim() }) }}>
                <label className="sr-only" htmlFor={`rn-${file.id}`}>New name for {file.name}</label>
                <input id={`rn-${file.id}`} value={draft} onChange={e => setDraft(e.target.value)} autoFocus maxLength={255}
                  className="min-h-[44px] flex-1 min-w-0 border border-gray-300 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <button type="submit" disabled={busy} className={`${ACTION} bg-violet-600 text-white hover:bg-violet-700 hover:text-white`}>Save</button>
                <button type="button" onClick={() => { setMode('view'); setDraft(file.name) }} className={ACTION}>Cancel</button>
              </form>
            ) : (
              <p className="text-sm font-medium text-gray-900 break-all">{file.name}</p>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span className={`px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
              <span>{fmtSize(file.size_bytes)}</span>
              <span aria-hidden="true">·</span><span>{uploaderName}</span>
              <span aria-hidden="true">·</span><time dateTime={file.created_at}>{date}</time>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 md:justify-end pl-8 md:pl-0">
          <button type="button" onClick={() => void download()} aria-label={`Download ${file.name}`}
            className={`${ACTION} text-violet-700 hover:bg-violet-50 hover:text-violet-800`}>Download</button>
          {canEdit && mode === 'view' && (
            <>
              <button type="button" onClick={() => setMode('rename')} aria-label={`Rename ${file.name}`} className={ACTION}>Rename</button>
              {moveTo.length > 1 && (
                <button type="button" onClick={() => setMode('move')} aria-label={`Move ${file.name}`} className={ACTION}>Move</button>
              )}
              <button type="button" onClick={() => void remove()} disabled={busy} aria-label={`Delete ${file.name}`}
                className={`${ACTION} text-red-600 hover:bg-red-50 hover:text-red-700`}>Delete</button>
            </>
          )}
        </div>
      </div>
      {mode === 'move' && (
        <div className="mt-2 pl-8 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor={`mv-${file.id}`}>Move {file.name} to</label>
          <select id={`mv-${file.id}`} defaultValue={file.folder_id ?? ''} disabled={busy}
            onChange={e => void save({ folder_id: e.target.value || null })}
            className="min-h-[44px] max-w-full border border-gray-300 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500">
            {moveTo.map(o => <option key={o.id ?? 'root'} value={o.id ?? ''}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => setMode('view')} className={ACTION}>Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 pl-8 text-xs text-red-600">{error}</p>}
    </li>
  )
}
