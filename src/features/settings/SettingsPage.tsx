import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { ProfileTab } from './ProfileTab'
import { AccountTab } from './AccountTab'
import { AppearanceTab } from './AppearanceTab'
import { UsersTab } from './UsersTab'
import { SubscriptionTab } from './SubscriptionTab'
import { SecurityTab } from './SecurityTab'
import { BankDetailsTab } from './BankDetailsTab'
import { PayrollTab } from './PayrollTab'
import { ArchiveTab } from './ArchiveTab'
import { GHLIntegrationTab } from '@/features/ghl/GHLIntegrationTab'

type TabId = 'profile' | 'account' | 'appearance' | 'security' | 'bank' | 'payroll' | 'users' | 'subscription' | 'ghl' | 'archive'

export function SettingsPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>('profile')

  const isAdmin = user?.role === 'Admin'

  const personalTabs: { id: TabId; label: string }[] = [
    { id: 'profile',    label: 'My Profile' },
    { id: 'account',    label: 'Account' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'security',   label: '🔒 Security' },
    { id: 'bank',       label: '🏦 Bank Details' },
    { id: 'payroll',    label: '💰 Payroll' },
  ]

  const businessTabs: { id: TabId; label: string }[] = [
    { id: 'users',        label: 'Users & Roles' },
    { id: 'subscription', label: 'Subscription' },
    { id: 'ghl',          label: '🔗 DIGI5Y-CRM Integration' },
    { id: 'archive',      label: '🗄 Archive' },
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account preferences and user roles.
        </p>
      </div>

      <div className="mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Personal Settings</p>
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-1 sm:gap-4 overflow-x-auto scrollbar-hide pb-px">
            {personalTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'border-violet-600 text-violet-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {isAdmin && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Business Settings</p>
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex gap-1 sm:gap-4 overflow-x-auto scrollbar-hide pb-px">
              {businessTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                    activeTab === tab.id
                      ? 'border-violet-600 text-violet-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {activeTab === 'profile'      && <ProfileTab />}
      {activeTab === 'account'      && <AccountTab />}
      {activeTab === 'appearance'   && <AppearanceTab />}
      {activeTab === 'security'     && <SecurityTab />}
      {activeTab === 'bank'         && <BankDetailsTab />}
      {activeTab === 'payroll'      && <PayrollTab />}
      {activeTab === 'users'        && isAdmin && <UsersTab />}
      {activeTab === 'subscription' && isAdmin && <SubscriptionTab />}
      {activeTab === 'ghl'          && isAdmin && <GHLIntegrationTab />}
      {activeTab === 'archive'      && isAdmin && <ArchiveTab />}
    </div>
  )
}
