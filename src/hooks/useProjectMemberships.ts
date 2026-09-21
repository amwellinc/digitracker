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

  return { memberships, loading }
}
