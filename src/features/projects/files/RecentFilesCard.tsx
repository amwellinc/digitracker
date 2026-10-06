import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProjectFile } from '@/types'
import { fileIcon, fmtSize, FOCUS } from './FileRow'
import { openProjectFile } from './projectFiles'

const RECENT_FILES_LIMIT = 8

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function RecentFileRow({ file }: { file: ProjectFile }) {
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setError(null)
    const err = await openProjectFile(file)
    if (err) setError(err)
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void open()}
        className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors ${FOCUS}`}
      >
        <span aria-hidden="true" className="text-base leading-none mt-0.5">{fileIcon(file)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-900 truncate">{file.name}</span>
          <span className="block text-xs text-gray-400">
            <time dateTime={file.created_at}>{fmtDate(file.created_at)}</time> · {fmtSize(file.size_bytes)}
          </span>
        </span>
      </button>
      {error && <p role="alert" className="px-3 text-xs text-red-600">{error}</p>}
    </li>
  )
}

// Quick-reference list of the most recently saved project files, shown
// alongside the task list so files are visible without switching tabs.
// Does its own lightweight query rather than sharing ProjectFilesTab's
// load() — that component's state is tightly coupled to upload/rename/move/
// delete mutations a read-only card like this one has no need for.
export function RecentFilesCard({ projectId, onViewAll }: { projectId: string; onViewAll: () => void }) {
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(RECENT_FILES_LIMIT)
      if (cancelled) return
      setError(err ? `Could not load files: ${err.message}` : null)
      setFiles((data ?? []) as ProjectFile[])
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [projectId])

  return (
    <aside aria-label="Recently saved files" className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-800">Recent Files</h3>
        <button type="button" onClick={onViewAll} className={`text-xs font-medium text-violet-600 hover:underline ${FOCUS}`}>
          View all →
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-[3px] border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p role="alert" className="text-xs text-red-600 px-3 py-2">{error}</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-gray-400 px-3 py-2">No files saved yet.</p>
      ) : (
        <ul className="space-y-0.5 -mx-1">
          {files.map(f => <RecentFileRow key={f.id} file={f} />)}
        </ul>
      )}
    </aside>
  )
}
