import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { KPIAdminPanel } from './KPIAdminPanel'
import { KPIStaffView } from './KPIStaffView'

export function KPIsPage() {
  const { user } = useAuth()
  const [showTeam, setShowTeam] = useState(false)

  const canManageTeam = user?.role === 'Manager' || user?.role === 'Admin' || user?.role === 'Super-Admin'

  return (
    <div className="space-y-5">

      {/* Header — identical for all roles */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {canManageTeam && showTeam ? 'Team KPIs' : 'My KPIs'}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {canManageTeam && showTeam
              ? 'Configure KPI metrics, duties, checklists and review team EOD reports.'
              : 'Your daily checklist, duties, and end-of-day report.'}
          </p>
        </div>

        {/* Only Admin / Manager see this button — Staff see nothing here */}
        {canManageTeam && (
          <button
            onClick={() => setShowTeam(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
              showTeam
                ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'
                : 'bg-white text-violet-700 border-violet-300 hover:bg-violet-50'
            }`}
          >
            {showTeam ? '← My KPI' : '👥 Manage Team KPIs'}
          </button>
        )}
      </div>

      {/* Content — KPIStaffView is the default for ALL roles */}
      {canManageTeam && showTeam
        ? <KPIAdminPanel />
        : <KPIStaffView />
      }

    </div>
  )
}
