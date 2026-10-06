type Part = { key: string; value: number; color: string }

/** Ring chart, at most ~7 segments. Center shows a total and its unit. */
export function Donut({ parts, total, unit }: { parts: Part[]; total: string; unit: string }) {
  const R = 52
  const r = 36
  const cx = 60
  const cy = 60
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1
  const P = (rad: number, ang: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`
  // Start angle of each part = sum of the spans before it.
  const starts = parts.map((_, i) => -Math.PI / 2 + (parts.slice(0, i).reduce((acc, q) => acc + q.value, 0) / sum) * Math.PI * 2)
  const arcs = parts.map((p, i) => {
    const span = (p.value / sum) * Math.PI * 2
    const a0 = starts[i] + 0.02
    const a1 = starts[i] + span - 0.02
    if (a1 <= a0) return null
    const big = a1 - a0 > Math.PI ? 1 : 0
    return <path key={p.key} d={`M${P(R, a0)}A${R},${R} 0 ${big} 1 ${P(R, a1)}L${P(r, a1)}A${r},${r} 0 ${big} 0 ${P(r, a0)}Z`} style={{ fill: p.color }} />
  })
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      {arcs}
      <text x="60" y="59" textAnchor="middle" style={{ font: '600 15px var(--ff-sans)', fill: 'var(--label-1)' }}>{total}</text>
      <text x="60" y="75" textAnchor="middle" style={{ font: '500 10px var(--ff-sans)', fill: 'var(--label-2)' }}>{unit}</text>
    </svg>
  )
}
