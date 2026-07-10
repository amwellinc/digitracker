import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { KPI, KPIDailyLog } from '@/types'

function getUrgency(timeOut: string | undefined, submitted: boolean): 'none' | 'upcoming' | 'urgent' {
  if (submitted) return 'none'
  if (!timeOut) return 'upcoming'
  const [h, m] = timeOut.split(':').map(Number)
  const minsLeft = (new Date().setHours(h, m, 0, 0) - Date.now()) / 60000
  if (minsLeft < 60) return 'urgent'
  return 'upcoming'
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${p >= 100 ? 'bg-green-500' : p >= 70 ? 'bg-violet-500' : 'bg-amber-400'}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${p >= 100 ? 'text-green-600' : p >= 70 ? 'text-violet-600' : 'text-amber-500'}`}>
        {p}%
      </span>
    </div>
  )
}

export function KPIStaffView() {
  const { user } = useAuth()
  const today = new Date().toISOString().slice(0, 10)
  const todayFmt = new Date(today).toLocaleDateString('en-SG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const [kpiConfig, setKpiConfig]         = useState<KPI | null>(null)
  const [todayLog, setTodayLog]           = useState<KPIDailyLog | null>(null)
  const [loading, setLoading]             = useState(true)
  const [metricActuals, setMetricActuals] = useState<Record<string, string>>({})
  const [checklistDone, setChecklistDone] = useState<boolean[]>([])
  const [notes, setNotes]                 = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [submitted, setSubmitted]         = useState(false)

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('kpis').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('kpi_daily_logs').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
    ]).then(([{ data: kpi }, { data: log }]) => {
      const config = kpi as KPI ?? null
      const dayLog = log as KPIDailyLog ?? null
      setKpiConfig(config)
      setTodayLog(dayLog)
      if (config) {
        const actuals: Record<string, string> = {}
        config.kpi_items.forEach(m => {
          actuals[m.id] = dayLog?.metric_actuals?.[m.id] != null ? String(dayLog.metric_actuals[m.id]) : ''
        })
        setMetricActuals(actuals)
        setChecklistDone(config.checklists.map((_, i) => dayLog?.checklist_done?.[i] ?? false))
        setNotes(dayLog?.notes ?? '')
        if (dayLog) setSubmitted(true)
      }
      setLoading(false)
    })
  }, [user, today])

  async function handleSubmit() {
    if (!user || !kpiConfig) return
    setSubmitting(true)
    const actuals: Record<string, number> = {}
    kpiConfig.kpi_items.forEach(m => {
      const v = metricActuals[m.id]
      if (v !== '') actuals[m.id] = Number(v)
    })
    const { data } = await supabase
      .from('kpi_daily_logs')
      .upsert({ user_id: user.id, date: today, metric_actuals: actuals, checklist_done: checklistDone, notes: notes.trim() || null, submitted_at: new Date().toISOString() }, { onConflict: 'user_id,date' })
      .select().single()
    if (data) { setTodayLog(data as KPIDailyLog); setSubmitted(true) }
    setSubmitting(false)
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  const hasKpi = kpiConfig && (kpiConfig.kpi_items.length > 0 || kpiConfig.duties.length > 0 || kpiConfig.checklists.length > 0)

  if (!hasKpi) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
        <span className="text-5xl mb-3">📊</span>
        <p className="text-base font-medium text-gray-500">KPIs haven't been set up yet</p>
        <p className="text-sm mt-1">Contact your manager to configure your KPIs and checklist.</p>
      </div>
    )
  }

  const urgency = getUrgency(user?.reporting_time_out, submitted)
  const checkDone = checklistDone.filter(Boolean).length
  const checkTotal = kpiConfig!.checklists.length

  return (
    <div className="space-y-4">
      {/* Urgency banner */}
      {urgency !== 'none' && (
        <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${urgency === 'urgent' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
          <span className="text-lg">{urgency === 'urgent' ? '🔴' : '⚠️'}</span>
          <p className="text-sm font-semibold flex-1">
            {urgency === 'urgent' ? 'Daily Report overdue — submit before clocking out!' : 'Daily Report pending — submit before clock-out.'}
            {user?.reporting_time_out && <span className="font-normal ml-1 opacity-70">Clock-out: {user.reporting_time_out}</span>}
          </p>
        </div>
      )}

      {/* ── 2-column layout: stacks on mobile ── */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── LEFT: Daily Checklist ── */}
        <div className="w-full lg:w-64 lg:flex-shrink-0 bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-bold text-gray-800">✅ Daily Checklist</p>
            <p className="text-xs text-gray-400 mt-0.5">{todayFmt}</p>
          </div>

          {kpiConfig!.checklists.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No checklist items configured.</p>
          ) : (
            <>
              <div className="px-4 py-3 space-y-2.5">
                {kpiConfig!.checklists.map((item, i) => (
                  <label key={i} className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checklistDone[i] ?? false}
                      onChange={e => {
                        const updated = [...checklistDone]
                        updated[i] = e.target.checked
                        setChecklistDone(updated)
                      }}
                      className="mt-0.5 w-4 h-4 accent-violet-600 flex-shrink-0"
                    />
                    <span className={`text-xs leading-relaxed transition-colors ${checklistDone[i] ? 'text-gray-300 line-through' : 'text-gray-700 group-hover:text-gray-900'}`}>
                      {item}
                    </span>
                  </label>
                ))}
              </div>

              {/* Progress footer */}
              <div className="px-4 pb-4">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Progress</span>
                  <span className="font-semibold text-violet-700">{checkDone}/{checkTotal}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${checkDone === checkTotal && checkTotal > 0 ? 'bg-green-500' : 'bg-violet-500'}`}
                    style={{ width: `${checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : 0}%` }}
                  />
                </div>
                {checkDone === checkTotal && checkTotal > 0 && (
                  <p className="text-xs text-green-600 font-semibold mt-1.5 text-center">All done! 🎉</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT: 3 Main Sections ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── Section 1: Your Objectives ── */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-800">🎯 Your Objectives</p>
                <p className="text-xs text-gray-400 mt-0.5">Enter your actual figures for today's report</p>
              </div>
              {kpiConfig!.kpi_items.length > 0 && (
                <span className="text-xs bg-violet-50 text-violet-600 font-semibold px-2.5 py-1 rounded-full border border-violet-100">
                  {kpiConfig!.kpi_items.length} metric{kpiConfig!.kpi_items.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {kpiConfig!.kpi_items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No KPI metrics configured yet.</p>
            ) : (
              <div className="overflow-x-auto">
              <div className="divide-y divide-gray-50 min-w-[560px]">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_90px_120px_180px] gap-4 px-5 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <span>Objective</span>
                  <span>Period</span>
                  <span className="text-right">Target / Actual</span>
                  <span>Progress</span>
                </div>
                {kpiConfig!.kpi_items.map((m, i) => {
                  const actualStr = metricActuals[m.id] ?? ''
                  const actual = actualStr !== '' ? Number(actualStr) : undefined
                  return (
                    <div key={m.id} className={`grid grid-cols-[1fr_90px_120px_180px] gap-4 items-center px-5 py-3 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{m.name}</p>
                        <p className="text-xs text-gray-400">{m.unit}</p>
                      </div>
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full w-fit">{m.period}</span>
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-xs text-gray-400">{m.target} /</span>
                        <input
                          type="number" min="0"
                          value={actualStr}
                          onChange={e => setMetricActuals(prev => ({ ...prev, [m.id]: e.target.value }))}
                          placeholder="—"
                          className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right font-semibold focus:outline-none focus:ring-2 focus:ring-violet-400"
                        />
                      </div>
                      <div>
                        {actual != null
                          ? <ProgressBar value={actual} max={m.target} />
                          : <span className="text-xs text-gray-300">Enter actual above</span>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>
              </div>
            )}
          </div>

          {/* ── Section 2: Your Duties & Responsibilities ── */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-800">📋 Your Duties & Responsibilities</p>
                <p className="text-xs text-gray-400 mt-0.5">Your assigned role and responsibilities</p>
              </div>
              {kpiConfig!.duties.length > 0 && (
                <span className="text-xs bg-blue-50 text-blue-600 font-semibold px-2.5 py-1 rounded-full border border-blue-100">
                  {kpiConfig!.duties.length} dut{kpiConfig!.duties.length !== 1 ? 'ies' : 'y'}
                </span>
              )}
            </div>

            {kpiConfig!.duties.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No duties configured yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {kpiConfig!.duties.map((duty, i) => (
                  <div key={i} className={`flex items-start gap-4 px-5 py-3.5 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm text-gray-700 leading-relaxed">{duty}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Section 3: Your Daily Report ── */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-800">📝 Your Daily Report</p>
                <p className="text-xs text-gray-400 mt-0.5">{todayFmt}</p>
              </div>
              {submitted && todayLog && (
                <span className="text-xs bg-green-50 text-green-700 border border-green-200 font-semibold px-2.5 py-1 rounded-full">
                  ✓ Submitted {new Date(todayLog.submitted_at).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
              )}
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Summary / Highlights
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  placeholder="What did you accomplish today? Any blockers, wins, or important updates?"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                />
              </div>

              {/* Checklist summary row */}
              {checkTotal > 0 && (
                <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-xl text-xs text-gray-600">
                  <span>✅ Checklist</span>
                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${checkDone === checkTotal ? 'bg-green-500' : 'bg-violet-400'}`}
                      style={{ width: `${Math.round((checkDone / checkTotal) * 100)}%` }}
                    />
                  </div>
                  <span className="font-semibold">{checkDone}/{checkTotal} done</span>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-3 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {submitting ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting…</>
                ) : submitted ? '✓ Update Daily Report' : '✓ Submit Daily Report'}
              </button>
              <p className="text-xs text-center text-gray-400">
                {submitted ? 'Resubmit to update your report for today.' : 'Submit this before clocking out.'}
              </p>
            </div>
          </div>

        </div>{/* end right column */}
      </div>{/* end 2-col */}
    </div>
  )
}
