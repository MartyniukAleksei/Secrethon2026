import { useEffect, useRef } from 'react'
import L from 'leaflet'
import './leafletGlobal'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import type { ApiMapPoint, ApiMapSite } from '../api/types'
import { hiringIcon, SELECTED_COLOR, siteIcon } from './mapMarkers'

const COUNTRY_CENTER: L.LatLngExpression = [62, 95]

/** The fallback map when 2GIS is unavailable: OpenStreetMap tiles, the same sites and hiring places. */
export default function LeafletMap({ points, sites, selectedId, colorOf, onSelect }: {
  points: ApiMapPoint[]
  sites: ApiMapSite[]
  selectedId?: number
  colorOf: (employerId: number) => string
  onSelect: (employerId: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, { center: COUNTRY_CENTER, zoom: 3, worldCopyJump: true, zoomControl: false })
    // The page's own controls sit in the top corners.
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    // The slot settles its size after the first layout; keep the tiles covering it.
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(container.current)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    mapRef.current = map
    return () => {
      resize.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const group = L.markerClusterGroup({ maxClusterRadius: 55, showCoverageOnHover: false })
    for (const p of points) {
      const selected = p.employer_id === selectedId
      const size = selected ? 24 : 18
      const icon = L.icon({ iconUrl: hiringIcon(selected ? SELECTED_COLOR : undefined), iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
      const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: selected ? 900 : 0, title: p.locality ?? undefined })
      marker.on('click', () => onSelect(p.employer_id))
      group.addLayer(marker)
    }
    for (const s of sites) {
      const selected = s.employer_id === selectedId
      const icon = L.icon({
        iconUrl: siteIcon(selected ? SELECTED_COLOR : colorOf(s.employer_id), s.kind),
        iconSize: selected ? [40, 50] : [32, 40],
        iconAnchor: selected ? [20, 50] : [16, 40],
      })
      const marker = L.marker([s.lat, s.lng], { icon, zIndexOffset: selected ? 1000 : 100, title: s.name ?? s.address })
      marker.on('click', () => onSelect(s.employer_id))
      group.addLayer(marker)
    }
    map.addLayer(group)
    const all = [...points, ...sites]
    const focus = all.filter((p) => p.employer_id === selectedId)
    const shown = focus.length ? focus : all
    if (shown.length) map.fitBounds(L.latLngBounds(shown.map((p) => [p.lat, p.lng])), { padding: [50, 50], maxZoom: 13 })
    return () => {
      map.removeLayer(group)
    }
  }, [points, sites, selectedId, colorOf, onSelect])

  return <div className="map-canvas map-leaflet" ref={container} aria-label="Карта місць найму на базі OpenStreetMap" />
}
