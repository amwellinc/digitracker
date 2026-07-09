import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useClockContext } from './ClockContext'
import type { Screenshot } from '@/types'
import { StatCards } from './StatCards'
import { TeamAvatarRow } from './TeamAvatarRow'
import { AdminDashboard } from '@/features/dashboard/AdminDashboard'

export function TimeTrackingPage() {
  const { user } = useAuth()
  const {
    activeLog,
    dayMinutes,
    lunchStart,
    isCapturing,
    captureError,
    handleClockIn,
    handleClockOut,
    handleStartLunch,
    handleEndLunch,
  } = useClockContext()

  const [liveSeconds,  setLiveSeconds]  = useState(0)
  const [recentShots,  setRecentShots]  = useState<Screenshot[]>([])

  // Live elapsed-time ticker
  useEffect(() => {
    if (!activeLog || activeLog.status === 'clocked_out') {
      setLiveSeconds(0)
      return
    }
    const clockInMs = new Date(activeLog.clock_in).getTime()
    const tick = () => {
      const elapsed    = (Date.now() - clockInMs) / 1000
      const lunchSecs  = lunchStart ? (Date.now() - lunchStart.getTime()) / 1000 : 0
      setLiveSeconds(Math.max(0, Math.floor(elapsed - lunchSecs)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [activeLog, lunchStart])

  // Recent screenshots for today
  useEffect(() => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]
    void supabase
      .from('screenshots')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('timestamp', { ascending: false })
      .limit(4)
      .then(({ data }) => setRecentShots((data ?? []) as Screenshot[]))
  }, [user])

  // Refresh recent shots whenever a new capture completes
  useEffect(() => {
    if (!isCapturing || !user) return
    const today = new Date().toISOString().split('T')[0]
    const id = setInterval(() => {
      void supabase
        .from('screenshots')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', today)
        .order('timestamp', { ascending: false })
        .limit(4)
        .then(({ data }) => setRecentShots((data ?? []) as Screenshot[]))
    }, 60_000)
    return () => clearInterval(id)
  }, [isCapturing, user])

  const isWorking    = activeLog?.status === 'working'
  const isOnLunch    = activeLog?.status === 'lunch'
  const isSuperAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'

  return (
    <div className="space-y-6">
      {isSuperAdmin && <AdminDashboard />}

      {isSuperAdmin && (
        <div className="flex items-center gap-4 pt-2">
          <div className="flex-1 border-t border-gray-200" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide shrink-0">Your Time Tracking</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>
      )}

      {user?.role === 'Manager' && <TeamAvatarRow />}

      {!isSuperAdmin && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Time Tracking</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your daily shift and view your activity.</p>
        </div>
      )}

      {captureError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {captureError}
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
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-900">Recent Screenshots</h3>
              <p className="text-xs text-gray-400 mt-0.5">Auto-captured every 11–18 min while clocked in</p>
            </div>
            <Link to="/screenshots" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
              View all →
            </Link>
          </div>
          {recentShots.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-sm text-gray-300 rounded-lg bg-gray-50">
              No screenshots today yet
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {recentShots.map(s => (
                <Link
                  key={s.id}
                  to="/screenshots"
                  className="aspect-video bg-gray-100 rounded-lg overflow-hidden hover:opacity-80 transition-opacity block"
                >
                  <img src={s.url} alt="Screenshot" className="w-full h-full object-cover" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
