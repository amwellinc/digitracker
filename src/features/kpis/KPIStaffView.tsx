import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { EODRow, KPI, KPIDailyLog } from '@/types'
import { KPIIndicators } from './KPIIndicators'
import { todayInTz } from '@/lib/timezone'
import { useSubAccountTimezone } from '@/hooks/useSubAccountTimezone'

function todayFmt() {
  return new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function emptyRow(): EODRow { return { task: '', remarks: '' } }

export function KPIStaffView() {
  const { user } = useAuth()
  const timezone = useSubAccountTimezone()
  const today = todayInTz(timezone)

  const [kpiConfig,  setKpiConfig]  = useState<KPI | null>(null)
  const [todayLog,   setTodayLog]   = useState<KPIDailyLog | null>(null)
  const [loading,    setLoading]    = useState(true)

  // Checklist
  const [checkDone,   setCheckDone]   = useState<boolean[]>([])
  const [savingCheck, setSavingCheck] = useState(false)

  // EOD
  const [eodRows,      setEodRows]      = useState<EODRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [submitting,   setSubmitting]   = useState(false)
  const [eodSubmitted, setEodSubmitted] = useState(false)
  const [eodSavedAt,   setEodSavedAt]  = useState<string | null>(null)
  const [eodMsg,       setEodMsg]       = useState<{ text: string; ok: boolean } | null>(null)

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: kpi }, { data: log }] = await Promise.all([
      supabase.from('kpis').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('kpi_daily_logs').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
    ])
    const config = kpi as KPI ?? null
    const dayLog = log as KPIDailyLog ?? null
    setKpiConfig(config)
    setTodayLog(dayLog)

    if (config) {
      setCheckDone(config.checklists.map((_, i) => dayLog?.checklist_done?.[i] ?? false))
    }

    const rows: EODRow[] = Array.isArray(dayLog?.eod_rows) && (dayLog!.eod_rows as EODRow[]).some(r => r.task?.trim())
      ? (dayLog!.eod_rows as EODRow[])
      : [emptyRow(), emptyRow(), emptyRow()]
    setEodRows(rows)

    if (dayLog && Array.isArray(dayLog.eod_rows) && (dayLog.eod_rows as EODRow[]).some(r => r.task?.trim())) {
      setEodSubmitted(true)
      setEodSavedAt(dayLog.submitted_at)
    }
    setLoading(false)
  }, [user, today])

  useEffect(() => { void loadData() }, [loadData])

  async function saveChecklist(done: boolean[]) {
    if (!user) return
    setSavingCheck(true)
    const payload = {
      user_id: user.id, date: today,
      metric_actuals: todayLog?.metric_actuals ?? {},
      checklist_done: done,
      checklist_remarks: [],
      eod_rows: eodRows,
      notes: null,
      submitted_at: todayLog?.submitted_at ?? new Date().toISOString(),
    }
    const { data } = await supabase.from('kpi_daily_logs')
      .upsert(payload, { onConflict: 'user_id,date' }).select().single()
    if (data) setTodayLog(data as KPIDailyLog)
    setSavingCheck(false)
  }

  function toggleCheck(i: number) {
    const done = checkDone.map((v, j) => j === i ? !v : v)
    setCheckDone(done); void saveChecklist(done)
  }

  function updateRow(i: number, field: keyof EODRow, val: string) {
    setEodRows(rows => rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }
  function addRow() { setEodRows(rows => [...rows, emptyRow()]) }
  function removeRow(i: number) {
    if (eodRows.length <= 1) return
    setEodRows(rows => rows.filter((_, j) => j !== i))
  }

  async function submitEOD() {
    if (!user) return
    const filledRows = eodRows.filter(r => r.task.trim())
    if (filledRows.length < 1) {
      setEodMsg({ text: 'Add at least one task before submitting.', ok: false })
      return
    }
    setSubmitting(true)
    const now = new Date().toISOString()
    const payload = {
      user_id: user.id, date: today,
      metric_actuals: todayLog?.metric_actuals ?? {},
      checklist_done: checkDone,
      checklist_remarks: [],
      eod_rows: eodRows,
      notes: null,
      submitted_at: now,
    }
    const { data, error } = await supabase.from('kpi_daily_logs')
      .upsert(payload, { onConflict: 'user_id,date' }).select().single()
    if (error || !data) {
      setEodMsg({ text: `Failed to save: ${error?.message ?? 'Unknown error'}`, ok: false })
    } else {
      setTodayLog(data as KPIDailyLog)
      setEodSubmitted(true)
      setEodSavedAt(now)
      setEodMsg({ text: 'EOD Report saved successfully!', ok: true })
      setTimeout(() => setEodMsg(null), 4000)
    }
    setSubmitting(false)
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  const checklist      = kpiConfig?.checklists ?? []
  const duties         = kpiConfig?.duties     ?? []
  const checkDoneCount = checkDone.filter(Boolean).length
  const filledEodCount = eodRows.filter(r => r.task.trim()).length

  return (
    <div className="space-y-5">

      {/* KPI Indicators */}
      {user && <KPIIndicators user={user} />}

      {/* Urgency banner */}
      {(() => {
        if (!user?.reporting_time_out) return null
        const [h, m] = user.reporting_time_out.split(':').map(Number)
        const minsLeft = (new Date().setHours(h, m, 0, 0) - Date.now()) / 60000
        if (minsLeft > 60 || minsLeft < 0) return null
        return (
          <div className="rounded-xl border bg-red-50 border-red-200 text-red-700 px-4 py-3 flex items-center gap-3">
            <span className="text-lg">🔴</span>
            <p className="text-sm font-semibold">EOD Report due soon — clock-out at {user.reporting_time_out}</p>
          </div>
        )
      })()}

      {/* ── Checklist + Duties (2-col) ── */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* LEFT: Daily Check List */}
        <div className="w-full lg:w-72 lg:flex-shrink-0">
          <div className="border border-purple-300 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th colSpan={2} className="bg-gray-700 text-white px-4 py-2.5 text-left font-bold text-sm tracking-wide">Daily Check List</th>
                </tr>
                <tr className="bg-sky-50 border-b border-sky-100">
                  <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-gray-600">{todayFmt()}</td>
                </tr>
              </thead>
              <tbody>
                {checklist.length === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-8 text-xs text-gray-400 text-center">No checklist items configured.</td></tr>
                ) : checklist.map((item, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}>
                    <td className="w-8 pl-3 pr-1 py-2.5">
                      <input type="checkbox" checked={checkDone[i] ?? false} onChange={() => toggleCheck(i)}
                        className="w-4 h-4 accent-violet-600 cursor-pointer" />
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`text-xs leading-relaxed ${checkDone[i] ? 'line-through text-gray-300' : 'text-gray-700'}`}>{item}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {checklist.length > 0 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Progress {savingCheck && <span className="text-violet-400 animate-pulse">· saving…</span>}</span>
                  <span className="font-semibold text-violet-700">{checkDoneCount}/{checklist.length}</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${checkDoneCount === checklist.length ? 'bg-green-500' : 'bg-violet-500'}`}
                    style={{ width: `${checklist.length > 0 ? Math.round((checkDoneCount / checklist.length) * 100) : 0}%` }} />
                </div>
                {checkDoneCount === checklist.length && checklist.length > 0 && (
                  <p className="text-xs text-green-600 font-semibold mt-1 text-center">All done! 🎉</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Duties */}
        <div className="flex-1 min-w-0">
          <div className="border border-purple-300 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th colSpan={2} className="bg-violet-800 text-white px-4 py-2.5 text-left font-bold text-sm tracking-wide">
                    Main Duties and Responsibilities
                  </th>
                </tr>
                <tr className="bg-sky-50 border-b border-sky-100">
                  <td className="px-4 py-2 text-xs font-semibold text-gray-700">Duties &amp; responsibilities</td>
                  <td className="px-4 py-2 text-xs font-semibold text-gray-700 w-32">Remarks</td>
                </tr>
              </thead>
              <tbody>
                {duties.length === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-8 text-xs text-gray-400 text-center">No duties configured yet.</td></tr>
                ) : duties.map((duty, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <span className="text-[11px] font-bold text-gray-400 mt-0.5 w-4 flex-shrink-0">{i + 1}.</span>
                        <span className="text-xs text-gray-700 leading-relaxed">{duty}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          EOD REPORT — full-width, primary action card
          ══════════════════════════════════════════════ */}
      <div className="border-2 border-pink-400 rounded-xl overflow-hidden shadow-md">

        {/* Header */}
        <div className="flex items-center justify-between bg-pink-600 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-lg">📋</span>
            <div>
              <p className="text-white font-bold text-sm tracking-wide">End of Day — Report</p>
              <p className="text-pink-200 text-xs">{todayFmt()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {eodSubmitted && eodSavedAt && (
              <span className="text-xs bg-green-500 text-white font-semibold px-3 py-1 rounded-full">
                ✓ Saved {new Date(eodSavedAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            )}
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
              filledEodCount >= 3 ? 'bg-green-100 text-green-700' : 'bg-pink-200 text-pink-800'
            }`}>
              {filledEodCount} task{filledEodCount !== 1 ? 's' : ''} entered
            </span>
          </div>
        </div>

        {/* Sub-header */}
        <div className="grid grid-cols-[1fr_180px_36px] bg-sky-50 border-b border-sky-100">
          <div className="px-5 py-2 text-xs font-semibold text-gray-700">Duties &amp; Task performed</div>
          <div className="px-3 py-2 text-xs font-semibold text-gray-700">Remarks / Checked</div>
          <div />
        </div>

        {/* Rows */}
        <div className="bg-white">
          {eodRows.map((row, i) => (
            <div key={i} className={`grid grid-cols-[1fr_180px_36px] border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
              <div className="px-4 py-2">
                <input
                  type="text"
                  value={row.task}
                  onChange={e => updateRow(i, 'task', e.target.value)}
                  placeholder={`Task ${i + 1} — describe what you worked on…`}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 bg-white placeholder-gray-300"
                />
              </div>
              <div className="px-3 py-2">
                <input
                  type="text"
                  value={row.remarks}
                  onChange={e => updateRow(i, 'remarks', e.target.value)}
                  placeholder="Remarks…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 bg-white placeholder-gray-300"
                />
              </div>
              <div className="flex items-center justify-center py-2">
                {eodRows.length > 1 && (
                  <button onClick={() => removeRow(i)} title="Remove row"
                    className="text-gray-300 hover:text-red-400 text-lg leading-none transition-colors">✕</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <button onClick={addRow}
            className="flex items-center gap-1.5 text-sm text-pink-600 font-semibold hover:text-pink-700 transition-colors">
            <span className="text-lg leading-none">+</span> Add Row
          </button>

          <div className="flex items-center gap-4">
            {eodMsg && (
              <span className={`text-sm font-medium ${eodMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                {eodMsg.ok ? '✓' : '⚠'} {eodMsg.text}
              </span>
            )}
            <span className="text-xs text-gray-400">Min. 3 tasks recommended</span>
            <button
              onClick={() => void submitEOD()}
              disabled={submitting}
              className="flex items-center gap-2 bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg disabled:opacity-50 transition-colors shadow-sm"
            >
              {submitting
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                : eodSubmitted
                  ? <><span>↺</span> Update EOD Report</>
                  : <><span>✓</span> Submit EOD Report</>
              }
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
