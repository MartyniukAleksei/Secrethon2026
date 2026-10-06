import { useMemo } from 'react'

// Deterministic PRNG so the same seed always draws the same contours.
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function contours(seed: number, W: number, H: number): string[] {
  const r = rng(seed)
  const paths: string[] = []
  const hills: [number, number, number][] = [[W * 0.25, H * 0.35, 260], [W * 0.72, H * 0.6, 300], [W * 0.9, H * 0.1, 160]]
  hills.forEach(([cx, cy, rm]) => {
    const a = r() * 6
    const b = r() * 6
    for (let i = 1; i <= 9; i++) {
      const rad = (rm * i) / 9
      const pts: string[] = []
      for (let k = 0; k <= 36; k++) {
        const t = (k / 36) * Math.PI * 2
        const rr = rad * (1 + 0.15 * Math.sin(2 * t + a) + 0.07 * Math.sin(3 * t + b + i * 0.3))
        pts.push(`${(cx + rr * Math.cos(t) * 1.3).toFixed(1)},${(cy + rr * Math.sin(t) * 0.8).toFixed(1)}`)
      }
      paths.push(`M${pts.join('L')}Z`)
    }
  })
  return paths
}

/** Decorative topographic contours, the map motif used in headers and empty map slots. */
export function Topo({ seed, className = 'topo' }: { seed: number; className?: string }) {
  const paths = useMemo(() => contours(seed, 1000, 600), [seed])
  return (
    <svg className={className} viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}
