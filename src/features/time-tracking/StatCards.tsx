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
  const statusLabel =
    status === 'working' ? 'Online' : status === 'lunch' ? 'On Lunch' : 'Offline'
  const statusColor =
    status === 'working'
      ? 'text-green-600'
      : status === 'lunch'
        ? 'text-amber-500'
        : 'text-gray-500'
  const statusDesc =
    status === 'working'
      ? 'You are currently clocked in.'
      : status === 'lunch'
        ? 'You are on a lunch break.'
        : 'You are currently clocked out.'

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Status card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between text-gray-400 text-sm mb-3">
          <span>Status</span>
          <span aria-hidden="true">〜</span>
        </div>
        <p className={`text-2xl font-bold ${statusColor}`}>{statusLabel}</p>
        <p className="text-xs text-gray-400 mt-1">{statusDesc}</p>
      </div>

      {/* Day Worked card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between text-gray-400 text-sm mb-3">
          <span>Day Worked</span>
          <span aria-hidden="true">⏱</span>
        </div>
        <p className="text-2xl font-bold text-gray-900 font-mono">{fmtTime(dayMinutes, liveSeconds)}</p>
        <p className="text-xs text-gray-400 mt-1">Today's total logged hours</p>
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
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" aria-hidden="true" />
            Screen capture active
          </p>
        )}
      </div>
    </div>
  )
}
