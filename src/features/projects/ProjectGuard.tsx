import type { ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useProjectMemberships } from '@/hooks/useProjectMemberships'

interface Props {
  children: ReactNode
}

export function ProjectGuard({ children }: Props) {
  const { projectId } = useParams<{ projectId: string }>()
  const { memberships, loading } = useProjectMemberships()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isMember = memberships.some(m => m.id === projectId)
  if (!isMember) return <Navigate to="/" replace />

  return <>{children}</>
}
