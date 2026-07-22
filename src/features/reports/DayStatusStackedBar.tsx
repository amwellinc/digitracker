export interface DayStatusDatum {
  label: string
  present: number
  onLeave: number
  timeOff: number
  absent: number
}

// Fixed categorical order — never reassigned per-render, so a filtered/sorted
// list never repaints what a color means.
const SERIES: { key: keyof Omit<DayStatusDatum, 'label'>; name: string; color: string }[] = [
  { key: 'present', name: 'Present',  color: '#059669' },
  { key: 'onLeave', name: 'On Leave', color: '#2563EB' },
  { key: 'timeOff', name: 'Time Off', color: '#0891B2' },
  { key: 'absent',  name: 'Absent',   color: '#EF4444' },
]

export function DayStatusStackedBar({ data }: { data: DayStatusDatum[] }) {
  const barHeight = 18
  const gap = 2

  return (
    <div>
      {/* Legend — always present for >= 2 series */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        {SERIES.map(s => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            {s.name}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {data.map(d => {
          const total = Math.max(1, d.present + d.onLeave + d.timeOff + d.absent)
          return (
            <div key={d.label} className="flex items-center gap-3">
              <span className="w-28 text-xs text-gray-600 truncate flex-shrink-0">{d.label}</span>
              <svg width="100%" height={barHeight} viewBox={`0 0 100 ${barHeight}`} preserveAspectRatio="none" className="flex-1">
                {(() => {
                  let cursor = 0
                  return SERIES.map(s => {
                    const value = d[s.key]
                    if (value === 0) return null
                    const widthPct = (value / total) * 100
                    const x = cursor
                    cursor += widthPct
                    const isFirst = x === 0
                    const isLast = Math.round(cursor) >= 100
                    return (
                      <rect
                        key={s.key}
                        x={x + (isFirst ? 0 : gap / 20)}
                        y={0}
                        width={Math.max(0, widthPct - (isFirst || isLast ? gap / 20 : gap / 10))}
                        height={barHeight}
                        rx={2}
                        fill={s.color}
                      >
                        <title>{`${s.name}: ${value} day${value !== 1 ? 's' : ''}`}</title>
                      </rect>
                    )
                  })
                })()}
              </svg>
            </div>
          )
        })}
      </div>
    </div>
  )
}
