import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface SubAccountRow { code: string; company_name: string }
interface EntitlementRow { sub_account: string; enabled: boolean }

export function DataAgentEntitlementsTab() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<SubAccountRow[]>([])
  const [entitled, setEntitled] = useState<Record<string, boolean>>({})
  const [busyCode, setBusyCode] = useState<string | null>(null)

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
    await supabase.from('data_agent_entitlements').upsert({
      sub_account: code, enabled: next, enabled_by: user?.id, enabled_at: new Date().toISOString(),
    })
    setEntitled(prev => ({ ...prev, [code]: next }))
    setBusyCode(null)
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">
        Toggle Data Agent access per sub-account. This is a manual grant, independent of their subscription plan.
      </p>
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
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
    </div>
  )
}
