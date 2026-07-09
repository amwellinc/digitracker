import { useAuth } from '@/hooks/useAuth'
import { KPIAdminPanel } from './KPIAdminPanel'
import { KPIStaffView } from './KPIStaffView'

export function KPIsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'Super-admin' || user?.role === 'Manager'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">KPIs</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {canManage
            ? 'Set KPI metrics, job duties, and checklists per team member. Review daily submissions.'
            : 'View your KPIs, duties, and submit your daily update before clocking out.'}
        </p>
      </div>
      {canManage ? <KPIAdminPanel /> : <KPIStaffView />}
    </div>
  )
}
