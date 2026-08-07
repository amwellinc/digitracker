import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useRealtime } from '@/hooks/useRealtime'
import { PostComposerModal } from './PostComposerModal'
import type { MessageBoardPost } from './types'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface PostCardProps {
  post: MessageBoardPost
  compact?: boolean
  isAdmin: boolean
  onEdit: (post: MessageBoardPost) => void
  onDelete: (id: string) => void
  onImageClick: (url: string) => void
  deleting: boolean
}

function PostCard({ post, compact, isAdmin, onEdit, onDelete, onImageClick, deleting }: PostCardProps) {
  return (
    <div className="group relative">
      {isAdmin && (
        <div className="absolute top-0 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(post)} title="Edit"
            className="text-xs text-gray-400 hover:text-violet-600 w-6 h-6 flex items-center justify-center rounded hover:bg-violet-50">✎</button>
          <button onClick={() => onDelete(post.id)} disabled={deleting} title="Delete"
            className="text-xs text-gray-400 hover:text-red-600 w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 disabled:opacity-40">
            {deleting ? '…' : '✕'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pr-14">
        <h3 className={compact ? 'text-sm font-semibold text-gray-800' : 'text-base font-semibold text-gray-900'}>
          {post.subject}
        </h3>
        {post.expires_at && (
          <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 whitespace-nowrap">
            Until {fmtDate(post.expires_at)}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-0.5">
        {fmtDate(post.posted_at)}{post.poster?.name ? ` · ${post.poster.name}` : ''}
      </p>

      <p className={`mt-2 whitespace-pre-wrap text-gray-700 ${compact ? 'text-xs line-clamp-3' : 'text-sm'}`}>
        {post.content}
      </p>

      {post.images.length > 0 && (
        <div className={`mt-3 grid gap-2 ${compact ? 'grid-cols-4' : 'grid-cols-3 sm:grid-cols-4'}`}>
          {post.images.map((img, i) => (
            <button key={i} type="button" onClick={() => onImageClick(img.url)}
              className={`${compact ? 'aspect-square' : 'aspect-video'} rounded-lg overflow-hidden bg-gray-100 hover:opacity-90 transition-opacity`}>
              <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function MessageBoard() {
  const { user } = useAuth()
  const [posts, setPosts] = useState<MessageBoardPost[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showOlder, setShowOlder] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [editingPost, setEditingPost] = useState<MessageBoardPost | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const isAdmin = user?.role === 'Admin'

  const fetchPosts = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('message_board_posts')
      .select('*, poster:users!message_board_posts_posted_by_fkey(name)')
      .eq('sub_account', user.sub_account)
      .order('posted_at', { ascending: false })
    setPosts((data as MessageBoardPost[]) ?? [])
    setLoaded(true)
  }, [user])

  useEffect(() => { void fetchPosts() }, [fetchPosts])

  const handleChange = useCallback(() => { void fetchPosts() }, [fetchPosts])
  useRealtime({ table: 'message_board_posts', onInsert: handleChange, onUpdate: handleChange, onDelete: handleChange })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this announcement? This cannot be undone.')) return
    setDeletingId(id)
    setActionError(null)
    const { error } = await supabase.from('message_board_posts').delete().eq('id', id)
    setDeletingId(null)
    if (error) { setActionError(`Could not delete announcement: ${error.message}`); return }
    void fetchPosts()
  }

  function openEdit(post: MessageBoardPost) {
    setEditingPost(post)
    setShowComposer(true)
  }

  function openNew() {
    setEditingPost(null)
    setShowComposer(true)
  }

  // Super-Admin oversees the whole platform, not a single sub-account's team —
  // this board is for a company's own members, so it doesn't apply to them.
  if (!user || user.role === 'Super-Admin' || !loaded) return null

  const now = Date.now()
  const activePosts = posts.filter(p => !p.expires_at || new Date(p.expires_at).getTime() > now)

  if (activePosts.length === 0 && !isAdmin) return null

  const [latest, ...older] = activePosts

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-white border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center text-base flex-shrink-0">
            📣
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Company Updates</h2>
            <p className="text-xs text-gray-400">Announcements for {user.sub_account}</p>
          </div>
        </div>
        {isAdmin && (
          <button onClick={openNew}
            className="flex-shrink-0 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors">
            + New Post
          </button>
        )}
      </div>

      {actionError && (
        <div className="mx-5 mt-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
          {actionError}
        </div>
      )}

      <div className="p-5">
        {activePosts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            No announcements yet — post one for your team.
          </p>
        ) : (
          <>
            <PostCard
              post={latest}
              isAdmin={isAdmin}
              onEdit={openEdit}
              onDelete={handleDelete}
              onImageClick={setLightboxUrl}
              deleting={deletingId === latest.id}
            />

            {older.length > 0 && (
              <>
                <button
                  onClick={() => setShowOlder(p => !p)}
                  className="mt-4 text-xs font-medium text-violet-600 hover:text-violet-800"
                >
                  {showOlder ? '▴ Hide earlier updates' : `▾ Show ${older.length} earlier update${older.length === 1 ? '' : 's'}`}
                </button>

                {showOlder && (
                  <div className="mt-3 space-y-4 divide-y divide-gray-100">
                    {older.map(post => (
                      <div key={post.id} className="pt-4 first:pt-0">
                        <PostCard
                          post={post}
                          compact
                          isAdmin={isAdmin}
                          onEdit={openEdit}
                          onDelete={handleDelete}
                          onImageClick={setLightboxUrl}
                          deleting={deletingId === post.id}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {showComposer && user && (
        <PostComposerModal
          subAccount={user.sub_account}
          editingPost={editingPost}
          onClose={() => setShowComposer(false)}
          onSaved={fetchPosts}
        />
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" className="max-w-4xl w-full rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  )
}
