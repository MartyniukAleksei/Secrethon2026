/** Preserve a research result and network layers while selecting another map card. */
export type MarkerLocation = { lat: number; lng: number }
export function hiringLocations(params: URLSearchParams): (MarkerLocation & { employer_id: number })[] {
  try {
    const value: unknown = JSON.parse(params.get('hiring_places') ?? '[]')
    if (!Array.isArray(value) || value.length > 30) return []
    return value.filter(p => p && Number.isSafeInteger(p.employer_id) && p.employer_id > 0 && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180)
  } catch { return [] }
}

/** Only marker clicks supply a location; list and profile links use headquarters. */
export function mapExtras(params: URLSearchParams, companyId?: number, marker?: MarkerLocation): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of ['agent_ids', 'layers', 'network', 'network_other', 'agent_view']) {
    const value = params.get(key)
    if (value) result[key] = value
  }
  if (companyId != null) result.co = String(companyId)
  if (companyId != null && marker) {
    result.marker_lat = String(marker.lat)
    result.marker_lng = String(marker.lng)
  }
  return result
}

export function markerLocation(params: URLSearchParams, companyId?: number): MarkerLocation | undefined {
  if (companyId == null || params.get('co') !== String(companyId)) return undefined
  const rawLat = params.get('marker_lat')
  const rawLng = params.get('marker_lng')
  if (!rawLat?.trim() || !rawLng?.trim()) return undefined
  const lat = Number(rawLat)
  const lng = Number(rawLng)
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180
    ? { lat, lng } : undefined
}
