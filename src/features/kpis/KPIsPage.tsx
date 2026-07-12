import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { KPIAdminPanel } from './KPIAdminPanel'
import { KPIStaffView } from './KPIStaffView'

type ManagerTab = 'my-kpi' | 'team-kpi'

export function KPIsPage() {
  const { user } = useAuth()
  const [managerTab, setManagerTab] = useState<ManagerTab>('my-kpi')

  const isManager    = user?.role === 'Manager'
  const isAdminLevel = user?.role === 'Admin' || user?.role === 'Super-Admin'

  if (isAdminLevel) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">KPIs</h2>
          <p className="text-sm text-gray-500 mt-0.5">Set KPI metrics, duties, checklists and review EOD reports per team member.</p>
        </div>
        <KPIAdminPanel />
      </div>
    )
  }

  if (isManager) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">KPIs</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {managerTab === 'my-kpi' ? 'Your daily checklist, duties, and EOD report.' : 'Review and manage your team\'s KPIs and performance.'}
            </p>
          </div>
          {/* Tab switcher */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setManagerTab('my-kpi')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                managerTab === 'my-kpi'
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              My KPI
            </button>
            <button
              onClick={() => setManagerTab('team-kpi')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                managerTab === 'team-kpi'
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              My Team KPI
            </button>
          </div>
        </div>

        {managerTab === 'my-kpi'  && <KPIStaffView />}
        {managerTab === 'team-kpi' && <KPIAdminPanel />}
      </div>
    )
  }

  // Staff
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">KPIs</h2>
        <p className="text-sm text-gray-500 mt-0.5">Your daily checklist, duties, and end-of-day report.</p>
      </div>
      <KPIStaffView />
    </div>
  )
}
