import { fmt, monthShort } from '../domain/format'

export type Series = { values: number[]; color: string; area?: boolean; dashed?: boolean; width?: number }

type Props = { months: Date[]; series: Series[]; label: string; width?: number; height?: number }

const axisLabel = (v: number) =>
  v >= 1000 ? `${(v / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} тис.` : fmt(v)

/** Monthly line chart. Fixed viewBox, scales to the container width. */
export function LineChart({ months, series, label, width: W = 640, height: H = 230 }: Props) {
  const L = 60
  const R = 8
  const T = 12
  const B = 26
  const n = months.length
  const mx = Math.max(1, ...series.flatMap((s) => s.values)) * 1.1
  const x = (i: number) => L + (i / (n - 1 || 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / mx) * (H - T - B)

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <g className="grid">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(mx * f)} y2={y(mx * f)} />
            <text x={L - 8} y={y(mx * f) + 4} textAnchor="end">{axisLabel(mx * f)}</text>
          </g>
        ))}
      </g>
      {months.map((m, i) => (
        <text key={m.getTime()} x={x(i)} y={H - 6} textAnchor="middle">{monthShort(m)}</text>
      ))}
      {series.map((s, k) => {
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
        return (
          <g key={k}>
            {s.area && <path d={`${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} style={{ fill: s.color }} opacity={0.1} />}
            <path d={d} fill="none" style={{ stroke: s.color }} strokeWidth={s.width ?? 2.5} strokeDasharray={s.dashed ? '5 5' : undefined} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        )
      })}
    </svg>
  )
}
