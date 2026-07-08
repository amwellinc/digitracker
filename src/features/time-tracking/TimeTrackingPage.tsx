import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useScreenCapture } from '@/hooks/useScreenCapture'
import { supabase } from '@/lib/supabase'
import type { TimeLog } from '@/types'
import { StatCards } from './StatCards'
import { TeamAvatarRow } from './TeamAvatarRow'
import { RecentScreenshots } from './RecentScreenshots'
import { AdminDashboard } from '@/features/dashboard/AdminDashboard'

export function TimeTrackingPage() {
  const { user } = useAuth()
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null)
  const [dayMinutes, setDayMinutes] = useState(0)
  const [lunchStart, setLunchStart] = useState<Date | null>(null)
  const [liveSeconds, setLiveSeconds] = useState(0)

  const handleForcedClockOut = useCallback(async () => {
    if (!activeLog) return
    const now = new Date().toISOString()
    const elapsed = (Date.now() - new Date(activeLog.clock_in).getTime()) / 60000
    await supabase
      .from('time_logs')
      .update({ clock_out: now, status: 'clocked_out', total_minutes: Math.round(elapsed) })
      .eq('id', activeLog.id)
    setActiveLog(null)
  }, [activeLog])

  const { isCapturing, error: captureErr, start: startCapture, stop: stopCapture } =
    useScreenCapture(handleForcedClockOut)

  useEffect(() => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]
    void supabase
      .from('time_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('clock_in', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        const active = (data as TimeLog[]).find(l => l.status !== 'clocked_out')
        setActiveLog(active ?? null)
        setDayMinutes((data as TimeLog[]).reduce((s, l) => s + (l.total_minutes ?? 0), 0))
      })
  }, [user])

  // Live elapsed-time ticker — runs every second while clocked in
  useEffect(() => {
    if (!activeLog || activeLog.status === 'clocked_out') {
      setLiveSeconds(0)
      return
    }
    const clockInMs = new Date(activeLog.clock_in).getTime()
    const tick = () => {
      const elapsed = (Date.now() - clockInMs) / 1000
      const lunchSecs = lunchStart ? (Date.now() - lunchStart.getTime()) / 1000 : 0
      setLiveSeconds(Math.max(0, Math.floor(elapsed - lunchSecs)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [activeLog, lunchStart])

  const handleClockIn = async () => {
    if (!user) return
    const ok = await startCapture()
    if (!ok) return
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('time_logs')
      .insert({ user_id: user.id, date: now.split('T')[0], clock_in: now, status: 'working' })
      .select()
      .single()
    if (data) setActiveLog(data as TimeLog)
  }

  const handleStartLunch = async () => {
    if (!activeLog) return
    setLunchStart(new Date())
    await supabase.from('time_logs').update({ status: 'lunch' }).eq('id', activeLog.id)
    setActiveLog(p => p ? { ...p, status: 'lunch' } : null)
  }

  const handleEndLunch = async () => {
    if (!activeLog) return
    setLunchStart(null)
    await supabase.from('time_logs').update({ status: 'working' }).eq('id', activeLog.id)
    setActiveLog(p => p ? { ...p, status: 'working' } : null)
  }

  const handleClockOut = async () => {
    if (!activeLog) return
    stopCapture()
    const now = new Date().toISOString()
    const elapsed = (Date.now() - new Date(activeLog.clock_in).getTime()) / 60000
    const lunchMins = lunchStart ? (Date.now() - lunchStart.getTime()) / 60000 : 0
    const total = Math.round(elapsed - lunchMins)
    await supabase.from('time_logs')
      .update({ clock_out: now, status: 'clocked_out', total_minutes: total })
      .eq('id', activeLog.id)
    setDayMinutes(p => p + total)
    setActiveLog(null)
    setLunchStart(null)
  }

  const isWorking = activeLog?.status === 'working'
  const isOnLunch = activeLog?.status === 'lunch'
  const isSuperAdmin = user?.role === 'Super-admin'

  return (
    <div className="space-y-6">

      {/* Super-admin: full management dashboard at top */}
      {isSuperAdmin && <AdminDashboard />}

      {/* Divider for super-admin */}
      {isSuperAdmin && (
        <div className="flex items-center gap-4 pt-2">
          <div className="flex-1 border-t border-gray-200" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide shrink-0">Your Time Tracking</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>
      )}

      {/* Manager: show team avatars */}
      {user?.role === 'Manager' && <TeamAvatarRow />}

      {/* Page title for Staff / Manager */}
      {!isSuperAdmin && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Time Tracking</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your daily shift and view your activity.</p>
        </div>
      )}

      {captureErr && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {captureErr}
        </div>
      )}

      <StatCards
        status={activeLog?.status ?? 'clocked_out'}
        dayMinutes={dayMinutes}
        liveSeconds={liveSeconds}
        isCapturing={isCapturing}
        isWorking={!!isWorking}
        isOnLunch={!!isOnLunch}
        onClockIn={handleClockIn}
        onStartLunch={handleStartLunch}
        onEndLunch={handleEndLunch}
        onClockOut={handleClockOut}
      />

      {!isSuperAdmin && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900">Activity Breakdown</h3>
            <p className="text-sm text-gray-400 mt-0.5">Apps and websites usage today</p>
            <div className="h-28 flex items-center justify-center text-sm text-gray-300 mt-4">
              Available in Phase 5
            </div>
          </div>
          <RecentScreenshots userId={user?.id ?? ''} />
        </div>
      )}
    </div>
  )
}
