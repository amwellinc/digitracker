import { supabase } from '@/lib/supabase'
import type { LeaveAttachment } from '@/types'

// Documents are sensitive (medical certificates etc.) and a leave record is
// meant to stay readable indefinitely, so the bucket stores only the object
// path — never a signed URL baked in at upload time, which would quietly
// stop working once its expiry passed. A fresh signed URL is generated only
// at the moment someone actually opens the document.
//
// Returns an error message on failure instead of throwing, so a click that
// can't produce a URL (deleted file, network blip) shows something instead
// of the button silently doing nothing.
export async function viewLeaveAttachment(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('leave-documents').createSignedUrl(path, 3600)
  if (error) return `Could not open document: ${error.message}`
  if (!data?.signedUrl) return 'Could not open document: no URL returned.'
  window.open(data.signedUrl, '_blank', 'noopener')
  return null
}

export async function uploadLeaveAttachments(
  files: File[],
  targetUserId: string,
  requestId: string,
  existing: LeaveAttachment[] = [],
): Promise<LeaveAttachment[]> {
  const uploaded: LeaveAttachment[] = [...existing]
  for (const file of files) {
    const path = `${targetUserId}/${requestId}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('leave-documents').upload(path, file, { contentType: file.type })
    if (error) continue
    uploaded.push({ path, name: file.name, size: file.size, type: file.type })
  }
  return uploaded
}
