import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { ProfileTab } from './ProfileTab'
import { AccountTab } from './AccountTab'
import { AppearanceTab } from './AppearanceTab'
import { UsersTab } from './UsersTab'
import { SubscriptionTab } from './SubscriptionTab'

type TabId = 'profile' | 'account' | 'appearance' | 'users' | 'subscription'

export function SettingsPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>('profile')

  const isSuperAdmin = user?.role === 'Super-admin'

  const tabs: { id: TabId; label: string }[] = [
    { id: 'profile',      label: 'My Profile' },
    { id: 'account',      label: 'Account' },
    { id: 'appearance',   label: 'Appearance' },
    ...(isSuperAdmin
      ? [
          { id: 'users' as TabId,        label: 'Users & Roles' },
          { id: 'subscription' as TabId, label: 'Subscription' },
        ]
      : []),
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account preferences and user roles.
        </p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
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

      {activeTab === 'profile'      && <ProfileTab />}
      {activeTab === 'account'      && <AccountTab />}
      {activeTab === 'appearance'   && <AppearanceTab />}
      {activeTab === 'users'        && isSuperAdmin && <UsersTab />}
      {activeTab === 'subscription' && isSuperAdmin && <SubscriptionTab />}
    </div>
  )
}
