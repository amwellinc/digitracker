import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

export interface ProjectMembership {
  id: string
  name: string
}

interface MembershipRow {
  project_id: string
  projects: { name: string } | null
}

export function useProjectMemberships() {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState<ProjectMembership[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) { setMemberships([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('project_members')
      .select('project_id, projects(name)')
      .eq('user_id', user.id)

    const rows = (data ?? []) as unknown as MembershipRow[]
    setMemberships(
      rows
        .filter(r => r.projects)
        .map(r => ({ id: r.project_id, name: r.projects!.name }))
    )
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  // Mirrors the layout-task-count channel pattern in src/app/Layout.tsx:
  // a lightweight realtime subscription that just triggers a re-fetch.
  // project_members has no mutable columns besides its PK pair, so UPDATE
  // isn't meaningful here — only INSERT/DELETE matter. Without this, a
  // user newly added to a project by Super-Admin sees no sidebar entry
  // (and ProjectGuard would even redirect them away) until a full reload.
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('project-memberships')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_members', filter: `user_id=eq.${user.id}` }, () => void load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'project_members', filter: `user_id=eq.${user.id}` }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user, load])

  return { memberships, loading }
}
