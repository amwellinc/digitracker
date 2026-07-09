import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { KPI, KPIDailyLog, KPIMetric, User } from '@/types'

type Tab = 'metrics' | 'duties' | 'checklist' | 'logs'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'metrics',   label: 'KPI Metrics',  icon: '📊' },
  { id: 'duties',    label: 'Job Duties',    icon: '📋' },
  { id: 'checklist', label: 'Checklist',     icon: '✅' },
  { id: 'logs',      label: 'Daily Logs',    icon: '📅' },
]

const PERIODS = ['daily', 'weekly', 'monthly'] as const
type Period = typeof PERIODS[number]

type MetricForm = { name: string; target: string; unit: string; period: Period }
const EMPTY_METRIC: MetricForm = { name: '', target: '', unit: '', period: 'daily' }

function pct(actual: number, target: number) {
  return target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function KPIAdminPanel() {
  const { user } = useAuth()

  const [members, setMembers]           = useState<User[]>([])
  const [search, setSearch]             = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [kpiConfig, setKpiConfig]       = useState<KPI | null>(null)
  const [loadingKpi, setLoadingKpi]     = useState(false)
  const [tab, setTab]                   = useState<Tab>('metrics')
  const [saving, setSaving]             = useState(false)

  // Metrics tab
  const [newMetric, setNewMetric]       = useState(EMPTY_METRIC)
  const [editId, setEditId]             = useState<string | null>(null)
  const [editMetric, setEditMetric]     = useState(EMPTY_METRIC)

  // Duties / checklist tabs
  const [newDuty, setNewDuty]           = useState('')
  const [newCheck, setNewCheck]         = useState('')

  // Logs tab
  const [logs, setLogs]                 = useState<KPIDailyLog[]>([])
  const [logsLoading, setLogsLoading]   = useState(false)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)

  const dutyRef  = useRef<HTMLInputElement>(null)
  const checkRef = useRef<HTMLInputElement>(null)

  // Load team
  useEffect(() => {
    if (!user) return
    void supabase.from('users').select('*').eq('sub_account', user.sub_account).order('name')
      .then(({ data }) => {
        const m = (data ?? []) as User[]
        setMembers(m)
        if (!selectedUserId && m.length > 0) setSelectedUserId(m[0].id)
      })
  }, [user])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load KPI config when selected user changes
  useEffect(() => {
    if (!selectedUserId) return
    setLoadingKpi(true)
    setKpiConfig(null)
    setTab('metrics')
    void supabase.from('kpis').select('*').eq('user_id', selectedUserId).maybeSingle()
      .then(({ data }) => {
        setKpiConfig(data as KPI ?? null)
        setLoadingKpi(false)
      })
  }, [selectedUserId])

  // Load logs when switching to logs tab
  useEffect(() => {
    if (tab !== 'logs' || !selectedUserId) return
    setLogsLoading(true)
    void supabase.from('kpi_daily_logs').select('*')
      .eq('user_id', selectedUserId)
      .order('date', { ascending: false }).limit(30)
      .then(({ data }) => {
        setLogs((data ?? []) as KPIDailyLog[])
        setLogsLoading(false)
      })
  }, [tab, selectedUserId])

  async function saveConfig(updates: Partial<Pick<KPI, 'kpi_items' | 'duties' | 'checklists'>>) {
    setSaving(true)
    const payload = {
      user_id: selectedUserId,
      kpi_items:  kpiConfig?.kpi_items  ?? [],
      duties:     kpiConfig?.duties     ?? [],
      checklists: kpiConfig?.checklists ?? [],
      ...updates,
      updated_at: new Date().toISOString(),
    }
    const { data } = await supabase.from('kpis')
      .upsert(payload, { onConflict: 'user_id' })
      .select().single()
    if (data) setKpiConfig(data as KPI)
    setSaving(false)
  }

  // Metrics
  async function addMetric() {
    if (!newMetric.name.trim() || !newMetric.target) return
    const item: KPIMetric = {
      id: crypto.randomUUID(),
      name: newMetric.name.trim(),
      target: Number(newMetric.target),
      unit: newMetric.unit.trim() || 'units',
      period: newMetric.period,
    }
    await saveConfig({ kpi_items: [...(kpiConfig?.kpi_items ?? []), item] })
    setNewMetric(EMPTY_METRIC)
  }

  function startEdit(m: KPIMetric) {
    setEditId(m.id)
    setEditMetric({ name: m.name, target: String(m.target), unit: m.unit, period: m.period })
  }

  async function saveEdit() {
    if (!editId || !editMetric.name.trim() || !editMetric.target) return
    const updated = (kpiConfig?.kpi_items ?? []).map(m =>
      m.id === editId
        ? { ...m, name: editMetric.name.trim(), target: Number(editMetric.target), unit: editMetric.unit.trim() || 'units', period: editMetric.period }
        : m
    )
    await saveConfig({ kpi_items: updated })
    setEditId(null)
  }

  async function deleteMetric(id: string) {
    if (!window.confirm('Remove this KPI metric?')) return
    await saveConfig({ kpi_items: (kpiConfig?.kpi_items ?? []).filter(m => m.id !== id) })
  }

  // Duties
  async function addDuty(e: React.KeyboardEvent | React.MouseEvent) {
    if ('key' in e && e.key !== 'Enter') return
    if (!newDuty.trim()) return
    await saveConfig({ duties: [...(kpiConfig?.duties ?? []), newDuty.trim()] })
    setNewDuty('')
    dutyRef.current?.focus()
  }

  async function deleteDuty(i: number) {
    await saveConfig({ duties: (kpiConfig?.duties ?? []).filter((_, j) => j !== i) })
  }

  // Checklist
  async function addCheckItem(e: React.KeyboardEvent | React.MouseEvent) {
    if ('key' in e && e.key !== 'Enter') return
    if (!newCheck.trim()) return
    await saveConfig({ checklists: [...(kpiConfig?.checklists ?? []), newCheck.trim()] })
    setNewCheck('')
    checkRef.current?.focus()
  }

  async function deleteCheckItem(i: number) {
    await saveConfig({ checklists: (kpiConfig?.checklists ?? []).filter((_, j) => j !== i) })
  }

  const selectedUser = members.find(m => m.id === selectedUserId)
  const filteredMembers = members.filter(m => {
    const q = search.toLowerCase()
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  })

  return (
    <div className="flex gap-5">
      {/* Left: team member list */}
      <div className="w-64 flex-shrink-0">
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          <div className="p-3 border-b border-gray-100">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search team…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredMembers.map(m => (
              <button key={m.id} onClick={() => setSelectedUserId(m.id)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                  selectedUserId === m.id ? 'bg-violet-50 border-l-2 border-l-violet-600 pl-3' : ''
                }`}>
                <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {m.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                  <p className="text-[11px] text-gray-400 truncate">{m.role}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: KPI editor */}
      <div className="flex-1 min-w-0">
        {!selectedUser ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">
            Select a team member to manage their KPIs
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selected user badge */}
            <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-700 text-sm font-bold flex items-center justify-center flex-shrink-0">
                {selectedUser.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{selectedUser.name}</p>
                <p className="text-xs text-gray-400">{selectedUser.email} · {selectedUser.role}</p>
              </div>
              {saving && <span className="ml-auto text-xs text-violet-500 animate-pulse">Saving…</span>}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {loadingKpi ? (
              <div className="flex justify-center py-16">
                <div className="w-7 h-7 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

                {/* ─── METRICS TAB ─── */}
                {tab === 'metrics' && (
                  <div>
                    {(kpiConfig?.kpi_items ?? []).length === 0 ? (
                      <div className="px-6 py-10 text-center text-gray-400">
                        <span className="text-4xl">📊</span>
                        <p className="mt-2 text-sm font-medium">No KPI metrics yet</p>
                        <p className="text-xs mt-1">Add the first metric below</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {(kpiConfig?.kpi_items ?? []).map(m => (
                          <div key={m.id} className="px-5 py-3">
                            {editId === m.id ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <input value={editMetric.name} onChange={e => setEditMetric(p => ({ ...p, name: e.target.value }))}
                                  placeholder="Name" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                <input type="number" value={editMetric.target} onChange={e => setEditMetric(p => ({ ...p, target: e.target.value }))}
                                  placeholder="Target" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                <input value={editMetric.unit} onChange={e => setEditMetric(p => ({ ...p, unit: e.target.value }))}
                                  placeholder="Unit" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                <select value={editMetric.period} onChange={e => setEditMetric(p => ({ ...p, period: e.target.value as Period }))}
                                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                                  {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <button onClick={saveEdit} className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700">Save</button>
                                <button onClick={() => setEditId(null)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5">Cancel</button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div>
                                    <p className="font-medium text-gray-900">{m.name}</p>
                                    <p className="text-xs text-gray-400">Target: <span className="font-semibold text-gray-700">{m.target} {m.unit}</span> · {m.period}</p>
                                  </div>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    m.period === 'daily' ? 'bg-blue-50 text-blue-700' :
                                    m.period === 'weekly' ? 'bg-violet-50 text-violet-700' :
                                    'bg-amber-50 text-amber-700'
                                  }`}>{m.period}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => startEdit(m)} className="text-xs text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-2.5 py-1">Edit</button>
                                  <button onClick={() => void deleteMetric(m.id)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2.5 py-1">Del</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add metric form */}
                    <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Add KPI Metric</p>
                      <div className="flex flex-wrap gap-2">
                        <input value={newMetric.name} onChange={e => setNewMetric(p => ({ ...p, name: e.target.value }))}
                          placeholder="KPI name (e.g. Sales)" className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                        <input type="number" value={newMetric.target} onChange={e => setNewMetric(p => ({ ...p, target: e.target.value }))}
                          placeholder="Target" className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                        <input value={newMetric.unit} onChange={e => setNewMetric(p => ({ ...p, unit: e.target.value }))}
                          placeholder="Unit (e.g. orders)" className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                        <select value={newMetric.period} onChange={e => setNewMetric(p => ({ ...p, period: e.target.value as Period }))}
                          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                          {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button onClick={addMetric} disabled={!newMetric.name.trim() || !newMetric.target || saving}
                          className="bg-violet-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-40">
                          + Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── DUTIES TAB ─── */}
                {tab === 'duties' && (
                  <div>
                    {(kpiConfig?.duties ?? []).length === 0 ? (
                      <div className="px-6 py-10 text-center text-gray-400">
                        <span className="text-4xl">📋</span>
                        <p className="mt-2 text-sm font-medium">No job duties yet</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {(kpiConfig?.duties ?? []).map((duty, i) => (
                          <div key={i} className="flex items-start gap-3 px-5 py-3">
                            <span className="text-xs font-bold text-gray-400 mt-0.5 w-5 text-right flex-shrink-0">{i + 1}.</span>
                            <p className="flex-1 text-sm text-gray-800">{duty}</p>
                            <button onClick={() => void deleteDuty(i)} className="text-gray-300 hover:text-red-500 text-sm flex-shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 flex gap-2">
                      <input ref={dutyRef} value={newDuty} onChange={e => setNewDuty(e.target.value)}
                        onKeyDown={e => void addDuty(e)}
                        placeholder="Add a job duty (press Enter)…"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                      <button onClick={e => void addDuty(e)} disabled={!newDuty.trim() || saving}
                        className="bg-violet-600 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-40">
                        + Add
                      </button>
                    </div>
                  </div>
                )}

                {/* ─── CHECKLIST TAB ─── */}
                {tab === 'checklist' && (
                  <div>
                    {(kpiConfig?.checklists ?? []).length === 0 ? (
                      <div className="px-6 py-10 text-center text-gray-400">
                        <span className="text-4xl">✅</span>
                        <p className="mt-2 text-sm font-medium">No checklist items yet</p>
                        <p className="text-xs mt-1">Users tick these off in their daily update</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {(kpiConfig?.checklists ?? []).map((item, i) => (
                          <div key={i} className="flex items-center gap-3 px-5 py-3">
                            <span className="text-gray-300 text-base flex-shrink-0">☐</span>
                            <p className="flex-1 text-sm text-gray-800">{item}</p>
                            <button onClick={() => void deleteCheckItem(i)} className="text-gray-300 hover:text-red-500 text-sm flex-shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 flex gap-2">
                      <input ref={checkRef} value={newCheck} onChange={e => setNewCheck(e.target.value)}
                        onKeyDown={e => void addCheckItem(e)}
                        placeholder="Add a checklist item (press Enter)…"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                      <button onClick={e => void addCheckItem(e)} disabled={!newCheck.trim() || saving}
                        className="bg-violet-600 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-40">
                        + Add
                      </button>
                    </div>
                  </div>
                )}

                {/* ─── DAILY LOGS TAB ─── */}
                {tab === 'logs' && (
                  <div>
                    {logsLoading ? (
                      <div className="flex justify-center py-16">
                        <div className="w-7 h-7 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : logs.length === 0 ? (
                      <div className="px-6 py-10 text-center text-gray-400">
                        <span className="text-4xl">📅</span>
                        <p className="mt-2 text-sm font-medium">No daily updates submitted yet</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {logs.map(log => {
                          const expanded = expandedLogId === log.id
                          const checkItems  = kpiConfig?.checklists ?? []
                          const doneBools   = Array.isArray(log.checklist_done) ? log.checklist_done as boolean[] : []
                          const doneCount   = doneBools.filter(Boolean).length
                          const totalItems  = checkItems.length
                          const metrics     = kpiConfig?.kpi_items ?? []
                          return (
                            <div key={log.id}>
                              <button onClick={() => setExpandedLogId(expanded ? null : log.id)}
                                className="w-full text-left px-5 py-3 hover:bg-gray-50 flex items-center gap-4 transition-colors">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <span className="font-medium text-gray-900 text-sm">{fmtDate(log.date)}</span>
                                    <span className="text-xs text-gray-400">
                                      Submitted {new Date(log.submitted_at).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                    </span>
                                    {totalItems > 0 && (
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${doneCount === totalItems ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                                        ☑ {doneCount}/{totalItems} done
                                      </span>
                                    )}
                                  </div>
                                  {metrics.length > 0 && (
                                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                                      {metrics.map(m => {
                                        const actual = (log.metric_actuals as Record<string, number>)[m.id]
                                        return actual != null ? `${m.name}: ${actual}/${m.target} (${pct(actual, m.target)}%)` : `${m.name}: —`
                                      }).join(' · ')}
                                    </p>
                                  )}
                                </div>
                                <span className="text-gray-400 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
                              </button>

                              {expanded && (
                                <div className="px-5 pb-4 pt-1 bg-gray-50 space-y-4">
                                  {metrics.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">KPI Actuals</p>
                                      <div className="grid grid-cols-2 gap-2">
                                        {metrics.map(m => {
                                          const actual = (log.metric_actuals as Record<string, number>)[m.id]
                                          const p = actual != null ? pct(actual, m.target) : 0
                                          return (
                                            <div key={m.id} className="bg-white rounded-lg px-3 py-2 border border-gray-200">
                                              <div className="flex items-center justify-between mb-1">
                                                <p className="text-xs font-medium text-gray-700">{m.name}</p>
                                                <p className={`text-xs font-bold ${p >= 100 ? 'text-green-600' : p >= 70 ? 'text-violet-600' : 'text-amber-600'}`}>
                                                  {actual != null ? `${actual}/${m.target}` : '—'}
                                                </p>
                                              </div>
                                              {actual != null && (
                                                <div className="h-1.5 bg-gray-100 rounded-full">
                                                  <div className={`h-full rounded-full ${p >= 100 ? 'bg-green-500' : p >= 70 ? 'bg-violet-500' : 'bg-amber-400'}`}
                                                    style={{ width: `${p}%` }} />
                                                </div>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {checkItems.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Checklist</p>
                                      <div className="space-y-1">
                                        {checkItems.map((item, i) => (
                                          <div key={i} className="flex items-center gap-2 text-sm">
                                            <span className={doneBools[i] ? 'text-green-500' : 'text-gray-300'}>{doneBools[i] ? '☑' : '☐'}</span>
                                            <span className={doneBools[i] ? 'text-gray-700' : 'text-gray-400'}>{item}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {log.notes && (
                                    <div>
                                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                                      <p className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2">{log.notes}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
