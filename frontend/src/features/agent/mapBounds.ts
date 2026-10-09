import type { Bounds } from './types'

export function normalizeBounds(west: number, south: number, east: number, north: number): Bounds {
  const wrap = (v: number) => ((v + 180) % 360 + 360) % 360 - 180
  return { west: east - west >= 360 ? -180 : wrap(west), east: east - west >= 360 ? 180 : wrap(east), south: Math.max(-90, south), north: Math.min(90, north) }
}

export function insideBounds(lng: number, lat: number, bounds: Bounds) {
  return lat >= bounds.south && lat <= bounds.north && (bounds.west <= bounds.east ? lng >= bounds.west && lng <= bounds.east : lng >= bounds.west || lng <= bounds.east)
}
