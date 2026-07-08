import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TimeLog, User } from '@/types'

interface Props {
  user: User & { isOnline?: boolean }
  onClose: () => void
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function UserActivityDrawer({ user, onClose }: Props) {
  const [logs, setLogs] = useState<TimeLog[]>([])

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    void supabase
      .from('time_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('clock_in')
      .then(({ data }) => setLogs((data ?? []) as TimeLog[]))
  }, [user.id])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white w-80 h-full shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="font-semibold">{user.name}</p>
            <p className="text-xs text-gray-400">{user.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm font-medium text-gray-500 mb-3">Today's Activity</p>
          {logs.length === 0 && (
            <p className="text-sm text-gray-400">No activity logged today.</p>
          )}
          {logs.map(log => (
            <div key={log.id} className="border rounded-lg p-3 mb-2 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Clock In</span>
                <span className="font-mono">{fmtTime(log.clock_in)}</span>
              </div>
              {log.clock_out && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Clock Out</span>
                  <span className="font-mono">{fmtTime(log.clock_out)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={`font-medium capitalize ${
                  log.status === 'working' ? 'text-green-600' :
                  log.status === 'lunch' ? 'text-amber-500' : 'text-gray-500'
                }`}>{(log.status ?? '').replace('_', ' ')}</span>
              </div>
              {log.total_minutes > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Duration</span>
                  <span>{Math.round(log.total_minutes)} min</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
