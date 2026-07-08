import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Document, DocumentType, User } from '@/types'
import { UploadDocumentModal } from './UploadDocumentModal'

const TYPE_META: Record<DocumentType, { icon: string; color: string }> = {
  Medical:     { icon: '🏥', color: 'bg-rose-50 text-rose-700' },
  Employment:  { icon: '📋', color: 'bg-blue-50 text-blue-700' },
  HR:          { icon: '👥', color: 'bg-violet-50 text-violet-700' },
  ID:          { icon: '🪪', color: 'bg-amber-50 text-amber-700' },
  Certificate: { icon: '🎓', color: 'bg-green-50 text-green-700' },
  Contract:    { icon: '📝', color: 'bg-teal-50 text-teal-700' },
  Performance: { icon: '⭐', color: 'bg-indigo-50 text-indigo-700' },
  Standard:    { icon: '📄', color: 'bg-gray-100 text-gray-600' },
  Other:       { icon: '📌', color: 'bg-gray-100 text-gray-500' },
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function storagePathFromUrl(url: string): string | null {
  const match = url.match(/\/object\/sign\/documents\/(.+?)(\?|$)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function HRDocumentsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'Super-admin' || user?.role === 'Manager'

  const [members, setMembers] = useState<User[]>([])
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // Load members (admin/manager) or init to self (staff)
  useEffect(() => {
    if (!user) return
    if (!canManage) {
      setSelectedUserId(user.id)
      return
    }
    void supabase
      .from('users')
      .select('*')
      .eq('sub_account', user.sub_account)
      .order('name')
      .then(async ({ data }) => {
        const m = (data ?? []) as User[]
        setMembers(m)
        if (m.length > 0) setSelectedUserId(prev => prev || m[0].id)

        // Fetch all doc counts in one query
        const { data: countData } = await supabase
          .from('documents')
          .select('user_id')
        const counts: Record<string, number> = {}
        ;(countData ?? []).forEach((d: { user_id: string }) => {
          counts[d.user_id] = (counts[d.user_id] ?? 0) + 1
        })
        setDocCounts(counts)
      })
  }, [user, canManage])

  // Load documents for the selected user
  const loadDocs = useCallback(async () => {
    if (!selectedUserId) return
    setLoading(true)
    const { data } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', selectedUserId)
      .order('created_at', { ascending: false })
    setDocs((data ?? []) as Document[])
    setLoading(false)
  }, [selectedUserId])

  useEffect(() => { void loadDocs() }, [loadDocs, tick])

  // Realtime: subscribe to doc changes for selected user
  useEffect(() => {
    if (!selectedUserId) return
    const ch = supabase.channel('documents-page-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents',
        filter: `user_id=eq.${selectedUserId}` }, () => setTick(t => t + 1))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [selectedUserId])

  async function deleteDoc(doc: Document) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return
    setDeleting(doc.id)

    const path = storagePathFromUrl(doc.url)
    if (path) await supabase.storage.from('documents').remove([path])
    await supabase.from('documents').delete().eq('id', doc.id)

    setDocCounts(c => ({ ...c, [doc.user_id]: Math.max(0, (c[doc.user_id] ?? 1) - 1) }))
    setTick(t => t + 1)
    setDeleting(null)
  }

  function onUploaded() {
    setDocCounts(c => ({ ...c, [selectedUserId]: (c[selectedUserId] ?? 0) + 1 }))
    setTick(t => t + 1)
  }

  const selectedUser = canManage ? members.find(m => m.id === selectedUserId) : user
  const isManagingOther = canManage && selectedUserId !== user?.id

  const filteredMembers = members.filter(m => {
    const q = search.toLowerCase()
    return (
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      (m.phone ?? '').includes(q)
    )
  })

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">HR Documents</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {canManage
            ? 'Upload and manage employee documents. Verify identity before uploading.'
            : 'Your documents — upload and access your personal HR files.'}
        </p>
      </div>

      <div className={canManage ? 'flex gap-5' : ''}>
        {/* Left panel: user selector (admin/manager only) */}
        {canManage && (
          <div className="w-72 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 220px)' }}>
              <div className="p-3 border-b border-gray-100">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, email, phone…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {members.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">Loading team…</div>
              ) : (
                <div className="overflow-y-auto flex-1">
                  {filteredMembers.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedUserId(m.id)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-50 transition-colors hover:bg-gray-50 ${
                        selectedUserId === m.id
                          ? 'bg-violet-50 border-l-2 border-l-violet-600 pl-3'
                          : ''
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-700 text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {m.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                          {(docCounts[m.id] ?? 0) > 0 && (
                            <span className="flex-shrink-0 text-[10px] font-bold bg-violet-100 text-violet-600 rounded-full px-1.5 py-0.5">
                              {docCounts[m.id]}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate">{m.email}</p>
                        {m.phone && <p className="text-xs text-gray-400">{m.phone}</p>}
                        <span className="text-[10px] text-gray-300">{m.role}</span>
                      </div>
                    </button>
                  ))}
                  {filteredMembers.length === 0 && (
                    <div className="p-6 text-center text-gray-400 text-sm">No members found</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right panel: document list + identity banner */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Identity verification card */}
          {selectedUser ? (
            <div className={`rounded-2xl border p-4 ${
              isManagingOther
                ? 'bg-amber-50 border-amber-200'
                : 'bg-white border-gray-200'
            }`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-violet-100 text-violet-700 text-base font-bold flex items-center justify-center flex-shrink-0">
                    {selectedUser.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      {isManagingOther && <span className="text-amber-500 text-base">⚠️</span>}
                      <p className="font-semibold text-gray-900 text-base">{selectedUser.name}</p>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{selectedUser.role}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                      <span className="text-sm text-gray-500 flex items-center gap-1">
                        <span className="text-gray-400">✉</span> {selectedUser.email}
                      </span>
                      {selectedUser.phone && (
                        <span className="text-sm text-gray-500 flex items-center gap-1">
                          <span className="text-gray-400">📱</span> {selectedUser.phone}
                        </span>
                      )}
                    </div>
                    {isManagingOther && (
                      <p className="text-xs text-amber-700 mt-1.5 font-medium">
                        Confirm this is the correct employee before uploading sensitive documents.
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowUpload(true)}
                  className="bg-violet-600 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-violet-700 transition-colors flex items-center gap-1.5 flex-shrink-0"
                >
                  + Upload Document
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 text-sm text-gray-400">
              Select a team member to manage their documents.
            </div>
          )}

          {/* Document list */}
          {selectedUser && (
            loading ? (
              <div className="flex justify-center py-16">
                <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : docs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
                <span className="text-5xl mb-3">📁</span>
                <p className="text-base font-medium">No documents yet</p>
                <p className="text-sm mt-1">Upload the first document for {canManage && isManagingOther ? selectedUser.name : 'yourself'}</p>
                <button onClick={() => setShowUpload(true)}
                  className="mt-4 text-sm text-violet-600 hover:underline">+ Upload Document</button>
              </div>
            ) : (
              <div className="space-y-2">
                {docs.map(doc => {
                  const meta = TYPE_META[doc.type] ?? TYPE_META.Other
                  const canDelete = canManage || doc.user_id === user?.id
                  return (
                    <div key={doc.id}
                      className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4 hover:border-gray-300 transition-colors">
                      <span className="text-2xl flex-shrink-0 mt-0.5">{meta.icon}</span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
                            {doc.type}
                          </span>
                          <p className="font-medium text-gray-900">{doc.title}</p>
                        </div>
                        {doc.description && (
                          <p className="text-xs text-gray-400 mt-0.5">{doc.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {fmtSize(doc.size)} · Uploaded {fmtDate(doc.created_at)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1.5 transition-colors"
                        >
                          Download
                        </a>
                        {canDelete && (
                          <button
                            onClick={() => void deleteDoc(doc)}
                            disabled={deleting === doc.id}
                            className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
                          >
                            {deleting === doc.id ? '…' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>

      {showUpload && selectedUser && (
        <UploadDocumentModal
          targetUserId={selectedUserId}
          targetUserName={selectedUser.name}
          onClose={() => setShowUpload(false)}
          onUploaded={onUploaded}
        />
      )}
    </div>
  )
}
