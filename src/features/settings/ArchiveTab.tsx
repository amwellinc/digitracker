import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { ArchivedEmployeeFile } from '@/types'

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function ArchiveTab() {
  const { user } = useAuth()
  const [files, setFiles] = useState<ArchivedEmployeeFile[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void supabase
      .from('archived_employee_files')
      .select('*')
      .order('archived_at', { ascending: false })
      .then(({ data }) => {
        setFiles((data ?? []) as ArchivedEmployeeFile[])
        setLoading(false)
      })
  }, [user])

  async function openArchive(file: ArchivedEmployeeFile) {
    setOpening(file.id)
    setError(null)
    const { data, error: signError } = await supabase.storage
      .from('documents')
      .createSignedUrl(file.url, 60 * 10)
    setOpening(null)
    if (signError || !data?.signedUrl) {
      setError(`Could not open archive: ${signError?.message ?? 'unknown error'}`)
      return
    }
    window.open(data.signedUrl, '_blank', 'noreferrer')
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Archive</h2>
        <p className="text-sm text-gray-500">
          Full records for permanently deleted employee accounts. Admin-only.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">Loading archive…</div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-4xl mb-3">🗄</span>
            <p className="text-sm font-medium">No archived employees</p>
            <p className="text-xs mt-1">Records appear here after a suspended account is permanently deleted.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Archived By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Size</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {files.map(f => (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{f.original_name}</p>
                    <p className="text-xs text-gray-400">{f.original_email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{f.original_role}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <p>{f.archived_by_name}</p>
                    <p className="text-xs text-gray-400">{f.archived_by_email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(f.archived_at)}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtSize(f.size)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => void openArchive(f)}
                      disabled={opening === f.id}
                      className="text-xs font-semibold text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                    >
                      {opening === f.id ? 'Opening…' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
