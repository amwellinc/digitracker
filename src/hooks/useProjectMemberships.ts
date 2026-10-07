import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

export interface ProjectMembership {
  id: string
  name: string
}

interface ProjectRow {
  id: string
  name: string
}

export function useProjectMemberships() {
  const { user } = useAuth()
  const instanceId = useId()
  const [memberships, setMemberships] = useState<ProjectMembership[]>([])
  const [loading, setLoading] = useState(true)

  // Queries projects directly (no project_members filter) and lets
  // projects_select RLS decide what's visible, rather than filtering to
  // literal project_members rows for this user. is_project_member() --
  // the function that RLS gates on -- also grants an Admin visibility into
  // any project their own sub_account already participates in, even before
  // they're personally added as a member; filtering by user_id here would
  // silently drop those projects despite RLS allowing them.
  const load = useCallback(async () => {
    if (!user) { setMemberships([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('projects').select('id, name').order('name')

    const rows = (data ?? []) as ProjectRow[]
    setMemberships(rows.map(r => ({ id: r.id, name: r.name })))
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  // Mirrors the layout-task-count channel pattern in src/app/Layout.tsx:
  // a lightweight realtime subscription that just triggers a re-fetch.
  // project_members has no mutable columns besides its PK pair, so UPDATE
  // isn't meaningful here — only INSERT/DELETE matter. Without this, a
  // user newly added to a project by Super-Admin sees no sidebar entry
  // (and ProjectGuard would even redirect them away) until a full reload.
  //
  // This hook runs in two places at once whenever a project page is open —
  // Layout.tsx's sidebar (always mounted) and ProjectGuard (mounted on
  // /projects/:id) — so the channel name MUST be unique per hook instance
  // (via useId), not just per user. A shared/hardcoded name here means the
  // second instance's .on() call collides with the first instance's
  // already-subscribed channel and throws an uncaught "cannot add
  // postgres_changes callbacks after subscribe()" error — which, with no
  // error boundary anywhere in this app, unmounts the entire React tree
  // (a fully blank page, not just this component) the moment you open any
  // project.
  // No filter: an Admin's visibility can now come from ANY project_members
  // row that establishes their sub_account's participation, not only a row
  // naming them directly, so a user_id-scoped filter would miss the event
  // that should add/remove this project from their sidebar. The refetch
  // itself is cheap (a handful of rows), and RLS still decides what comes
  // back.
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel(`project-memberships:${instanceId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_members' }, () => void load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'project_members' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user, load, instanceId])

  return { memberships, loading }
}
