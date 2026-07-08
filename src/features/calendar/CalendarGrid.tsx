import type { TimeLog, LeaveRequest, PublicHoliday } from '@/types'

export type DayStatus =
  | 'worked_full'   | 'worked_half'
  | 'annual_leave'  | 'medical_leave' | 'time_off'
  | 'absent'        | 'holiday'
  | 'weekend'       | 'future'        | 'today'

const DAY_STYLES: Record<DayStatus, string> = {
  worked_full:   'bg-green-500 text-white hover:bg-green-600',
  worked_half:   'bg-teal-400 text-white hover:bg-teal-500',
  annual_leave:  'bg-blue-500 text-white hover:bg-blue-600',
  medical_leave: 'bg-orange-400 text-white hover:bg-orange-500',
  time_off:      'bg-violet-500 text-white hover:bg-violet-600',
  absent:        'bg-red-400 text-white hover:bg-red-500',
  holiday:       'bg-gray-200 text-gray-600 hover:bg-gray-300',
  weekend:       'text-gray-400 hover:bg-gray-50',
  future:        'text-gray-700 hover:bg-gray-50',
  today:         'bg-violet-100 text-violet-800 ring-2 ring-violet-500 hover:bg-violet-200',
}

export interface DayInfo {
  date: string       // YYYY-MM-DD
  status: DayStatus
  totalMins: number
  clockIn: string | null
  clockOut: string | null
  leave: LeaveRequest | null
  isHoliday: PublicHoliday | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

function getLeave(dateStr: string, leaves: LeaveRequest[]): LeaveRequest | null {
  return leaves.find(l =>
    l.status === 'approved' && l.start_date <= dateStr && l.end_date >= dateStr
  ) ?? null
}

function getHoliday(dateStr: string, holidays: PublicHoliday[]): PublicHoliday | null {
  return holidays.find(h => h.date === dateStr) ?? null
}

function classifyDay(
  date: Date,
  today: Date,
  logs: TimeLog[],
  leaves: LeaveRequest[],
  holidays: PublicHoliday[],
): DayInfo {
  const dateStr = isoDate(date)
  const todayStr = isoDate(today)
  const isFuture = dateStr > todayStr
  const isToday = dateStr === todayStr
  const weekend = isWeekend(date)

  const holiday = getHoliday(dateStr, holidays)
  const leave = getLeave(dateStr, leaves)
  const dayLogs = logs.filter(l => l.date === dateStr)
  const totalMins = dayLogs.reduce((s, l) => s + (l.total_minutes ?? 0), 0)
  const hasLog = dayLogs.length > 0
  const firstLog = dayLogs[0]
  const clockIn = firstLog?.clock_in ?? null
  const clockOut = firstLog?.clock_out ?? null

  let status: DayStatus

  if (holiday) {
    status = 'holiday'
  } else if (leave) {
    status =
      leave.type === 'Annual' ? 'annual_leave' :
      leave.type === 'Medical' ? 'medical_leave' :
      'time_off'
  } else if (isFuture) {
    status = 'future'
  } else if (weekend) {
    status = 'weekend'
  } else if (isToday && !hasLog) {
    status = 'today'
  } else if (hasLog) {
    status = totalMins >= 240 ? 'worked_full' : 'worked_half'
  } else {
    status = 'absent'
  }

  return { date: dateStr, status, totalMins, clockIn, clockOut, leave, isHoliday: holiday }
}

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
  year: number
  month: number   // 0-indexed
  timeLogs: TimeLog[]
  leaves: LeaveRequest[]
  holidays: PublicHoliday[]
  onPrev: () => void
  onNext: () => void
  onDayClick?: (info: DayInfo) => void
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']

export function CalendarGrid({ year, month, timeLogs, leaves, holidays, onPrev, onNext, onDayClick }: Props) {
  const today = new Date()
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startOffset = firstDay.getDay() // 0=Sun

  const cells: (DayInfo | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1)
      return classifyDay(d, today, timeLogs, leaves, holidays)
    }),
  ]

  // Pad to complete the last row
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="select-none">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onPrev} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-gray-600 text-sm">‹</button>
        <span className="font-bold text-gray-900 text-base">{MONTHS[month]} {year}</span>
        <button onClick={onNext} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-gray-600 text-sm">›</button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs font-semibold text-gray-500 py-2">{d}</div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((info, idx) => {
          if (!info) {
            return <div key={`empty-${idx}`} />
          }
          const dayNum = new Date(info.date).getDate()
          return (
            <button
              key={info.date}
              onClick={() => onDayClick?.(info)}
              className={`aspect-square rounded-xl flex items-center justify-center text-sm font-semibold transition-all ${DAY_STYLES[info.status]} ${onDayClick ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {dayNum}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Exports for tabs ─────────────────────────────────────────────────────────
export { DAY_STYLES }
