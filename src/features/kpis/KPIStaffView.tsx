import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { KPI, KPIDailyLog } from '@/types'

type Tab = 'overview' | 'daily'

function ProgressBar({ value, max }: { value: number; max: number }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-2">
      <div className={`h-full rounded-full transition-all ${p >= 100 ? 'bg-green-500' : p >= 70 ? 'bg-violet-500' : 'bg-amber-400'}`}
        style={{ width: `${p}%` }} />
    </div>
  )
}

function getUrgency(timeOut: string | undefined, submitted: boolean): 'none' | 'upcoming' | 'urgent' {
  if (submitted) return 'none'
  if (!timeOut) return 'upcoming'
  const [h, m] = timeOut.split(':').map(Number)
  const clockOutMs = new Date().setHours(h, m, 0, 0)
  const minsLeft = (clockOutMs - Date.now()) / 60000
  if (minsLeft < 0) return 'urgent'
  if (minsLeft < 60) return 'urgent'
  return 'upcoming'
}

export function KPIStaffView() {
  const { user } = useAuth()
  const today = new Date().toISOString().slice(0, 10)

  const [kpiConfig, setKpiConfig]     = useState<KPI | null>(null)
  const [todayLog, setTodayLog]       = useState<KPIDailyLog | null>(null)
  const [loadingKpi, setLoadingKpi]   = useState(true)
  const [tab, setTab]                 = useState<Tab>('overview')

  // Daily update form state
  const [metricActuals, setMetricActuals] = useState<Record<string, string>>({})
  const [checklistDone, setChecklistDone] = useState<boolean[]>([])
  const [notes, setNotes]                 = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  useEffect(() => {
    if (!user) return
    setLoadingKpi(true)

    Promise.all([
      supabase.from('kpis').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('kpi_daily_logs').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
    ]).then(([{ data: kpi }, { data: log }]) => {
      const config = kpi as KPI ?? null
      const dayLog = log as KPIDailyLog ?? null
      setKpiConfig(config)
      setTodayLog(dayLog)
      initForm(config, dayLog)
      setLoadingKpi(false)
    })
  }, [user, today])

  function initForm(config: KPI | null, log: KPIDailyLog | null) {
    if (!config) return
    // Populate actuals from existing log or empty
    const actuals: Record<string, string> = {}
    config.kpi_items.forEach(m => {
      const saved = log?.metric_actuals?.[m.id]
      actuals[m.id] = saved != null ? String(saved) : ''
    })
    setMetricActuals(actuals)
    // Populate checklist from existing log or all false
    const done = config.checklists.map((_, i) => log?.checklist_done?.[i] ?? false)
    setChecklistDone(done)
    setNotes(log?.notes ?? '')
    if (log) setSubmitSuccess(true)
  }

  async function submitUpdate() {
    if (!user || !kpiConfig) return
    setSubmitting(true)
    setSubmitSuccess(false)

    // Convert metric actuals to numbers
    const actuals: Record<string, number> = {}
    kpiConfig.kpi_items.forEach(m => {
      const val = metricActuals[m.id]
      if (val !== '') actuals[m.id] = Number(val)
    })

    const payload = {
      user_id: user.id,
      date: today,
      metric_actuals: actuals,
      checklist_done: checklistDone,
      notes: notes.trim() || null,
      submitted_at: new Date().toISOString(),
    }

    const { data } = await supabase.from('kpi_daily_logs')
      .upsert(payload, { onConflict: 'user_id,date' })
      .select().single()

    if (data) {
      setTodayLog(data as KPIDailyLog)
      setSubmitSuccess(true)
    }
    setSubmitting(false)
  }

  const hasKpi = kpiConfig && (
    kpiConfig.kpi_items.length > 0 ||
    kpiConfig.duties.length > 0 ||
    kpiConfig.checklists.length > 0
  )
  const urgency = getUrgency(user?.reporting_time_out, !!todayLog)
  const todayFmt = new Date(today).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (loadingKpi) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasKpi) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
        <span className="text-5xl mb-3">📊</span>
        <p className="text-base font-medium text-gray-500">KPIs haven't been set up yet</p>
        <p className="text-sm mt-1">Contact your manager to configure your KPI metrics and checklist.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Reminder banner */}
      {urgency !== 'none' && (
        <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
          urgency === 'urgent'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          <span className="text-lg">{urgency === 'urgent' ? '🔴' : '⚠️'}</span>
          <div>
            <p className="text-sm font-semibold">
              {urgency === 'urgent'
                ? 'Daily Update overdue — please submit before clocking out!'
                : 'Daily Update pending — submit before your clock-out time.'}
            </p>
            <p className="text-xs mt-0.5">
              {user?.reporting_time_out && `Clock-out time: ${user.reporting_time_out}`}
            </p>
          </div>
          <button onClick={() => setTab('daily')}
            className={`ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg ${
              urgency === 'urgent' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-amber-600 text-white hover:bg-amber-700'
            }`}>
            Submit now →
          </button>
        </div>
      )}

      {/* Submitted confirmation */}
      {submitSuccess && todayLog && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 flex items-center gap-2 text-sm">
          <span className="text-lg">✅</span>
          <span>Daily Update submitted for {todayFmt}. You're all set!</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setTab('overview')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === 'overview' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          📊 Overview
        </button>
        <button onClick={() => setTab('daily')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${tab === 'daily' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          📝 Daily Update
          {!todayLog && <span className="w-2 h-2 bg-amber-400 rounded-full" />}
          {todayLog && <span className="w-2 h-2 bg-green-400 rounded-full" />}
        </button>
      </div>

      {/* ─── OVERVIEW TAB ─── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* KPI Metrics */}
          {kpiConfig.kpi_items.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">📊 KPI Metrics</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {kpiConfig.kpi_items.map(m => {
                  const actualStr = metricActuals[m.id]
                  const actual = actualStr !== '' ? Number(actualStr) : undefined
                  const p = actual != null ? Math.min(100, Math.round((actual / m.target) * 100)) : 0
                  return (
                    <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between mb-1">
                        <div>
                          <p className="font-semibold text-gray-900">{m.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {m.period} target: <span className="font-medium text-gray-600">{m.target} {m.unit}</span>
                          </p>
                        </div>
                        {actual != null ? (
                          <div className="text-right">
                            <p className={`text-2xl font-bold leading-none ${p >= 100 ? 'text-green-600' : p >= 70 ? 'text-violet-600' : 'text-amber-600'}`}>
                              {actual}
                            </p>
                            <p className="text-xs text-gray-400">{m.unit}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">Not submitted</span>
                        )}
                      </div>
                      {actual != null && <ProgressBar value={actual} max={m.target} />}
                      {actual != null && (
                        <p className="text-xs text-right mt-1 font-medium text-gray-500">{p}% of target</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Job Duties */}
          {kpiConfig.duties.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-sm font-semibold text-gray-700 mb-3">📋 Job Duties</p>
              <ol className="space-y-2">
                {kpiConfig.duties.map((duty, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                    <span className="text-xs font-bold text-gray-400 mt-0.5 w-5 text-right flex-shrink-0">{i + 1}.</span>
                    {duty}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Checklist preview */}
          {kpiConfig.checklists.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-sm font-semibold text-gray-700 mb-3">✅ Daily Checklist</p>
              <div className="space-y-2">
                {kpiConfig.checklists.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className={checklistDone[i] ? 'text-green-500' : 'text-gray-300'}>{checklistDone[i] ? '☑' : '☐'}</span>
                    <span className={checklistDone[i] ? 'text-gray-700 line-through decoration-gray-300' : 'text-gray-600'}>{item}</span>
                  </div>
                ))}
              </div>
              {todayLog && (
                <p className="text-xs text-gray-400 mt-3">
                  {checklistDone.filter(Boolean).length}/{kpiConfig.checklists.length} items completed today
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── DAILY UPDATE TAB ─── */}
      {tab === 'daily' && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">Daily Update</p>
              <p className="text-xs text-gray-400 mt-0.5">{todayFmt}</p>
            </div>
            {todayLog && (
              <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-3 py-1 font-medium">
                ✓ Submitted {new Date(todayLog.submitted_at).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            )}
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* KPI Actuals */}
            {kpiConfig.kpi_items.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">📊 KPI Actuals</p>
                <div className="space-y-3">
                  {kpiConfig.kpi_items.map(m => (
                    <div key={m.id} className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700">{m.name}</label>
                        <p className="text-xs text-gray-400">{m.period} target: {m.target} {m.unit}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          value={metricActuals[m.id] ?? ''}
                          onChange={e => setMetricActuals(prev => ({ ...prev, [m.id]: e.target.value }))}
                          placeholder="0"
                          className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm text-right font-medium focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                        <span className="text-xs text-gray-400 w-12">{m.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Checklist */}
            {kpiConfig.checklists.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">✅ Daily Checklist</p>
                <div className="space-y-2">
                  {kpiConfig.checklists.map((item, i) => (
                    <label key={i} className="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={checklistDone[i] ?? false}
                        onChange={e => {
                          const updated = [...checklistDone]
                          updated[i] = e.target.checked
                          setChecklistDone(updated)
                        }}
                        className="w-4 h-4 accent-violet-600 flex-shrink-0"
                      />
                      <span className={`text-sm transition-colors ${checklistDone[i] ? 'text-gray-400 line-through' : 'text-gray-700 group-hover:text-gray-900'}`}>
                        {item}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {checklistDone.filter(Boolean).length}/{kpiConfig.checklists.length} completed
                </p>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">📝 Notes / Highlights</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="What did you accomplish today? Any blockers or highlights?"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
            </div>

            {/* Submit */}
            <button
              onClick={submitUpdate}
              disabled={submitting}
              className="w-full py-3 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Submitting…
                </>
              ) : todayLog ? '✓ Update Daily Submission' : '✓ Submit Daily Update'}
            </button>

            <p className="text-xs text-center text-gray-400">
              {todayLog ? 'Your previous submission will be updated.' : 'Submit this before clocking out today.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
