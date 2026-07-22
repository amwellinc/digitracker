import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useScreenCapture } from '@/hooks/useScreenCapture'
import { useSubAccountTimezone } from '@/hooks/useSubAccountTimezone'
import type { TimeLog } from '@/types'
import { todayInTz } from '@/lib/timezone'

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const HEARTBEAT_MS      = 2 * 60 * 1000   // ping DB every 2 min while clocked in
const STALE_MS          = 20 * 60 * 1000  // >20 min gap = abandoned session (raised from 10 for resilience)

// Module-level token cache — kept fresh by the Supabase auth listener so
// pagehide/beforeunload handlers can call fetch() without an async look-up.
let _authToken = ''
supabase.auth.onAuthStateChange((_ev, session) => {
  _authToken = session?.access_token ?? ''
})

interface ClockContextValue {
  activeLog:        TimeLog | null
  dayMinutes:       number
  lunchStart:       Date | null
  isCapturing:      boolean
  captureError:     string | null
  handleClockIn:    () => Promise<void>
  handleClockOut:   () => Promise<void>
  handleStartLunch: () => Promise<void>
  handleEndLunch:   () => Promise<void>
}

const ClockContext = createContext<ClockContextValue | null>(null)

export function useClockContext() {
  const ctx = useContext(ClockContext)
  if (!ctx) throw new Error('useClockContext must be used within ClockProvider')
  return ctx
}

