import { useParams } from 'react-router-dom'

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  return <div className="text-sm text-gray-500">Loading project {projectId}…</div>
}
