import { useState } from 'react'
import type { StoredAttachment } from '@/types'
import { resolveAttachment, signedUrl } from './projectFiles'

const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp)$/i

// Opens a project attachment through a freshly signed URL, so links never
// expire (stored 30-day URLs did). Legacy entries are re-signed from the
// path embedded in their old URL.
export function AttachmentLink({ attachment }: { attachment: StoredAttachment }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const target = resolveAttachment(attachment)

  async function open() {
    if (!target) return
    // Open synchronously, inside the click gesture, so popup blockers allow
    // it; navigate it once the signed URL is ready.
    const win = window.open('', '_blank')
    if (win) win.opener = null
    setBusy(true)
    setFailed(false)
    const url = await signedUrl(target.bucket, target.path)
    setBusy(false)
    if (!url) { win?.close(); setFailed(true); return }
    if (win) win.location.href = url
    else window.open(url, '_blank', 'noopener')
  }

  const icon = IMAGE_RE.test(attachment.name) || (attachment.type ?? '').startsWith('image/') ? '🖼' : '📄'
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={() => void open()} disabled={busy || !target}
        className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-60 max-w-[180px]">
        <span aria-hidden="true">{icon}</span> <span className="truncate">{attachment.name}</span>
      </button>
      {failed && <span role="alert" className="text-[11px] text-red-600 mt-0.5">Could not open this file.</span>}
    </span>
  )
}
