import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { ProviderClientsPanel } from './ProviderClientsPanel'

interface SubAccountRow { code: string; company_name: string }
interface EntitlementRow { sub_account: string; enabled: boolean }

export function DataAgentEntitlementsTab() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<SubAccountRow[]>([])
  const [entitled, setEntitled] = useState<Record<string, boolean>>({})
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: accs }, { data: ents }] = await Promise.all([
      supabase.from('sub_accounts').select('code, company_name').order('company_name'),
      supabase.from('data_agent_entitlements').select('sub_account, enabled').order('sub_account'),
    ])
    setAccounts((accs ?? []) as SubAccountRow[])
    const map: Record<string, boolean> = {}
    for (const e of (ents ?? []) as EntitlementRow[]) map[e.sub_account] = e.enabled
    setEntitled(map)
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggle(code: string, next: boolean) {
    setBusyCode(code)
    setErrorMsg(null)
    const { error } = await supabase.from('data_agent_entitlements').upsert({
      sub_account: code, enabled: next, enabled_by: user?.id, enabled_at: new Date().toISOString(),
    })
    setBusyCode(null)
    if (error) { setErrorMsg(`Could not update ${code}: ${error.message}`); return }
    setEntitled(prev => ({ ...prev, [code]: next }))
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">
        Toggle Data Agent access per sub-account. This is a manual grant, independent of their subscription plan.
      </p>
      <div data-testid="data-agent-entitlements-list" className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
        {accounts.map(a => (
          <label key={a.code} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{a.company_name} <span className="text-gray-400 font-mono text-xs">{a.code}</span></span>
            <input
              type="checkbox"
              checked={Boolean(entitled[a.code])}
              disabled={busyCode === a.code}
              onChange={e => void toggle(a.code, e.target.checked)}
              className="w-4 h-4 accent-violet-600"
            />
          </label>
        ))}
      </div>
      {errorMsg && <p role="alert" className="text-sm text-red-600">{errorMsg}</p>}
      <div className="pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Service Providers</h4>
        <ProviderClientsPanel />
      </div>
    </div>
  )
}
