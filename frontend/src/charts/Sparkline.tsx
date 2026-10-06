import { sparkPath } from './geometry'

type Props = { values: number[]; width?: number; height?: number; color?: string; area?: boolean; className?: string }

export function Sparkline({ values, width = 200, height = 34, color, area = true, className = 'spark-svg' }: Props) {
  if (values.length < 2) return null
  const d = sparkPath(values, width, height)
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {area && <path className="spark-area" d={`${d}L${width},${height}L0,${height}Z`} style={color ? { fill: color } : undefined} />}
      <path className="spark" d={d} style={color ? { stroke: color } : undefined} />
    </svg>
  )
}
