import { useEffect, useRef } from 'react'
import L from 'leaflet'
import './leafletGlobal'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import type { ApiMapPoint } from '../api/types'
import { markerIcon, SELECTED_COLOR } from './mapMarkers'

const COUNTRY_CENTER: L.LatLngExpression = [62, 95]

/** The fallback map when 2GIS is unavailable: OpenStreetMap tiles, the same hiring places, one cluster layer. */
export default function LeafletMap({ points, selectedId, colorOf, onSelect }: {
  points: ApiMapPoint[]
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
      const icon = L.icon({
        iconUrl: markerIcon(selected ? SELECTED_COLOR : colorOf(p.employer_id)),
        iconSize: selected ? [40, 50] : [32, 40],
        iconAnchor: selected ? [20, 50] : [16, 40],
      })
      const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: selected ? 1000 : 0, title: p.locality ?? undefined })
      marker.on('click', () => onSelect(p.employer_id))
      group.addLayer(marker)
    }
    map.addLayer(group)
    const focus = points.filter((p) => p.employer_id === selectedId)
    const shown = focus.length ? focus : points
    if (shown.length) map.fitBounds(L.latLngBounds(shown.map((p) => [p.lat, p.lng])), { padding: [50, 50], maxZoom: 13 })
    return () => {
      map.removeLayer(group)
    }
  }, [points, selectedId, colorOf, onSelect])

  return <div className="map-canvas map-leaflet" ref={container} aria-label="Карта місць найму на базі OpenStreetMap" />
}
