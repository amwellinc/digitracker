import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { NewMigrationModal } from './upload/NewMigrationModal'
import { DataAgentDashboard } from './dashboard/DataAgentDashboard'
import { DataAgentWorkspaceSwitcher } from './workspace/DataAgentWorkspaceSwitcher'

export function DataAgentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [workspace, setWorkspace] = useState(user?.sub_account ?? '')

  useEffect(() => { setWorkspace(user?.sub_account ?? '') }, [user?.sub_account])

  if (!user?.sub_account) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Data Agent</h1>
        <div className="flex items-center gap-2">
          <DataAgentWorkspaceSwitcher ownSubAccount={user.sub_account} selected={workspace} onChange={setWorkspace} />
          <button onClick={() => setShowNew(true)} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
            New Migration
          </button>
        </div>
      </div>
      <DataAgentDashboard subAccount={workspace} />
      {showNew && (
        <NewMigrationModal
          subAccount={workspace}
          onClose={() => setShowNew(false)}
          onCreated={migrationId => navigate(`/data-agent/migrations/${migrationId}`)}
        />
      )}
    </div>
  )
}
