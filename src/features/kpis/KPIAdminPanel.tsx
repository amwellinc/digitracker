import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { EODRow, KPI, KPIDailyLog, KPIMetric, PerformancePoints, User } from '@/types'
import { KPIIndicators } from './KPIIndicators'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const PERIODS = ['daily', 'weekly', 'monthly'] as const
type Period = typeof PERIODS[number]
type MetricForm = { name: string; target: string; unit: string; period: Period }
const EMPTY_METRIC: MetricForm = { name: '', target: '', unit: '', period: 'daily' }

function getMonday(from?: Date): string {
  const base = from ?? new Date(); base.setHours(0, 0, 0, 0)
  const diff = base.getDay() === 0 ? -6 : 1 - base.getDay()
  const mon = new Date(base); mon.setDate(base.getDate() + diff)
  return isoDate(mon)
}

function getWeekDays(ws: string): string[] {
  const base = new Date(ws + 'T00:00:00')
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(base); d.setDate(base.getDate() + i)
    return isoDate(d)
  })
}

function shiftWeek(ws: string, n: number): string {
  const d = new Date(ws + 'T00:00:00'); d.setDate(d.getDate() + n * 7)
  return isoDate(d)
}

function weekStartOf(ds: string): string {
  const d = new Date(ds + 'T00:00:00')
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff); return isoDate(d)
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtWeekRange(ws: string) {
  const days = getWeekDays(ws)
  const from = new Date(days[0] + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
  const to   = new Date(days[4] + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${from} – ${to}`
}

function ptClr(p: number) { return p > 0 ? 'text-green-600' : p < 0 ? 'text-red-600' : 'text-gray-500' }
function ptBg(p: number) {
  if (p > 3)  return 'bg-green-100 border-green-300'
  if (p > 0)  return 'bg-green-50 border-green-200'
  if (p < -3) return 'bg-red-100 border-red-300'
  if (p < 0)  return 'bg-red-50 border-red-200'
  return 'bg-gray-50 border-gray-200'
}

// Reusable table-section panel wrapper matching the image style
function Panel({ border, children }: { border: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border-2 overflow-hidden ${border}`}>
      {children}
    </div>
  )
}