export function ClockProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const timezone = useSubAccountTimezone()
  const [activeLog,  setActiveLog]  = useState<TimeLog | null>(null)
  const [dayMinutes, setDayMinutes] = useState(0)
  const [lunchStart, setLunchStart] = useState<Date | null>(null)

  // Always-fresh refs so event handlers and callbacks never capture stale values
  const activeLogRef  = useRef<TimeLog | null>(null)
  const lunchStartRef = useRef<Date | null>(null)
  const userRef       = useRef(user)
  activeLogRef.current  = activeLog
  lunchStartRef.current = lunchStart
  userRef.current       = user

  // ── Forced clock-out (screen share ended by user in browser) ───────────
  const handleForcedClockOut = useCallback(async () => {
    const log = activeLogRef.current
    if (!log) return
    const now     = new Date().toISOString()
    const elapsed = Math.round((Date.now() - new Date(log.clock_in).getTime()) / 60000)
    await supabase.from('time_logs')
      .update({ clock_out: now, status: 'clocked_out', total_minutes: elapsed })
      .eq('id', log.id)
    setDayMinutes(p => p + elapsed)
    setActiveLog(null)
    setLunchStart(null)
  }, [])

  const {
    isCapturing,
    error: captureError,
    start: startCapture,
    stop:  stopCapture,
  } = useScreenCapture(handleForcedClockOut)

  // ── On mount: restore today's session + detect stale abandoned logs ────
  useEffect(() => {
    if (!user) return
    const today = todayInTz(timezone)

    async function init() {
      // Detect page reload (F5/Ctrl+R) vs first-time navigation.
      // We use this below to restore a session that the pagehide keepalive
      // may have falsely clocked out during the reload.
      const navEntry = (
        performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      )
      const wasReloaded = navEntry?.type === 'reload'

      // If the user explicitly clicked Clock Out, a sessionStorage flag is set so we
      // don't accidentally restore that intentional clock-out on a subsequent reload.
      const hadExplicitClkout = sessionStorage.getItem('__dt_explicit_clkout') === 'true'
      sessionStorage.removeItem('__dt_explicit_clkout')

      const { data } = await supabase
        .from('time_logs')
        .select('*')
        .eq('user_id', user!.id)
        .eq('date', today)
        .order('clock_in', { ascending: false })

      if (!data) return
      const logs = data as TimeLog[]
      const completed = logs.filter(l => l.status === 'clocked_out')
      setDayMinutes(completed.reduce((s, l) => s + (l.total_minutes ?? 0), 0))

      const active = logs.find(l => l.status !== 'clocked_out')

      if (!active) {
        // On a page reload the pagehide keepalive may have clocked out a session
        // that was genuinely live. Detect this by finding a session clocked out
        // within the last 30 s and no explicit user clock-out.
        if (wasReloaded && !hadExplicitClkout) {
          const justClkedOut = logs.find(l =>
            l.status === 'clocked_out' &&
            l.clock_out &&
            Date.now() - new Date(l.clock_out).getTime() < 30_000,
          )
          if (justClkedOut) {
            const { data: restored } = await supabase
              .from('time_logs')
              .update({ status: 'working', clock_out: null, total_minutes: null })
              .eq('id', justClkedOut.id)
              .select()
              .single()
            if (restored) {
              // Subtract the (now-invalid) total_minutes that was tallied above
              setDayMinutes(prev => Math.max(0, prev - (justClkedOut.total_minutes ?? 0)))
              setActiveLog(restored as TimeLog)
            }
          }
        }
        return
      }

      // Detect abandoned session (browser/laptop closed without clock-out)
      if (active.last_seen_at) {
        const gapMs = Date.now() - new Date(active.last_seen_at).getTime()
        if (gapMs > STALE_MS) {
          // Clock out at the time of last heartbeat
          const clockOut = active.last_seen_at
          const total    = Math.round(
            (new Date(clockOut).getTime() - new Date(active.clock_in).getTime()) / 60000
          )
          await supabase.from('time_logs')
            .update({ clock_out: clockOut, status: 'clocked_out', total_minutes: total })
            .eq('id', active.id)
          setDayMinutes(p => p + total)
          return
        }
      }

      // Session looks live — restore it (screen-capture is NOT restarted;
      // user must click Clock In again, which re-requests screen share permission)
      setActiveLog(active)
    }

    void init()
  }, [user, timezone])

  // ── Visibility change: re-validate session when page becomes visible ─────
  // Handles the laptop-close scenario: the page lives in background (BFCache),
  // the keepalive fired and wrote clocked_out to DB, but React state still
  // holds the old activeLog. When the lid opens and tab regains focus,
  // re-check DB so the UI reflects the actual current state.
  useEffect(() => {
    if (!user) return

    const handleVisible = async () => {
      if (document.visibilityState !== 'visible') return
      const log = activeLogRef.current
      if (!log) return

      const { data } = await supabase
        .from('time_logs')
        .select('*')
        .eq('id', log.id)
        .single()

      if (!data) return
      const fresh = data as TimeLog

      if (fresh.status === 'clocked_out') {
        setDayMinutes(p => p + (fresh.total_minutes ?? 0))
        setActiveLog(null)
        setLunchStart(null)
        return
      }

      if (fresh.last_seen_at) {
        const gapMs = Date.now() - new Date(fresh.last_seen_at).getTime()
        if (gapMs > STALE_MS) {
          const clockOut = fresh.last_seen_at
          const total    = Math.round(
            (new Date(clockOut).getTime() - new Date(fresh.clock_in).getTime()) / 60000,
          )
          await supabase.from('time_logs')
            .update({ clock_out: clockOut, status: 'clocked_out', total_minutes: total })
            .eq('id', fresh.id)
          setDayMinutes(p => p + total)
          setActiveLog(null)
          setLunchStart(null)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [user])

  // ── Heartbeat: stamp last_seen_at every 2 min while clocked in ─────────
  useEffect(() => {
    if (!activeLog || activeLog.status === 'clocked_out') return

    const beat = async () => {
      const { error } = await supabase.from('time_logs')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', activeLog.id)
      // On failure the most common cause is an expired auth token.
      // Refresh the session so the next beat succeeds.
      if (error) await supabase.auth.refreshSession()
    }

    void beat()  // immediate first beat
    const id = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [activeLog?.id, activeLog?.status])  // re-run when log changes, not on every render

  // ── Keepalive clock-out: fires when browser/tab truly closes ───────────
  // fetch with keepalive:true is the only reliable way to send a request
  // during page unload.
  //
  // beforeunload is intentionally NOT registered here: it fires on every
  // F5/Ctrl+R page reload too, which would clock out staff who refresh the
  // page.  pagehide with persisted=false is the correct signal for a genuine
  // page unload (close/navigate away).  init() handles the reload edge case
  // by detecting a recently clocked-out session and restoring it.
  useEffect(() => {
    const clockOutNow = () => {
      const log = activeLogRef.current
      if (!log || !_authToken) return
      const clockOut = new Date().toISOString()
      const total    = Math.round((Date.now() - new Date(log.clock_in).getTime()) / 60000)
      fetch(`${SUPABASE_URL}/rest/v1/time_logs?id=eq.${log.id}`, {
        method:    'PATCH',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${_authToken}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ clock_out: clockOut, status: 'clocked_out', total_minutes: total }),
      }).catch(() => {})
    }

    const handlePageHide = (e: PageTransitionEvent) => {
      // persisted=true means the page is entering the BFCache (tab switch on
      // some browsers) — the user will return, so don't clock them out.
      if (e.persisted) return
      clockOutNow()
    }

    window.addEventListener('pagehide', handlePageHide as EventListener)
    return () => {
      window.removeEventListener('pagehide', handlePageHide as EventListener)
    }
  }, [])

  // ── Clock actions ────────────────────────────────────────────────────────
  const handleClockIn = useCallback(async () => {
    const u = userRef.current
    if (!u) return

    const today = todayInTz(timezone)

    // Prevent duplicate: if an active session already exists in DB, restore it
    const { data: existing } = await supabase
      .from('time_logs')
      .select('*')
      .eq('user_id', u.id)
      .eq('date', today)
      .in('status', ['working', 'lunch'])
      .maybeSingle()

    if (existing) {
      setActiveLog(existing as TimeLog)
      return
    }

    const ok = await startCapture()
    if (!ok) return
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('time_logs')
      .insert({
        user_id:      u.id,
        date:         today,
        clock_in:     now,
        status:       'working',
        last_seen_at: now,
      })
      .select()
      .single()
    if (data) setActiveLog(data as TimeLog)
  }, [startCapture, timezone])

  const handleClockOut = useCallback(async () => {
    const log = activeLogRef.current
    const u   = userRef.current
    if (!log || !u) return

    // Mark as user-initiated so init() won't restore this session on a
    // subsequent page reload (distinguishes from keepalive clock-outs).
    sessionStorage.setItem('__dt_explicit_clkout', 'true')

    // Warn if KPI daily update not submitted (non-blocking)
    const today = todayInTz(timezone)
    const [{ data: kpiLog }, { data: kpiCfg }] = await Promise.all([
      supabase.from('kpi_daily_logs').select('id').eq('user_id', u.id).eq('date', today).maybeSingle(),
      supabase.from('kpis').select('kpi_items, checklists').eq('user_id', u.id).maybeSingle(),
    ])
    const hasKpi = kpiCfg && (
      (Array.isArray((kpiCfg as { kpi_items: unknown[] }).kpi_items) &&
        (kpiCfg as { kpi_items: unknown[] }).kpi_items.length > 0) ||
      (Array.isArray((kpiCfg as { checklists: unknown[] }).checklists) &&
        (kpiCfg as { checklists: unknown[] }).checklists.length > 0)
    )
    if (!kpiLog && hasKpi) {
      const proceed = window.confirm(
        '⚠️  Daily KPI Update not submitted yet.\n\nSubmit your daily update before clocking out.\n\nClock out anyway?'
      )
      if (!proceed) return
    }

    stopCapture()
    const now      = new Date().toISOString()
    const elapsed  = (Date.now() - new Date(log.clock_in).getTime()) / 60000
    const lunch    = lunchStartRef.current
    const lunchMin = lunch ? (Date.now() - lunch.getTime()) / 60000 : 0
    const total    = Math.round(elapsed - lunchMin)

    await supabase.from('time_logs')
      .update({ clock_out: now, status: 'clocked_out', total_minutes: total })
      .eq('id', log.id)

    setDayMinutes(p => p + total)
    setActiveLog(null)
    setLunchStart(null)
  }, [stopCapture, timezone])

  const handleStartLunch = useCallback(async () => {
    const log = activeLogRef.current
    if (!log) return
    setLunchStart(new Date())
    await supabase.from('time_logs').update({ status: 'lunch' }).eq('id', log.id)
    setActiveLog(p => p ? { ...p, status: 'lunch' } : null)
  }, [])

  const handleEndLunch = useCallback(async () => {
    const log = activeLogRef.current
    if (!log) return
    setLunchStart(null)
    await supabase.from('time_logs').update({ status: 'working' }).eq('id', log.id)
    setActiveLog(p => p ? { ...p, status: 'working' } : null)
  }, [])

  return (
    <ClockContext.Provider value={{
      activeLog, dayMinutes, lunchStart,
      isCapturing, captureError,
      handleClockIn, handleClockOut, handleStartLunch, handleEndLunch,
    }}>
      {children}
    </ClockContext.Provider>
  )
}
