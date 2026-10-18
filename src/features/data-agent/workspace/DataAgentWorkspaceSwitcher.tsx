import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface Props { ownSubAccount: string; selected: string; onChange: (subAccount: string) => void }

export function DataAgentWorkspaceSwitcher({ ownSubAccount, selected, onChange }: Props) {
  const [clients, setClients] = useState<string[]>([])

  useEffect(() => {
    void supabase.from('data_agent_provider_clients').select('client_sub_account').eq('provider_sub_account', ownSubAccount)
      .then(({ data, error }) => {
        // A failed fetch degrades safely either way (no switcher shown,
        // same as "no clients" — never a misleading success signal), but
        // logging it keeps a real outage from looking identical to a
        // provider simply having no clients.
        if (error) { console.error('Could not load Data Agent workspace clients:', error); return }
        setClients(((data ?? []) as { client_sub_account: string }[]).map(c => c.client_sub_account))
      })
  }, [ownSubAccount])

  if (clients.length === 0) return null

  return (
    <select aria-label="Workspace" value={selected} onChange={e => onChange(e.target.value)} className="input text-sm">
      <option value={ownSubAccount}>My workspace ({ownSubAccount})</option>
      {clients.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}
