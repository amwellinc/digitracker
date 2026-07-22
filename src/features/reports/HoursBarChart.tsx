interface BarDatum {
  label: string
  value: number
}

interface HoursBarChartProps {
  data: BarDatum[]
  color: string
  unit?: string
  height?: number
}

// A single-series bar chart in plain SVG. Bars are capped at 24px thick with a
// 4px rounded data-end (square at the baseline), a 2px gap between adjacent
// bars, three round-number gridlines, and a native-title hover tooltip.
// Direct value labels only when there are few enough bars for them to stay
// readable — past that, the tooltip and the table below carry the values.
export function HoursBarChart({ data, color, unit = 'h', height = 180 }: HoursBarChartProps) {
  const barGap = 2
  const barWidth = Math.min(24, Math.max(8, Math.floor(320 / Math.max(data.length, 1)) - barGap))
  const chartWidth = data.length * (barWidth + barGap)
  const maxValue = Math.max(1, ...data.map(d => d.value))
  const niceMax = Math.ceil(maxValue / 4) * 4 || 4
  const plotHeight = height - 24 // leave room for x-axis labels
  const labelEvery = data.length <= 10

  function y(value: number) { return plotHeight - (value / niceMax) * plotHeight }

  return (
    <div className="overflow-x-auto">
      <svg
        width={Math.max(chartWidth, 200)}
        height={height + 16}
        role="img"
        aria-label={`Bar chart: ${data.map(d => `${d.label} ${d.value}${unit}`).join(', ')}`}
      >
        {/* Gridlines at 0, half, and max — recessive, one step off the surface */}
        {[0, 0.5, 1].map(f => (
          <line
            key={f}
            x1={0} x2={chartWidth}
            y1={y(niceMax * f)} y2={y(niceMax * f)}
            stroke="#E5E7EB" strokeWidth={1}
          />
        ))}

        {data.map((d, i) => {
          const barHeight = Math.max(0, plotHeight - y(d.value))
          const x = i * (barWidth + barGap)
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${d.value}${unit}`}</title>
              <path
                d={`M ${x} ${plotHeight}
                    L ${x} ${y(d.value) + 4}
                    Q ${x} ${y(d.value)} ${x + 4} ${y(d.value)}
                    L ${x + barWidth - 4} ${y(d.value)}
                    Q ${x + barWidth} ${y(d.value)} ${x + barWidth} ${y(d.value) + 4}
                    L ${x + barWidth} ${plotHeight} Z`}
                fill={color}
                opacity={barHeight < 1 ? 0 : 1}
              />
              {labelEvery && d.value > 0 && (
                <text x={x + barWidth / 2} y={y(d.value) - 4} textAnchor="middle" className="fill-gray-500" fontSize={9}>
                  {d.value}
                </text>
              )}
              <text
                x={x + barWidth / 2} y={height}
                textAnchor="middle" className="fill-gray-400" fontSize={9}
              >
                {data.length > 15 ? '' : d.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
