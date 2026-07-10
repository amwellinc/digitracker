import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { MyLeaveTab } from './MyLeaveTab'
import { ManageLeaveTab } from './ManageLeaveTab'
import { RequestLeaveModal } from './RequestLeaveModal'

export function LeavePage() {
  const { user } = useAuth()
  const canManage = user?.role === 'Admin' || user?.role === 'Manager' || user?.role === 'Super-Admin'
  const [activeTab, setActiveTab] = useState<'my' | 'manage'>('my')
  const [showModal, setShowModal] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  function handleSuccess() {
    setRefreshTick(t => t + 1)
  }

  const tabs = [
    { id: 'my' as const, label: 'My Leave' },
    ...(canManage ? [{ id: 'manage' as const, label: 'Manage Team Leave' }] : []),
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Leave & Time Off</h2>
          <p className="text-sm text-gray-500 mt-0.5">Track and manage leave requests</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-violet-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-violet-700 transition-colors self-start sm:self-auto"
          style={{ minHeight: '44px' }}
        >
          + Request Leave
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-hide">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.id
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'my' && (
        <MyLeaveTab onRequest={() => setShowModal(true)} refreshTick={refreshTick} />
      )}
      {activeTab === 'manage' && canManage && <ManageLeaveTab />}

      {showModal && (
        <RequestLeaveModal
          onClose={() => setShowModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
