import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { MessageBoardPost, PostImage } from './types'

interface Props {
  subAccount: string
  editingPost: MessageBoardPost | null
  onClose: () => void
  onSaved: () => void
}

interface NewImage { file: File; preview: string }

export function PostComposerModal({ subAccount, editingPost, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [subject, setSubject] = useState(editingPost?.subject ?? '')
  const [content, setContent] = useState(editingPost?.content ?? '')
  const [keepIndefinitely, setKeepIndefinitely] = useState(!editingPost?.expires_at)
  const [endDate, setEndDate] = useState(editingPost?.expires_at ? editingPost.expires_at.slice(0, 10) : '')
  const [existingImages, setExistingImages] = useState<PostImage[]>(editingPost?.images ?? [])
  const [newImages, setNewImages] = useState<NewImage[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addFiles(files: FileList | null) {
    if (!files) return
    const added = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setNewImages(p => [...p, ...added])
  }

  async function uploadImages(postId: string): Promise<PostImage[]> {
    const uploaded: PostImage[] = []
    for (const img of newImages) {
      const path = `${subAccount}/${postId}/${Date.now()}-${img.file.name}`
      const { error: upErr } = await supabase.storage
        .from('message-board-images')
        .upload(path, img.file, { contentType: img.file.type })
      if (upErr) continue
      const { data } = supabase.storage.from('message-board-images').getPublicUrl(path)
      uploaded.push({ url: data.publicUrl, name: img.file.name })
    }
    return uploaded
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!subject.trim() || !content.trim()) {
      setError('Subject and content are required.'); return
    }
    setSaving(true); setError(null)

    const expiresAt = keepIndefinitely || !endDate ? null : new Date(`${endDate}T23:59:59`).toISOString()

    if (editingPost) {
      const uploaded = await uploadImages(editingPost.id)
      const { error: updErr } = await supabase.from('message_board_posts').update({
        subject: subject.trim(),
        content: content.trim(),
        expires_at: expiresAt,
        images: [...existingImages, ...uploaded],
        updated_at: new Date().toISOString(),
      }).eq('id', editingPost.id)
      setSaving(false)
      if (updErr) { setError(updErr.message); return }
    } else {
      const id = crypto.randomUUID()
      const uploaded = await uploadImages(id)
      const { error: insErr } = await supabase.from('message_board_posts').insert({
        id,
        sub_account: subAccount,
        subject: subject.trim(),
        content: content.trim(),
        images: uploaded,
        posted_by: user.id,
        expires_at: expiresAt,
      })
      setSaving(false)
      if (insErr) { setError(insErr.message); return }
    }

    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {editingPost ? 'Edit Announcement' : 'New Announcement'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} required
              placeholder="e.g. Office closed for Deepavali"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} required rows={5}
              placeholder="What do you want the team to know?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Images</label>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 text-sm text-violet-600 border border-dashed border-violet-300 rounded-lg px-3 py-2 hover:bg-violet-50 w-full justify-center">
              🖼️ Add images
            </button>
            <input ref={fileRef} type="file" multiple accept="image/*"
              className="hidden" onChange={e => addFiles(e.target.files)} />
            {(existingImages.length > 0 || newImages.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {existingImages.map(img => (
                  <div key={img.url} className="relative">
                    <img src={img.url} alt={img.name} className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                    <button type="button" onClick={() => setExistingImages(p => p.filter(i => i.url !== img.url))}
                      className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600">✕</button>
                  </div>
                ))}
                {newImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img.preview} alt={img.file.name} className="w-16 h-16 rounded-lg object-cover border border-violet-200" />
                    <button type="button" onClick={() => setNewImages(p => p.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <input type="checkbox" checked={keepIndefinitely}
                onChange={e => setKeepIndefinitely(e.target.checked)}
                className="rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
              Keep this posted indefinitely
            </label>
            {!keepIndefinitely && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Remove after</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  required={!keepIndefinitely}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 px-4 py-2">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors">
              {saving ? 'Posting…' : editingPost ? 'Save Changes' : 'Post Announcement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
