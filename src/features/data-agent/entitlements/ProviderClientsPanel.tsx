import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface SubAccountRow { code: string; company_name: string }
interface RelationshipRow { provider_sub_account: string; client_sub_account: string }

export function ProviderClientsPanel() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<SubAccountRow[]>([])
  const [relationships, setRelationships] = useState<RelationshipRow[]>([])
  const [provider, setProvider] = useState('')
  const [client, setClient] = useState('')
  const [panelError, setPanelError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('data_agent_provider_clients').select('provider_sub_account, client_sub_account').order('provider_sub_account')
    if (error) { setPanelError('Could not load existing service-provider relationships.'); return }
    setRelationships((data ?? []) as RelationshipRow[])
  }, [])

  useEffect(() => {
    void supabase.from('sub_accounts').select('code, company_name').order('company_name')
      .then(({ data, error }) => {
        if (error) { setPanelError('Could not load sub-accounts.'); return }
        setAccounts((data ?? []) as SubAccountRow[])
      })
    void load()
  }, [load])

  // This grants cross-tenant CRM access — a silent failure here (e.g. the
  // acting user somehow isn't actually Super-Admin, caught by RLS; or the
  // relationship already exists, caught by the primary key) must surface,
  // not look identical to a successful grant with nothing to show for it.
  // added_by records who granted it — the only audit trail this
  // cross-tenant access right has (there is no history table; a revoke is
  // a hard delete), so it must never be left null.
  async function grant() {
    if (!provider || !client || provider === client || busy) return
    setBusy(true); setPanelError(null)
    const { error } = await supabase.from('data_agent_provider_clients').insert({ provider_sub_account: provider, client_sub_account: client, added_by: user?.id ?? null })
    setBusy(false)
    if (error) { setPanelError('Could not grant this relationship — it may already exist.'); return }
    await load()
  }

  async function revoke(r: RelationshipRow) {
    if (busy) return
    setBusy(true); setPanelError(null)
    const { error } = await supabase.from('data_agent_provider_clients').delete().eq('provider_sub_account', r.provider_sub_account).eq('client_sub_account', r.client_sub_account)
    setBusy(false)
    if (error) { setPanelError('Could not revoke this relationship.'); return }
    await load()
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Let one sub-account run Data Agent migrations for another's CRM, as a managed service. The client keeps owning its own GHL connection.
      </p>
      {panelError && <p role="alert" className="text-sm text-red-600">{panelError}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="pc-provider" className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
          <select id="pc-provider" aria-label="provider" value={provider} onChange={e => setProvider(e.target.value)} className="input">
            <option value="">Choose…</option>
            {accounts.map(a => <option key={a.code} value={a.code}>{a.company_name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pc-client" className="block text-xs font-medium text-gray-600 mb-1">Client</label>
          <select id="pc-client" aria-label="client" value={client} onChange={e => setClient(e.target.value)} className="input">
            <option value="">Choose…</option>
            {accounts.map(a => <option key={a.code} value={a.code}>{a.company_name}</option>)}
          </select>
        </div>
        <button onClick={() => void grant()} disabled={busy} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-3 py-2">
          Grant
        </button>
      </div>
      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
        {relationships.map(r => (
          <li key={`${r.provider_sub_account}-${r.client_sub_account}`} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>{r.provider_sub_account} → {r.client_sub_account}</span>
            <button onClick={() => void revoke(r)} disabled={busy} className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">Revoke</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
