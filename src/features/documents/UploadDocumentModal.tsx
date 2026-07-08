import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { DocumentType } from '@/types'

const DOCUMENT_TYPES: DocumentType[] = [
  'Medical', 'Employment', 'HR', 'ID', 'Certificate', 'Contract', 'Performance', 'Standard', 'Other',
]

interface Props {
  targetUserId: string
  targetUserName: string
  onClose: () => void
  onUploaded: () => void
}

export function UploadDocumentModal({ targetUserId, targetUserName, onClose, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<DocumentType>('Standard')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function acceptFile(f: File) {
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) acceptFile(f)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !title.trim()) return
    setError(null)
    setUploading(true)

    const path = `${targetUserId}/${Date.now()}-${file.name}`
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: file.type })

    if (upErr) {
      setError(upErr.message)
      setUploading(false)
      return
    }

    const { data: signed } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 60 * 60 * 24 * 30)

    if (!signed?.signedUrl) {
      setError('Failed to generate download link. Please try again.')
      setUploading(false)
      return
    }

    const { error: dbErr } = await supabase.from('documents').insert({
      user_id: targetUserId,
      title: title.trim(),
      type,
      description: description.trim() || null,
      url: signed.signedUrl,
      size: file.size,
    })

    if (dbErr) {
      setError(dbErr.message)
      setUploading(false)
      return
    }

    setUploading(false)
    onUploaded()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Upload Document</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          For: <span className="font-medium text-gray-800">{targetUserName}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-violet-400 bg-violet-50' : file ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-violet-300 hover:bg-gray-50'
            }`}
          >
            {file ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-3xl">{file.type.startsWith('image/') ? '🖼' : '📄'}</span>
                <p className="text-sm font-medium text-gray-800 truncate max-w-full">{file.name}</p>
                <p className="text-xs text-gray-400">{fmtSize(file.size)}</p>
                <button type="button" onClick={e => { e.stopPropagation(); setFile(null); setTitle('') }}
                  className="text-xs text-red-400 hover:text-red-600 mt-1">Remove</button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="text-3xl">📎</span>
                <p className="text-sm font-medium text-gray-700">Drop a file here or click to browse</p>
                <p className="text-xs text-gray-400">PDF, Word, Excel, Images, and more</p>
              </div>
            )}
            <input ref={fileRef} type="file" className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.gif,.webp"
              onChange={e => { const f = e.target.files?.[0]; if (f) acceptFile(f) }} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Document Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required
              placeholder="e.g. Medical Certificate — June 2026"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Document Type *</label>
            <div className="flex flex-wrap gap-2">
              {DOCUMENT_TYPES.map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    type === t
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="e.g. Approved sick leave for 3 days"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={uploading || !file || !title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {uploading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Uploading…
                </>
              ) : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