export function KPIAdminPanel() {
  const { user } = useAuth()
  const isManager = user?.role === 'Manager'

  const [members,        setMembers]        = useState<User[]>([])
  const [search,         setSearch]         = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [kpiConfig,      setKpiConfig]      = useState<KPI | null>(null)
  const [loadingKpi,     setLoadingKpi]     = useState(false)
  const [saving,         setSaving]         = useState(false)

  const [newMetric,  setNewMetric]  = useState(EMPTY_METRIC)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [editMetric, setEditMetric] = useState(EMPTY_METRIC)

  const [newDuty,  setNewDuty]  = useState('')
  const [newCheck, setNewCheck] = useState('')

  const [logs,        setLogs]        = useState<KPIDailyLog[]>([])
  const [eodViewDate, setEodViewDate] = useState('')

  const today = todayInTz(DEFAULT_TIMEZONE)
  const [selectedDate,     setSelectedDate]     = useState(today)
  const [viewWeekStart,    setViewWeekStart]    = useState(() => getMonday())
  const [memberPerfPoints, setMemberPerfPoints] = useState<PerformancePoints[]>([])
  const [draftVal,         setDraftVal]         = useState(0)
  const [draftNote,        setDraftNote]        = useState('')
  const [savingPts,        setSavingPts]        = useState(false)
  const [savedPts,         setSavedPts]         = useState(false)

  const [showMetrics, setShowMetrics] = useState(true)
  const [showPoints,  setShowPoints]  = useState(true)

  const dutyRef  = useRef<HTMLInputElement>(null)
  const checkRef = useRef<HTMLInputElement>(null)

  // Load team
  useEffect(() => {
    if (!user) return
    const q = supabase.from('users').select('*')
    const scoped = isManager ? q.eq('manager_id', user.id) : q.eq('sub_account', user.sub_account)
    void scoped.neq('role', 'Admin').neq('role', 'Super-Admin').order('name')
      .then(({ data }) => {
        const m = (data ?? []) as User[]
        setMembers(m)
        if (!selectedUserId && m.length > 0) setSelectedUserId(m[0].id)
      })
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load KPI config + EOD logs + perf points when user changes
  useEffect(() => {
    if (!selectedUserId) return
    setLoadingKpi(true); setKpiConfig(null); setLogs([]); setMemberPerfPoints([])
    setEodViewDate(''); setSelectedDate(today)
    Promise.all([
      supabase.from('kpis').select('*').eq('user_id', selectedUserId).maybeSingle(),
      supabase.from('kpi_daily_logs').select('*').eq('user_id', selectedUserId)
        .order('date', { ascending: false }).limit(30),
      supabase.from('performance_points').select('*').eq('user_id', selectedUserId)
        .order('date', { ascending: false }),
    ]).then(([{ data: kpi }, { data: logData }, { data: pts }]) => {
      setKpiConfig((kpi as KPI) ?? null)
      const logRows = (logData ?? []) as KPIDailyLog[]
      setLogs(logRows)
      setEodViewDate(logRows[0]?.date ?? today)
      setMemberPerfPoints((pts ?? []) as PerformancePoints[])
      setLoadingKpi(false)
    })
  }, [selectedUserId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync perf draft
  useEffect(() => {
    const ex = memberPerfPoints.find(p => p.date === selectedDate)
    setDraftVal(ex ? ex.points : 0); setDraftNote(ex?.notes ?? ''); setSavedPts(false)
  }, [selectedDate, memberPerfPoints])

  async function saveConfig(updates: Partial<Pick<KPI, 'kpi_items' | 'duties' | 'checklists'>>) {
    setSaving(true)
    const payload = {
      user_id:    selectedUserId,
      kpi_items:  kpiConfig?.kpi_items  ?? [],
      duties:     kpiConfig?.duties     ?? [],
      checklists: kpiConfig?.checklists ?? [],
      ...updates,
      updated_at: new Date().toISOString(),
    }
    const { data } = await supabase.from('kpis').upsert(payload, { onConflict: 'user_id' }).select().single()
    if (data) setKpiConfig(data as KPI)
    setSaving(false)
  }

  async function addMetric() {
    if (!newMetric.name.trim() || !newMetric.target) return
    const item: KPIMetric = { id: crypto.randomUUID(), name: newMetric.name.trim(), target: Number(newMetric.target), unit: newMetric.unit.trim() || 'units', period: newMetric.period }
    await saveConfig({ kpi_items: [...(kpiConfig?.kpi_items ?? []), item] })
    setNewMetric(EMPTY_METRIC)
  }

  async function saveEdit() {
    if (!editId || !editMetric.name.trim() || !editMetric.target) return
    const updated = (kpiConfig?.kpi_items ?? []).map(m =>
      m.id === editId ? { ...m, name: editMetric.name.trim(), target: Number(editMetric.target), unit: editMetric.unit.trim() || 'units', period: editMetric.period } : m
    )
    await saveConfig({ kpi_items: updated }); setEditId(null)
  }

  async function deleteMetric(id: string) {
    if (!window.confirm('Remove this KPI metric?')) return
    await saveConfig({ kpi_items: (kpiConfig?.kpi_items ?? []).filter(m => m.id !== id) })
  }

  async function addDuty(e: React.KeyboardEvent | React.MouseEvent) {
    if ('key' in e && e.key !== 'Enter') return
    if (!newDuty.trim()) return
    await saveConfig({ duties: [...(kpiConfig?.duties ?? []), newDuty.trim()] })
    setNewDuty(''); dutyRef.current?.focus()
  }

  async function deleteDuty(i: number) {
    await saveConfig({ duties: (kpiConfig?.duties ?? []).filter((_, j) => j !== i) })
  }

  async function addCheckItem(e: React.KeyboardEvent | React.MouseEvent) {
    if ('key' in e && e.key !== 'Enter') return
    if (!newCheck.trim()) return
    await saveConfig({ checklists: [...(kpiConfig?.checklists ?? []), newCheck.trim()] })
    setNewCheck(''); checkRef.current?.focus()
  }

  async function deleteCheckItem(i: number) {
    await saveConfig({ checklists: (kpiConfig?.checklists ?? []).filter((_, j) => j !== i) })
  }

  async function saveDailyPoints() {
    if (!user) return
    setSavingPts(true)
    const { data } = await supabase.from('performance_points').upsert({
      user_id: selectedUserId, manager_id: user.id, date: selectedDate,
      points: draftVal, notes: draftNote.trim() || null,
    }, { onConflict: 'user_id,date' }).select().single()
    if (data) {
      setMemberPerfPoints(prev =>
        [data as PerformancePoints, ...prev.filter(p => p.date !== selectedDate)]
          .sort((a, b) => b.date.localeCompare(a.date))
      )
    }
    setSavingPts(false); setSavedPts(true)
    setTimeout(() => setSavedPts(false), 2500)
  }

  function weekTotal(ws: string) {
    const days = new Set(getWeekDays(ws))
    return memberPerfPoints.filter(p => days.has(p.date)).reduce((s, p) => s + p.points, 0)
  }

  function historyWeeks() {
    const map = new Map<string, PerformancePoints[]>()
    for (const p of memberPerfPoints) {
      const ws = weekStartOf(p.date); const arr = map.get(ws) ?? []; arr.push(p); map.set(ws, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
      .map(([ws, entries]) => ({ weekStart: ws, entries: entries.sort((a, b) => a.date.localeCompare(b.date)), total: entries.reduce((s, e) => s + e.points, 0) }))
  }

  const selectedUser    = members.find(m => m.id === selectedUserId)
  const filteredMembers = members.filter(m => {
    const q = search.toLowerCase()
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  })

  const checklists   = kpiConfig?.checklists ?? []
  const duties       = kpiConfig?.duties     ?? []
  const metrics      = kpiConfig?.kpi_items  ?? []
  const checkPad     = Math.max(0, 8 - checklists.length)
  const dutyPad      = Math.max(0, 5 - duties.length)

  const eodViewLog   = logs.find(l => l.date === eodViewDate) ?? logs[0]
  const eodRows: EODRow[] = eodViewLog
    ? (Array.isArray(eodViewLog.eod_rows) ? (eodViewLog.eod_rows as EODRow[]).filter(r => r.task?.trim()) : [])
    : []
  const eodPad       = Math.max(0, 5 - eodRows.length)

  const weekDays        = getWeekDays(viewWeekStart)
  const viewWeekTotal   = weekTotal(viewWeekStart)
  const existingForDate = memberPerfPoints.find(p => p.date === selectedDate)
  const DAY_LABELS      = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

  // ── Sub-header row style ──
  const subHdr = 'bg-cyan-50 text-xs font-semibold text-gray-700 px-4 py-2'

  return (
    <div className="space-y-4">

      {/* ── Horizontal staff selector ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-sm font-semibold text-gray-700">Team Members</p>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{members.length}</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 w-44" />
        </div>
        {filteredMembers.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">
            {isManager ? 'No staff assigned to you yet.' : 'No members found.'}
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {filteredMembers.map(m => {
              const active = selectedUserId === m.id
              return (
                <button key={m.id} onClick={() => setSelectedUserId(m.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all whitespace-nowrap flex-shrink-0 ${
                    active ? 'border-violet-500 bg-violet-50' : 'border-gray-200 bg-white hover:border-violet-300 hover:bg-gray-50'
                  }`}>
                  <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                    active ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-700'
                  }`}>{m.name.slice(0, 2).toUpperCase()}</div>
                  <span className={`text-sm font-medium ${active ? 'text-violet-700' : 'text-gray-700'}`}>{m.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!selectedUser ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">
          Select a team member above to view and configure their KPIs
        </div>
      ) : loadingKpi ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">

          {/* KPI Indicators */}
          <KPIIndicators user={selectedUser} />

          {/* ── 3-panel layout: Checklist left | Duties + EOD right ── */}
          <div className="grid grid-cols-5 gap-4 items-start">

            {/* ── LEFT: Daily Check List ── */}
            <div className="col-span-2">
              <Panel border="border-violet-700">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-gray-700 text-white text-left px-4 py-3 text-sm font-bold">Daily Check List</th>
                      <th className="bg-gray-700 w-8" />
                    </tr>
                    <tr>
                      <td className={subHdr}>Checklist Item</td>
                      <td className="bg-cyan-50" />
                    </tr>
                  </thead>
                  <tbody>
                    {checklists.map((item, i) => (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-sm text-gray-800">{item}</td>
                        <td className="px-2 py-2.5 text-center">
                          <button onClick={() => void deleteCheckItem(i)}
                            className="text-gray-300 hover:text-red-500 text-sm transition-colors" title="Remove">✕</button>
                        </td>
                      </tr>
                    ))}
                    {Array.from({ length: checkPad }).map((_, i) => (
                      <tr key={`cp-${i}`} className="border-t border-gray-100">
                        <td className="px-4 py-3 text-gray-200 text-xs italic">{i === 0 && checklists.length === 0 ? 'No items yet — add below' : ''}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t-2 border-violet-200 bg-violet-50 px-3 py-2.5 flex gap-2">
                  <input ref={checkRef} value={newCheck} onChange={e => setNewCheck(e.target.value)}
                    onKeyDown={e => void addCheckItem(e)}
                    placeholder="Add checklist item…"
                    className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  <button onClick={e => void addCheckItem(e)} disabled={!newCheck.trim() || saving}
                    className="bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-violet-800 disabled:opacity-40">
                    + Add
                  </button>
                </div>
              </Panel>
            </div>

            {/* ── RIGHT: Duties + EOD stacked ── */}
            <div className="col-span-3 space-y-4">

              {/* Main Duties & Responsibilities */}
              <Panel border="border-purple-900">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-purple-900 text-white text-left px-4 py-3 text-sm font-bold">Main Duties and Responsibilities</th>
                      <th className="bg-purple-900 text-white text-center px-3 py-3 text-sm font-bold w-28">Remarks</th>
                      <th className="bg-purple-900 w-8" />
                    </tr>
                    <tr>
                      <td className={subHdr}>Duties &amp; responsibilities</td>
                      <td className={`${subHdr} text-center`}>Remarks</td>
                      <td className="bg-cyan-50" />
                    </tr>
                  </thead>
                  <tbody>
                    {duties.map((duty, i) => (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-sm text-gray-800">{duty}</td>
                        <td className="px-3 py-2.5 text-center text-xs text-gray-300 italic">—</td>
                        <td className="px-2 py-2.5 text-center">
                          <button onClick={() => void deleteDuty(i)}
                            className="text-gray-300 hover:text-red-500 text-sm transition-colors" title="Remove">✕</button>
                        </td>
                      </tr>
                    ))}
                    {Array.from({ length: dutyPad }).map((_, i) => (
                      <tr key={`dp-${i}`} className="border-t border-gray-100">
                        <td className="px-4 py-3 text-gray-200 text-xs italic">{i === 0 && duties.length === 0 ? 'No duties yet — add below' : ''}</td>
                        <td /><td />
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t-2 border-purple-200 bg-purple-50 px-3 py-2.5 flex gap-2">
                  <input ref={dutyRef} value={newDuty} onChange={e => setNewDuty(e.target.value)}
                    onKeyDown={e => void addDuty(e)}
                    placeholder="Add duty…"
                    className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  <button onClick={e => void addDuty(e)} disabled={!newDuty.trim() || saving}
                    className="bg-purple-900 text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-purple-800 disabled:opacity-40">
                    + Add
                  </button>
                </div>
              </Panel>

              {/* End of the Day Report */}
              <Panel border="border-gray-800">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-gray-800 text-white text-left px-4 py-3 text-sm font-bold">End of the day — Report</th>
                      <th className="bg-fuchsia-700 text-white text-center px-3 py-3 text-sm font-bold w-36">
                        {loadingKpi ? '…' : (
                          <select
                            value={eodViewDate}
                            onChange={e => setEodViewDate(e.target.value)}
                            className="bg-fuchsia-700 text-white text-xs font-semibold border-0 focus:outline-none cursor-pointer"
                          >
                            {logs.length === 0
                              ? <option value="">No submissions</option>
                              : logs.map(l => <option key={l.date} value={l.date}>{fmtDate(l.date)}</option>)
                            }
                          </select>
                        )}
                      </th>
                    </tr>
                    <tr>
                      <td className={subHdr}>Duties &amp; Task performed</td>
                      <td className={`${subHdr} text-center`}>Remarks / Checked</td>
                    </tr>
                  </thead>
                  <tbody>
                    {eodRows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-4 py-2.5 text-sm text-gray-800">{r.task}</td>
                        <td className="px-3 py-2.5 text-center text-sm text-gray-500">{r.remarks || '—'}</td>
                      </tr>
                    ))}
                    {Array.from({ length: eodPad }).map((_, i) => (
                      <tr key={`ep-${i}`} className="border-t border-gray-100">
                        <td className="px-4 py-3 text-gray-200 text-xs italic">{i === 0 && eodRows.length === 0 ? (logs.length === 0 ? 'No submissions yet' : 'No tasks for this date') : ''}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

            </div>
          </div>

          {/* ── KPI Metrics ── */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <button onClick={() => setShowMetrics(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-base">📊</span>
                <p className="text-sm font-semibold text-gray-800">KPI Metrics</p>
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{metrics.length}</span>
              </div>
              <span className="text-gray-400 text-xs">{showMetrics ? '▲' : '▼'}</span>
            </button>
            {showMetrics && (
              <div>
                {metrics.length === 0 ? (
                  <div className="px-6 py-8 text-center text-gray-400">
                    <p className="text-sm">No KPI metrics configured yet</p>
                  </div>
                ) : (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Metric</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Target</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Period</th>
                        <th className="w-24 px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.map(m => (
                        <tr key={m.id} className="border-t border-gray-100 hover:bg-gray-50">
                          {editId === m.id ? (
                            <td colSpan={5} className="px-5 py-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <input value={editMetric.name} onChange={e => setEditMetric(p => ({ ...p, name: e.target.value }))}
                                  placeholder="Name" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                <input type="number" value={editMetric.target} onChange={e => setEditMetric(p => ({ ...p, target: e.target.value }))}
                                  placeholder="Target" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                <input value={editMetric.unit} onChange={e => setEditMetric(p => ({ ...p, unit: e.target.value }))}
                                  placeholder="Unit" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                <select value={editMetric.period} onChange={e => setEditMetric(p => ({ ...p, period: e.target.value as Period }))}
                                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                                  {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <button onClick={saveEdit} className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded hover:bg-violet-700">Save</button>
                                <button onClick={() => setEditId(null)} className="text-xs text-gray-500 px-2 py-1.5">Cancel</button>
                              </div>
                            </td>
                          ) : (
                            <>
                              <td className="px-5 py-2.5 text-sm font-medium text-gray-900">{m.name}</td>
                              <td className="px-4 py-2.5 text-sm text-center text-gray-700">{m.target}</td>
                              <td className="px-4 py-2.5 text-sm text-center text-gray-500">{m.unit}</td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  m.period === 'daily' ? 'bg-blue-50 text-blue-700' :
                                  m.period === 'weekly' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'
                                }`}>{m.period}</span>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <button onClick={() => { setEditId(m.id); setEditMetric({ name: m.name, target: String(m.target), unit: m.unit, period: m.period }) }}
                                  className="text-xs text-violet-600 hover:text-violet-800 border border-violet-200 rounded px-2 py-1 mr-1">Edit</button>
                                <button onClick={() => void deleteMetric(m.id)}
                                  className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1">Del</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 flex flex-wrap gap-2 items-center">
                  <input value={newMetric.name} onChange={e => setNewMetric(p => ({ ...p, name: e.target.value }))}
                    placeholder="Metric name" className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  <input type="number" value={newMetric.target} onChange={e => setNewMetric(p => ({ ...p, target: e.target.value }))}
                    placeholder="Target" className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  <input value={newMetric.unit} onChange={e => setNewMetric(p => ({ ...p, unit: e.target.value }))}
                    placeholder="Unit" className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  <select value={newMetric.period} onChange={e => setNewMetric(p => ({ ...p, period: e.target.value as Period }))}
                    className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                    {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button onClick={addMetric} disabled={!newMetric.name.trim() || !newMetric.target || saving}
                    className="bg-violet-600 text-white text-xs font-medium px-4 py-1.5 rounded hover:bg-violet-700 disabled:opacity-40">+ Add</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Performance Points ── */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <button onClick={() => setShowPoints(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-base">⭐</span>
                <p className="text-sm font-semibold text-gray-800">Performance Points</p>
              </div>
              <span className="text-gray-400 text-xs">{showPoints ? '▲' : '▼'}</span>
            </button>
            {showPoints && (
              <div className="p-5 space-y-5">
                {/* Week navigation */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setViewWeekStart(w => shiftWeek(w, -1))}
                      className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-xs">◀</button>
                    <div className="text-center px-1">
                      <p className="text-sm font-semibold text-gray-800">{fmtWeekRange(viewWeekStart)}</p>
                      <p className="text-[11px] text-gray-400">Week</p>
                    </div>
                    <button onClick={() => setViewWeekStart(w => shiftWeek(w, 1))}
                      disabled={viewWeekStart >= getMonday()}
                      className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-xs disabled:opacity-30">▶</button>
                  </div>
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${ptBg(viewWeekTotal)}`}>
                    <span className="text-xs text-gray-500 font-medium">Week Total</span>
                    <span className={`font-bold text-xl ${ptClr(viewWeekTotal)}`}>
                      {viewWeekTotal > 0 ? '+' : ''}{viewWeekTotal}
                    </span>
                  </div>
                </div>

                {/* Mon–Fri strip */}
                <div className="grid grid-cols-5 gap-2">
                  {weekDays.map((d, i) => {
                    const entry = memberPerfPoints.find(p => p.date === d)
                    const isSelected = d === selectedDate; const isFuture = d > today
                    return (
                      <button key={d} disabled={isFuture}
                        onClick={() => { setSelectedDate(d); const ws = weekStartOf(d); if (ws !== viewWeekStart) setViewWeekStart(ws) }}
                        className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all
                          ${isSelected ? 'border-violet-500 bg-violet-50' : 'border-gray-200 bg-white hover:border-violet-300 hover:bg-gray-50'}
                          ${isFuture ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <span className={`text-[11px] font-semibold uppercase tracking-wide ${isSelected ? 'text-violet-600' : 'text-gray-400'}`}>{DAY_LABELS[i]}</span>
                        {d === today && <span className="text-[9px] bg-violet-100 text-violet-600 rounded-full px-1.5 font-semibold">Today</span>}
                        {entry
                          ? <span className={`font-bold text-base ${ptClr(entry.points)}`}>{entry.points > 0 ? '+' : ''}{entry.points}</span>
                          : <span className="text-gray-300 text-sm font-medium">—</span>}
                      </button>
                    )
                  })}
                </div>

                {/* Entry form */}
                <div className={`rounded-xl border-2 p-4 space-y-3 ${ptBg(draftVal)}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{fmtDate(selectedDate)}</p>
                      <p className="text-[11px] text-gray-400">{existingForDate ? 'Rating saved — edit to update' : 'No rating yet'}</p>
                    </div>
                    <span className={`font-bold text-3xl ${ptClr(draftVal)}`}>{draftVal > 0 ? '+' : ''}{draftVal}</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                      <span className="text-red-400 font-medium">-10 Poor</span>
                      <span>0 Neutral</span>
                      <span className="text-green-500 font-medium">+10 Excellent</span>
                    </div>
                    <input type="range" min="-10" max="10" step="1" value={draftVal}
                      onChange={e => setDraftVal(Number(e.target.value))}
                      className="w-full accent-violet-600 cursor-pointer" />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                      {[-10, -5, 0, 5, 10].map(v => (
                        <span key={v} className={v === draftVal ? 'text-violet-600 font-bold' : ''}>{v > 0 ? `+${v}` : v}</span>
                      ))}
                    </div>
                  </div>
                  <input type="text" value={draftNote} onChange={e => setDraftNote(e.target.value)}
                    placeholder="Note (e.g. 'Hit all targets today')"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {draftVal < 0 ? '⚠️ Negative — staff will see this.' : draftVal > 0 ? '🌟 Positive rating!' : '⊙ Neutral.'}
                    </p>
                    <button onClick={() => void saveDailyPoints()} disabled={savingPts}
                      className="bg-violet-600 text-white text-xs font-semibold px-5 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-50">
                      {savingPts ? 'Saving…' : savedPts ? '✓ Saved!' : existingForDate ? 'Update' : 'Save Points'}
                    </button>
                  </div>
                </div>

                {/* History */}
                {historyWeeks().length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">History</p>
                    <div className="space-y-3">
                      {historyWeeks().map(wk => (
                        <div key={wk.weekStart} className="rounded-xl border border-gray-200 overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                            <p className="text-xs font-semibold text-gray-600">{fmtWeekRange(wk.weekStart)}</p>
                            <span className={`font-bold text-sm ${ptClr(wk.total)}`}>Total: {wk.total > 0 ? '+' : ''}{wk.total}</span>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {wk.entries.map(e => (
                              <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                                <span className="text-gray-500 w-24 flex-shrink-0">{fmtDate(e.date)}</span>
                                <span className={`font-bold w-10 flex-shrink-0 ${ptClr(e.points)}`}>{e.points > 0 ? '+' : ''}{e.points}</span>
                                {e.notes && <span className="text-gray-400 truncate">· {e.notes}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
