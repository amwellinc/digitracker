import { useState } from 'react'
import { PlatformDashboard } from './PlatformDashboard'
import { PlatformSubscriptionsTab } from './PlatformSubscriptionsTab'
import { PlansAndPricingTab } from './PlansAndPricingTab'
import { StripePaymentsTab } from './StripePaymentsTab'
import { PlatformSettingsTab } from './PlatformSettingsTab'

type TabId = 'dashboard' | 'subscriptions' | 'plans' | 'payments' | 'settings'

export function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'dashboard',     label: 'Dashboard',          icon: '📊' },
    { id: 'subscriptions', label: 'Subscriptions',       icon: '💳' },
    { id: 'plans',         label: 'Plans & Pricing',     icon: '⭐' },
    { id: 'payments',      label: 'Payments',            icon: '💰' },
    { id: 'settings',      label: 'Platform Settings',   icon: '⚙️' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Admin</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage all sub-accounts, subscriptions, and platform settings.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 bg-purple-100 text-purple-800 text-xs font-semibold px-3 py-1.5 rounded-full">
          ⭐ Super Admin
        </span>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-violet-600 text-violet-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'dashboard'     && <PlatformDashboard />}
      {activeTab === 'subscriptions' && <PlatformSubscriptionsTab />}
      {activeTab === 'plans'         && <PlansAndPricingTab />}
      {activeTab === 'payments'      && <StripePaymentsTab />}
      {activeTab === 'settings'      && <PlatformSettingsTab />}
    </div>
  )
}
