import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { DataAgentFolderList } from './folders/DataAgentFolderList'
import { DataAgentWorkspaceSwitcher } from './workspace/DataAgentWorkspaceSwitcher'

// Deliberately no "New Migration" button here — a migration always
// belongs to one project (GHL connection), so the only correct flow is
// Project first, then New Migration from inside that project
// (DataAgentFolderPage). A top-level shortcut here, above the project
// list, previously made it look like migrations could start before a
// project existed, which was genuinely confusing (and for a workspace
// with no project yet, it just opened a dead-end modal anyway). "+ New
// Project" (inside DataAgentFolderList, Admin-only) is the one and only
// starting point now.
export function DataAgentPage() {
  const { user } = useAuth()
  const [workspace, setWorkspace] = useState(user?.sub_account ?? '')

  useEffect(() => { setWorkspace(user?.sub_account ?? '') }, [user?.sub_account])

  if (!user?.sub_account) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Data Agent</h1>
        <DataAgentWorkspaceSwitcher ownSubAccount={user.sub_account} selected={workspace} onChange={setWorkspace} />
      </div>
      {/* Each GHL connection is its own project folder — see
          DataAgentFolderList's own comment for why this replaced a single
          shared dashboard. */}
      <DataAgentFolderList subAccount={workspace} />
    </div>
  )
}
