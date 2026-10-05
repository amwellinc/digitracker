import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { ProjectFile, ProjectFolder, User } from '@/types'
import {
  buildFolderTree, filesForView, findPath, paramFromView, uploadProjectFile, viewFromParam, type FolderNode,
} from './projectFiles'
import { FileRow, FOCUS, moveOptions } from './FileRow'
import { FolderTree } from './FolderTree'

const MANAGER_ROLES = ['Admin', 'Manager', 'Super-Admin']
const DUPLICATE_MSG = 'A folder with that name already exists here.'
const NOT_EMPTY_MSG = 'Folder must be empty before it can be deleted.'
const BTN = `min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors ${FOCUS}`
const BTN_GHOST = `${BTN} border border-gray-200 bg-white text-gray-700 hover:border-violet-300 hover:text-violet-700`
const INPUT = 'min-h-[44px] border border-gray-300 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500'

type DbError = { code?: string; message: string } | null

function folderError(err: DbError): string | null {
  if (!err) return null
  if (err.code === '23505') return DUPLICATE_MSG
  if (err.code === '23503') return NOT_EMPTY_MSG
  return err.message
}

export function ProjectFilesTab({ projectId, tasks, members }: {
  projectId: string; tasks: Array<{ id: string; title: string }>; members: User[]
}) {
  const { user } = useAuth()
  const canManage = MANAGER_ROLES.includes(user?.role ?? '')
  const [params, setParams] = useSearchParams()
  const view = viewFromParam(params.get('folder'))
  const activeKey = paramFromView(view)

  const [folders, setFolders] = useState<ProjectFolder[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(0)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [folderForm, setFolderForm] = useState<null | 'new' | 'rename'>(null)
  const [folderName, setFolderName] = useState('')
  const [folderMsg, setFolderMsg] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [fo, fi] = await Promise.all([
      supabase.from('project_folders').select('*').eq('project_id', projectId),
      supabase.from('project_files').select('*').eq('project_id', projectId),
    ])
    const err = fo.error ?? fi.error
    setLoadError(err ? `Could not load files: ${err.message}` : null)
    setFolders((fo.data ?? []) as ProjectFolder[])
    setFiles((fi.data ?? []) as ProjectFile[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const tree = useMemo(() => buildFolderTree(tasks, folders), [tasks, folders])
  const path = findPath(tree, activeKey)
  const node = path[path.length - 1]
  const visible = filesForView(files, view, view.kind === 'common' ? search : '')
  const memberName = (id: string | null) => members.find(m => m.id === id)?.name ?? '—'
  const isSubFolder = view.kind === 'folder' && !!node
  const canAddFolder = canManage && (view.kind === 'task' || isSubFolder)

  function select(n: FolderNode) {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', 'files')
      next.set('folder', paramFromView(n.view))
      return next
    })
    setFolderForm(null)
    setFolderMsg(null)
  }

  async function upload(list: FileList | File[]) {
    const picked = Array.from(list)
    if (!user || picked.length === 0) return
    if (view.kind === 'folder' && !node) return
    const taskId = view.kind === 'common' ? null : view.kind === 'task' ? view.taskId : node.taskId
    const folderId = view.kind === 'folder' ? view.folderId : null
    setUploadErrors([])
    setUploading(picked.length)
    const results = await Promise.all(picked.map(file =>
      uploadProjectFile({ projectId, taskId, folderId, source: 'folder', file, userId: user.id })))
    setUploading(0)
    const added = results.flatMap(r => (r.file ? [r.file] : []))
    setFiles(prev => [...prev, ...added])
    setUploadErrors(results.flatMap(r => (r.error ? [r.error] : [])))
  }

  async function submitFolder() {
    const name = folderName.trim()
    if (!user || !node || !name) return
    setFolderMsg(null)
    if (folderForm === 'rename' && view.kind === 'folder') {
      const { error } = await supabase.from('project_folders').update({ name }).eq('id', view.folderId)
      if (error) { setFolderMsg(folderError(error)); return }
      setFolders(prev => prev.map(f => (f.id === view.folderId ? { ...f, name } : f)))
    } else {
      let parentId = node.folderId
      if (view.kind === 'task') {
        const { data, error } = await supabase.rpc('ensure_task_root_folder', { p_task_id: view.taskId })
        if (error || !data) { setFolderMsg(error?.message ?? 'Could not prepare the task folder.'); return }
        parentId = data as string
      }
      const { data, error } = await supabase.from('project_folders')
        .insert({ project_id: projectId, task_id: node.taskId, parent_id: parentId, name, created_by: user.id })
        .select('*').single()
      if (error) { setFolderMsg(folderError(error)); return }
      // Re-load if the RPC just created the task root so the tree can attach it.
      if (view.kind === 'task' && !folders.some(f => f.id === parentId)) await load()
      else setFolders(prev => [...prev, data as ProjectFolder])
    }
    setFolderForm(null)
    setFolderName('')
  }

  async function deleteFolder() {
    if (view.kind !== 'folder' || !node) return
    if (!window.confirm(`Delete the folder "${node.label}"?`)) return
    setFolderMsg(null)
    const { error } = await supabase.from('project_folders').delete().eq('id', view.folderId)
    if (error) { setFolderMsg(folderError(error)); return }
    setFolders(prev => prev.filter(f => f.id !== view.folderId))
    const parent = path[path.length - 2]
    if (parent) select(parent)
  }

  function openFolderForm(kind: 'new' | 'rename') {
    setFolderForm(kind)
    setFolderName(kind === 'rename' ? node?.label ?? '' : '')
    setFolderMsg(null)
  }

  return (
    <section aria-label="Project files" className="flex flex-col md:flex-row gap-4 min-w-0">
      <FolderTree tree={tree} activeKey={activeKey} onSelect={select} />

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files) }}
        className={`flex-1 min-w-0 bg-white border rounded-xl transition-colors ${dragging ? 'border-violet-400 ring-4 ring-violet-100' : 'border-gray-200'}`}>
        <header className="p-4 border-b border-gray-100 space-y-3">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-sm">
              {path.map((p, i) => (
                <li key={p.key} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span aria-hidden="true" className="text-gray-300">/</span>}
                  {i === path.length - 1
                    ? <span aria-current="page" className="font-semibold text-gray-900 break-all">{p.label}</span>
                    : <button type="button" onClick={() => select(p)} className={`text-gray-500 hover:text-violet-700 rounded px-1 ${FOCUS}`}>{p.label}</button>}
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading > 0 || (view.kind === 'folder' && !node)}
              className={`${BTN} bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60`}>
              {uploading > 0 ? `Uploading ${uploading}…` : '↑ Upload'}
            </button>
            <input ref={fileInput} type="file" multiple hidden aria-hidden="true" tabIndex={-1}
              onChange={e => { const fl = e.target.files; if (fl) void upload(fl); e.target.value = '' }} />
            {canAddFolder && (
              <button type="button" onClick={() => openFolderForm('new')} className={BTN_GHOST}>+ New folder</button>
            )}
            {canManage && isSubFolder && (
              <>
                <button type="button" onClick={() => openFolderForm('rename')} className={BTN_GHOST}>Rename folder</button>
                <button type="button" onClick={() => void deleteFolder()}
                  className={`${BTN} border border-red-200 bg-white text-red-600 hover:bg-red-50`}>Delete folder</button>
              </>
            )}
            {view.kind === 'common' && (
              <div className="w-full sm:w-auto sm:ml-auto">
                <label htmlFor="file-search" className="sr-only">Search files by name</label>
                <input id="file-search" type="search" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search files…" className={`${INPUT} w-full sm:w-56`} />
              </div>
            )}
          </div>

          {folderForm && (
            <form onSubmit={e => { e.preventDefault(); void submitFolder() }} className="flex flex-wrap gap-2">
              <label htmlFor="folder-name" className="sr-only">Folder name</label>
              <input id="folder-name" value={folderName} onChange={e => setFolderName(e.target.value)} autoFocus maxLength={120}
                placeholder={folderForm === 'new' ? 'New folder name' : 'Folder name'} className={`${INPUT} flex-1 min-w-0`} />
              <button type="submit" className={`${BTN} bg-violet-600 text-white hover:bg-violet-700`}>
                {folderForm === 'new' ? 'Create' : 'Save'}
              </button>
              <button type="button" onClick={() => setFolderForm(null)} className={BTN_GHOST}>Cancel</button>
            </form>
          )}
          {folderMsg && <p role="alert" className="text-sm text-red-600">{folderMsg}</p>}
          {uploadErrors.length > 0 && (
            <ul role="alert" className="text-sm text-red-600 space-y-1">
              {uploadErrors.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}
            </ul>
          )}
        </header>

        {loadError && <p role="alert" className="m-4 text-sm text-red-600">{loadError}</p>}
        {!loading && view.kind === 'folder' && !node && (
          <p role="alert" className="m-4 text-sm text-gray-500">This folder no longer exists. Pick another folder.</p>
        )}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="py-14 px-4 text-center text-gray-400">
            <p className="text-4xl mb-2" aria-hidden="true">🗂</p>
            <p className="text-sm font-medium text-gray-500">{search ? 'No files match your search.' : 'No files here yet.'}</p>
            <p className="text-xs mt-1">Drop files onto this panel or use Upload.</p>
          </div>
        ) : (
          <ul aria-label="Files">
            {visible.map(f => (
              <FileRow key={f.id} file={f} uploaderName={memberName(f.uploaded_by)}
                canEdit={canManage || f.uploaded_by === user?.id}
                moveTo={f.task_id ? moveOptions(tree.find(n => n.key === `task:${f.task_id}`)) : []}
                onChanged={u => setFiles(prev => prev.map(x => (x.id === u.id ? u : x)))}
                onRemoved={id => setFiles(prev => prev.filter(x => x.id !== id))} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
