import { useAuth } from '@/hooks/useAuth'

interface Props {
  status: 'working' | 'lunch' | 'clocked_out'
  dayMinutes: number
  liveSeconds: number
  isCapturing: boolean
  isWorking: boolean
  isOnLunch: boolean
  onClockIn: () => void
  onStartLunch: () => void
  onEndLunch: () => void
  onClockOut: () => void
}

function fmtTime(totalMins: number, extraSecs: number): string {
  const total = totalMins * 60 + extraSecs
  const h = Math.floor(total / 3600).toString().padStart(2, '0')
  const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0')
  const s = (total % 60).toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

function calcTargetMinutes(timeIn?: string, timeOut?: string): number {
  if (!timeIn || !timeOut) return 480
  const [inH, inM] = timeIn.split(':').map(Number)
  const [outH, outM] = timeOut.split(':').map(Number)
  const diff = (outH * 60 + outM) - (inH * 60 + inM)
  return diff > 0 ? diff : 480
}

export function StatCards({
  status,
  dayMinutes,
  liveSeconds,
  isCapturing,
  isWorking,
  isOnLunch,
  onClockIn,
  onStartLunch,
  onEndLunch,
  onClockOut,
}: Props) {
  const { user } = useAuth()

  const targetMinutes = calcTargetMinutes(user?.reporting_time_in, user?.reporting_time_out)
  const totalSecondsWorked = dayMinutes * 60 + liveSeconds
  const progressPct = Math.min(100, Math.round((totalSecondsWorked / (targetMinutes * 60)) * 100))

  const statusLabel =
    status === 'working' ? 'Online' : status === 'lunch' ? 'On Lunch' : 'Offline'
  const statusColor =
    status === 'working' ? 'text-green-600' : status === 'lunch' ? 'text-amber-500' : 'text-gray-400'
  const dotColor =
    status === 'working' ? 'bg-green-500' : status === 'lunch' ? 'bg-amber-500' : 'bg-gray-300'
  const statusDesc =
    status === 'working'
      ? 'You are currently clocked in.'
      : status === 'lunch'
        ? 'You are on a lunch break.'
        : 'You are currently clocked out.'

  const targetHours = (targetMinutes / 60).toFixed(1).replace(/\.0$/, '')
  const workedHours = (totalSecondsWorked / 3600).toFixed(1)

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Status card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between text-gray-400 text-sm mb-3">
          <span>Status</span>
          <span className={`flex items-center gap-1.5 ${statusColor}`}>
            <span
              className={`w-2.5 h-2.5 rounded-full ${dotColor} ${status === 'working' ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
          </span>
        </div>
        <p className={`text-2xl font-bold ${statusColor}`}>{statusLabel}</p>
        <p className="text-xs text-gray-400 mt-1">{statusDesc}</p>
        {user?.reporting_time_in && user?.reporting_time_out && (
          <p className="text-xs text-gray-300 mt-2">
            Shift {user.reporting_time_in} – {user.reporting_time_out}
          </p>
        )}
      </div>

      {/* Day Worked card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between text-gray-400 text-sm mb-3">
          <span>Day Worked</span>
          <span aria-hidden="true">⏱</span>
        </div>
        <p className="text-2xl font-bold text-gray-900 font-mono">{fmtTime(dayMinutes, liveSeconds)}</p>
        <p className="text-xs text-gray-400 mt-1">
          {workedHours}h of {targetHours}h target
        </p>
        <div className="mt-3">
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progressPct >= 100 ? 'bg-green-500' : progressPct >= 75 ? 'bg-violet-500' : 'bg-violet-300'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-300 mt-1 text-right">{progressPct}%</p>
        </div>
      </div>

      {/* Actions card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-gray-400 text-sm mb-3">Actions</div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isWorking && !isOnLunch && (
            <button
              onClick={onClockIn}
              className="flex items-center gap-2 bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700"
            >
              Clock In
            </button>
          )}
          {isWorking && (
            <>
              <button
                onClick={onStartLunch}
                className="flex items-center gap-2 border border-gray-200 text-gray-600 rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
              >
                Start Lunch
              </button>
              <button
                onClick={onClockOut}
                className="flex items-center gap-2 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm hover:bg-red-50"
              >
                Clock Out
              </button>
            </>
          )}
          {isOnLunch && (
            <>
              <button
                onClick={onEndLunch}
                className="flex items-center gap-2 bg-amber-500 text-white rounded-lg px-3 py-2 text-sm hover:bg-amber-600"
              >
                End Lunch
              </button>
              <button
                onClick={onClockOut}
                className="flex items-center gap-2 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm hover:bg-red-50"
              >
                Clock Out
              </button>
            </>
          )}
        </div>
        {isCapturing && (
          <p className="text-xs text-green-500 mt-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" aria-hidden="true" />
            Screen capture active
          </p>
        )}
      </div>
    </div>
  )
}
