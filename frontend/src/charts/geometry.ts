/** SVG path of a sparkline scaled to its own min/max. */
export function sparkPath(values: number[], w = 200, h = 34, pad = 3): string {
  const mn = Math.min(...values)
  const mx = Math.max(...values)
  return values
    .map((y, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1 || 1)) * w).toFixed(1)},${(h - pad - ((y - mn) / (mx - mn || 1)) * (h - pad * 2)).toFixed(1)}`)
    .join('')
}

/** Stable small number from a string, to seed decorations per entity. */
export const seedOf = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)
