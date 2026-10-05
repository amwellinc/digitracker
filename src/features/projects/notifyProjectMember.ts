import { supabase } from '@/lib/supabase'

// Emails a newly-added project member. The in-app notification is written
// by add_project_member itself (migration 060) so it can never be skipped;
// the email needs SMTP, which only an edge function can reach. Never throws:
// membership has already been granted by the time this runs, so a failed
// email is reported back as a warning, not treated as a failed add.
export async function notifyProjectMember(projectId: string, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('notify-project-member', {
      body: { projectId, userId },
    })
    if (error) return error.message
    const result = data as { sent?: boolean; error?: string | null } | null
    if (!result?.sent) return result?.error ?? 'Unknown error'
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
