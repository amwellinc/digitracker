import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { NewMigrationModal } from './upload/NewMigrationModal'

export function DataAgentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Data Agent</h1>
        <button onClick={() => setShowNew(true)} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
          New Migration
        </button>
      </div>
      {showNew && user?.sub_account && (
        <NewMigrationModal
          subAccount={user.sub_account}
          onClose={() => setShowNew(false)}
          onCreated={migrationId => navigate(`/data-agent/migrations/${migrationId}`)}
        />
      )}
    </div>
  )
}
