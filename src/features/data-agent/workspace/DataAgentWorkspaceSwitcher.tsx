import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface Props { ownSubAccount: string; selected: string; onChange: (subAccount: string) => void; isSuperAdmin?: boolean }

export function DataAgentWorkspaceSwitcher({ ownSubAccount, selected, onChange, isSuperAdmin }: Props) {
  const [otherAccounts, setOtherAccounts] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      // A Super-Admin already has blanket Data Agent access to every
      // entitled sub-account via is_data_agent_member — data_agent_
      // provider_clients is an AGENCY's own client-relationship list, a
      // narrower business-relationship mechanism meant for a regular
      // Admin acting as a managed service provider for specific clients.
      // Restricting a Super-Admin's switcher to that same list meant a
      // platform Super-Admin could have no way to reach a given
      // sub-account's Data Agent workspace at all unless someone had
      // separately set up a provider-client row — found live: a
      // Super-Admin on AM333 International's own staff couldn't switch
      // into AM333's Data Agent to create a project.
      if (isSuperAdmin) {
        const { data, error } = await supabase.from('data_agent_entitlements').select('sub_account').eq('enabled', true)
        if (error) { console.error('Could not load Data Agent workspace list:', error); return }
        setOtherAccounts(((data ?? []) as { sub_account: string }[]).map(r => r.sub_account).filter(a => a !== ownSubAccount))
        return
      }
      const { data, error } = await supabase.from('data_agent_provider_clients').select('client_sub_account').eq('provider_sub_account', ownSubAccount)
      // A failed fetch degrades safely either way (no switcher shown,
      // same as "no clients" — never a misleading success signal), but
      // logging it keeps a real outage from looking identical to a
      // provider simply having no clients.
      if (error) { console.error('Could not load Data Agent workspace list:', error); return }
      setOtherAccounts(((data ?? []) as { client_sub_account: string }[]).map(r => r.client_sub_account))
    }
    void load()
  }, [ownSubAccount, isSuperAdmin])

  if (otherAccounts.length === 0) return null

  return (
    <select aria-label="Workspace" value={selected} onChange={e => onChange(e.target.value)} className="input text-sm">
      <option value={ownSubAccount}>My workspace ({ownSubAccount})</option>
      {otherAccounts.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}
