import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { EODRow, KPI, KPIDailyLog } from '@/types'
import { KPIIndicators } from './KPIIndicators'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function todayFmt() {
  return new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function emptyRow(): EODRow { return { task: '', remarks: '' } }

export function KPIStaffView() {
  const { user } = useAuth()
  const today = todayStr()

  const [kpiConfig,  setKpiConfig]  = useState<KPI | null>(null)
  const [todayLog,   setTodayLog]   = useState<KPIDailyLog | null>(null)
  const [loading,    setLoading]    = useState(true)

  // Checklist state
  const [checkDone,    setCheckDone]    = useState<boolean[]>([])
  const [checkRemarks, setCheckRemarks] = useState<string[]>([])
  const [savingCheck,  setSavingCheck]  = useState(false)

  // EOD rows state
  const [eodRows,     setEodRows]     = useState<EODRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [submitting,  setSubmitting]  = useState(false)
  const [eodSubmitted,setEodSubmitted] = useState(false)
  const [eodSavedAt, setEodSavedAt]  = useState<string | null>(null)
  const [eodMsg,     setEodMsg]      = useState<string | null>(null)

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
      setCheckRemarks(config.checklists.map((_, i) => dayLog?.checklist_remarks?.[i] ?? ''))
    }

    const rows: EODRow[] = Array.isArray(dayLog?.eod_rows) && (dayLog!.eod_rows as EODRow[]).length > 0
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

  // Save checklist (called on check/uncheck and remarks change)
  async function saveChecklist(done: boolean[], remarks: string[]) {
    if (!user) return
    setSavingCheck(true)
    const payload = {
      user_id: user.id, date: today,
      metric_actuals: todayLog?.metric_actuals ?? {},
      checklist_done: done,
      checklist_remarks: remarks,
      eod_rows: eodRows,
      notes: null,
      submitted_at: todayLog?.submitted_at ?? new Date().toISOString(),
    }
    const { data } = await supabase.from('kpi_daily_logs')
      .upsert(payload, { onConflict: 'user_id,date' })
      .select().single()
    if (data) setTodayLog(data as KPIDailyLog)
    setSavingCheck(false)
  }

  function toggleCheck(i: number) {
    const done = checkDone.map((v, j) => j === i ? !v : v)
    setCheckDone(done)
    void saveChecklist(done, checkRemarks)
  }

  function updateCheckRemark(i: number, val: string) {
    const remarks = checkRemarks.map((v, j) => j === i ? val : v)
    setCheckRemarks(remarks)
    void saveChecklist(checkDone, remarks)
  }

  // EOD rows
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
    if (filledRows.length < 1) { setEodMsg('Add at least one task before submitting.'); return }
    setSubmitting(true)
    const now = new Date().toISOString()
    const payload = {
      user_id: user.id, date: today,
      metric_actuals: todayLog?.metric_actuals ?? {},
      checklist_done: checkDone,
      checklist_remarks: checkRemarks,
      eod_rows: eodRows,
      notes: null,
      submitted_at: now,
    }
    const { data } = await supabase.from('kpi_daily_logs')
      .upsert(payload, { onConflict: 'user_id,date' })
      .select().single()
    if (data) { setTodayLog(data as KPIDailyLog); setEodSubmitted(true); setEodSavedAt(now) }
    setEodMsg('EOD Report saved!')
    setTimeout(() => setEodMsg(null), 3000)
    setSubmitting(false)
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  const checklist = kpiConfig?.checklists ?? []
  const duties    = kpiConfig?.duties ?? []
  const checkDoneCount = checkDone.filter(Boolean).length

  return (
    <div className="space-y-5">

      {/* ── KPI Performance Indicators ── */}
      {user && <KPIIndicators user={user} />}

      {/* ── Urgency banner ── */}
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

      {/* ── 3-Section Layout ── */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ══ LEFT: Daily Check List ══ */}
        <div className="w-full lg:w-72 lg:flex-shrink-0">
          <div className="border border-purple-300 rounded-xl overflow-hidden shadow-sm">
            {/* Header */}
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th colSpan={2} className="bg-gray-700 text-white px-4 py-2.5 text-left font-bold text-sm tracking-wide">
                    Daily Check List
                  </th>
                  <th className="bg-gray-700 text-white px-3 py-2.5 text-left font-bold text-sm">Remarks</th>
                </tr>
                <tr className="bg-sky-50 border-b border-sky-100">
                  <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-gray-600">{todayFmt()}</td>
                  <td className="px-3 py-2 text-xs font-semibold text-gray-600" />
                </tr>
              </thead>
              <tbody>
                {checklist.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-xs text-gray-400 text-center">No checklist items. Ask your manager to configure them.</td></tr>
                ) : checklist.map((item, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}>
                    <td className="w-8 pl-3 pr-1 py-2.5">
                      <input
                        type="checkbox"
                        checked={checkDone[i] ?? false}
                        onChange={() => toggleCheck(i)}
                        className="w-4 h-4 accent-violet-600 cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 pr-2">
                      <span className={`text-xs leading-relaxed ${checkDone[i] ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                        {item}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={checkRemarks[i] ?? ''}
                        onChange={e => updateCheckRemark(i, e.target.value)}
                        placeholder="—"
                        className="w-full text-xs border-0 bg-transparent outline-none text-gray-600 placeholder-gray-300 focus:ring-0 p-0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Progress footer */}
            {checklist.length > 0 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Progress {savingCheck && <span className="text-violet-400 animate-pulse">· saving…</span>}</span>
                  <span className="font-semibold text-violet-700">{checkDoneCount}/{checklist.length}</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${checkDoneCount === checklist.length && checklist.length > 0 ? 'bg-green-500' : 'bg-violet-500'}`}
                    style={{ width: `${checklist.length > 0 ? Math.round((checkDoneCount / checklist.length) * 100) : 0}%` }}
                  />
                </div>
                {checkDoneCount === checklist.length && checklist.length > 0 && (
                  <p className="text-xs text-green-600 font-semibold mt-1 text-center">All done! 🎉</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ══ RIGHT: Duties + EOD ══ */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── Duties & Responsibilities ── */}
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
                  <tr><td colSpan={2} className="px-4 py-8 text-xs text-gray-400 text-center">No duties configured. Ask your manager to set them up.</td></tr>
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

          {/* ── EOD Report ── */}
          <div className="border border-pink-300 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="bg-pink-600 text-white px-4 py-2.5 text-left font-bold text-sm tracking-wide">
                    End of the day – Report
                  </th>
                  <th className="bg-pink-600 text-white px-4 py-2.5 text-right text-xs font-normal opacity-80">
                    {eodSubmitted && eodSavedAt && (
                      <span>✓ Saved {new Date(eodSavedAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                    )}
                  </th>
                </tr>
                <tr className="bg-sky-50 border-b border-sky-100">
                  <td className="px-4 py-2 text-xs font-semibold text-gray-700">Duties &amp; Task performed</td>
                  <td className="px-4 py-2 text-xs font-semibold text-gray-700 w-44">Remarks / Checked</td>
                </tr>
              </thead>
              <tbody>
                {eodRows.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={row.task}
                        onChange={e => updateRow(i, 'task', e.target.value)}
                        placeholder={`Task ${i + 1}…`}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-pink-400 bg-white"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={row.remarks}
                          onChange={e => updateRow(i, 'remarks', e.target.value)}
                          placeholder="Remarks…"
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-pink-400 bg-white"
                        />
                        {eodRows.length > 1 && (
                          <button
                            onClick={() => removeRow(i)}
                            className="text-gray-300 hover:text-red-400 text-base leading-none flex-shrink-0 ml-1"
                            title="Remove row"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer actions */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
              <button
                onClick={addRow}
                className="text-xs text-pink-600 font-semibold hover:text-pink-700 flex items-center gap-1"
              >
                <span className="text-base leading-none">+</span> Add Row
              </button>
              <div className="flex items-center gap-3">
                {eodMsg && <span className="text-xs text-green-600 font-medium">{eodMsg}</span>}
                <p className="text-xs text-gray-400">Min. 3 tasks recommended</p>
                <button
                  onClick={submitEOD}
                  disabled={submitting}
                  className="bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {submitting
                    ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                    : eodSubmitted ? '↺ Update EOD Report' : '✓ Submit EOD Report'
                  }
                </button>
              </div>
            </div>
          </div>

        </div>{/* end right column */}
      </div>{/* end 3-section layout */}
    </div>
  )
}
