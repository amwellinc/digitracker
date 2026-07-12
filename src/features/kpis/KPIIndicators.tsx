import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { KPIDailyLog, PerformancePoints, User } from '@/types'

function getWeekBounds(): { weekStart: string; weekEnd: string; weekDays: string[] } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = today.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diff)

  const weekDays: string[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    if (d <= today) weekDays.push(d.toISOString().slice(0, 10))
  }

  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd:   friday.toISOString().slice(0, 10),
    weekDays,
  }
}

interface Stats {
  attendance: { present: number; onTime: number; hours8: number; total: number }
  checklist:  { days5: number; total: number }
  eod:        { days3: number; total: number }
  weekTotal:  number | null
  entryCount: number
}

export function KPIIndicators({ user }: { user: User }) {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const { weekStart, weekEnd, weekDays } = getWeekBounds()
    const total = weekDays.length

    Promise.all([
      supabase.from('time_logs').select('date,clock_in,total_minutes').eq('user_id', user.id).in('date', weekDays),
      supabase.from('kpi_daily_logs').select('date,checklist_done,eod_rows').eq('user_id', user.id).in('date', weekDays),
      supabase.from('performance_points').select('date,points')
        .eq('user_id', user.id)
        .gte('date', weekStart)
        .lte('date', weekEnd),
    ]).then(([{ data: timeLogs }, { data: kpiLogs }, { data: perfEntries }]) => {
      // Attendance
      const byDate: Record<string, { clockIn: string; totalMins: number }[]> = {}
      for (const l of (timeLogs ?? [])) {
        if (!byDate[l.date]) byDate[l.date] = []
        byDate[l.date].push({ clockIn: l.clock_in, totalMins: Number(l.total_minutes) || 0 })
      }

      let present = 0, onTime = 0, hours8 = 0
      for (const date of weekDays) {
        const logs = byDate[date] ?? []
        if (logs.length > 0) {
          present++
          const totalMins = logs.reduce((s, l) => s + l.totalMins, 0)
          if (totalMins >= 480) hours8++
          const earliest = logs.reduce((m, l) => l.clockIn < m ? l.clockIn : m, logs[0].clockIn)
          const clockInHHMM = new Date(earliest).toTimeString().slice(0, 5)
          if (clockInHHMM <= user.reporting_time_in) onTime++
        }
      }

      // Checklist & EOD
      let days5 = 0, days3 = 0
      for (const l of (kpiLogs as KPIDailyLog[] ?? [])) {
        const done = Array.isArray(l.checklist_done) ? (l.checklist_done as boolean[]).filter(Boolean).length : 0
        if (done >= 5) days5++
        const rows = Array.isArray(l.eod_rows) ? (l.eod_rows as { task: string }[]).filter(r => r.task?.trim()) : []
        if (rows.length >= 3) days3++
      }

      // Performance points: sum all daily entries this week
      const entries = (perfEntries ?? []) as PerformancePoints[]
      const weekTotal = entries.length > 0
        ? entries.reduce((sum, e) => sum + e.points, 0)
        : null

      setStats({
        attendance: { present, onTime, hours8, total },
        checklist:  { days5, total },
        eod:        { days3, total },
        weekTotal,
        entryCount: entries.length,
      })
    })
  }, [user.id, user.reporting_time_in])

  if (!stats) return null
  const { attendance, checklist, eod, weekTotal, entryCount } = stats

  const pointsStatus = weekTotal === null ? 'gray'
    : weekTotal > 5  ? 'green'
    : weekTotal >= 0 ? 'amber'
    : 'red'

  const pointsLabel = weekTotal === null
    ? 'Awaiting manager rating'
    : `${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} this week`

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        icon="🕐" label="Attendance (this week)"
        main={`${attendance.present}/${attendance.total} days`}
        sub={`${attendance.onTime} on time · ${attendance.hours8} ≥8h`}
        status={attendance.present >= attendance.total ? 'green' : attendance.present >= 3 ? 'amber' : 'red'}
      />
      <Card
        icon="✅" label="Daily Checklist"
        main={`${checklist.days5}/${checklist.total} days`}
        sub="Days with ≥5 items checked"
        status={checklist.days5 >= checklist.total ? 'green' : checklist.days5 > 0 ? 'amber' : 'red'}
      />
      <Card
        icon="📝" label="EOD Report"
        main={`${eod.days3}/${eod.total} days`}
        sub="Days with ≥3 tasks submitted"
        status={eod.days3 >= eod.total ? 'green' : eod.days3 > 0 ? 'amber' : 'red'}
      />
      <Card
        icon="⭐" label="Perf. Points (week total)"
        main={weekTotal !== null ? `${weekTotal > 0 ? '+' : ''}${weekTotal}` : '—'}
        sub={pointsLabel}
        status={pointsStatus}
        bigMain
      />
    </div>
  )
}

function Card({ icon, label, main, sub, status, bigMain }: {
  icon: string; label: string; main: string; sub: string
  status: 'green' | 'amber' | 'red' | 'gray'; bigMain?: boolean
}) {
  const border = { green: 'border-green-200 bg-green-50', amber: 'border-amber-200 bg-amber-50', red: 'border-red-100 bg-red-50', gray: 'border-gray-200 bg-gray-50' }
  const mainClr = { green: 'text-green-700', amber: 'text-amber-600', red: 'text-red-600', gray: 'text-gray-500' }
  return (
    <div className={`rounded-xl border p-4 ${border[status]}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base">{icon}</span>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-tight">{label}</p>
      </div>
      <p className={`font-bold ${bigMain ? 'text-3xl' : 'text-xl'} ${mainClr[status]}`}>{main}</p>
      <p className="text-xs text-gray-500 mt-0.5 leading-tight">{sub}</p>
    </div>
  )
}
