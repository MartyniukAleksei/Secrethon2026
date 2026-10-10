import { useEffect, useRef } from 'react'
import L from 'leaflet'
import './leafletGlobal'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import type { ApiMapPoint, ApiMapSite } from '../api/types'
import { hiringIcon, SELECTED_COLOR, siteIcon } from './mapMarkers'
import type { Bounds } from '../features/agent/types'
import { normalizeBounds } from '../features/agent/mapBounds'
import { cameraPadding, companyLocation } from './mapCamera'
import type { MarkerLocation } from './mapNavigation'

const COUNTRY_CENTER: L.LatLngExpression = [62, 95]
export type LeafletConnection = {
  from: [number, number]; to: [number, number]; color: string; label: string
}

/** The fallback map when 2GIS is unavailable: OpenStreetMap tiles, the same sites and hiring places. */
export default function LeafletMap({ points, sites, selectedId, selectedMarker, colorOf, onSelect, onBoundsChange, connections, focusNetwork, focusHiring = false, onRelationSelect }: {
  points: ApiMapPoint[]
  sites: ApiMapSite[]
  selectedId?: number
  selectedMarker?: MarkerLocation
  colorOf: (employerId: number) => string
  onSelect: (employerId: number, marker: MarkerLocation) => void
  onBoundsChange?: (bounds: Bounds) => void
  connections: LeafletConnection[]
  focusNetwork: boolean
  focusHiring?: boolean
  onRelationSelect: (index: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, { center: COUNTRY_CENTER, zoom: 3, worldCopyJump: true, zoomControl: false })
    // The page's own controls sit in the top corners.
    L.control.zoom({ position: 'bottomleft' }).addTo(map)
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
    if (!map || !onBoundsChange) return
    const update = () => { const b = map.getBounds(); onBoundsChange(normalizeBounds(b.getWest(), b.getSouth(), b.getEast(), b.getNorth())) }
    map.on('moveend resize', update)
    update()
    return () => { map.off('moveend resize', update) }
  }, [onBoundsChange])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const group = L.markerClusterGroup({ maxClusterRadius: 55, showCoverageOnHover: false })
    for (const p of points) {
      const selected = p.employer_id === selectedId
      const size = selected ? 24 : 18
      const icon = L.icon({ iconUrl: hiringIcon(selected ? SELECTED_COLOR : undefined), iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
      const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: selected ? 900 : 0, title: p.locality ?? undefined })
      marker.on('click', () => onSelect(p.employer_id, p))
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
      marker.on('click', () => onSelect(s.employer_id, s))
      group.addLayer(marker)
    }
    map.addLayer(group)
    return () => {
      map.removeLayer(group)
    }
  }, [points, sites, selectedId, colorOf, onSelect])

  useEffect(() => {
    const map = mapRef.current
    const slot = container.current?.parentElement
    if (!map || !slot) return
    const frame = () => {
      const selected = focusHiring ? undefined : selectedMarker ?? (!focusNetwork ? companyLocation(points, sites, selectedId) : undefined)
      const shown = selected ? [selected] : [...points, ...sites]
      const padding = cameraPadding(slot)
      if (shown.length) map.fitBounds(L.latLngBounds(shown.map(p => [p.lat, p.lng])), {
        paddingTopLeft: [padding.left, padding.top], paddingBottomRight: [padding.right, padding.bottom],
        maxZoom: selected ? 14 : 13,
      })
      else map.setView(COUNTRY_CENTER, 3)
    }
    frame()
    const resize = new ResizeObserver(frame)
    resize.observe(slot)
    const card = slot.querySelector('.map-pop')
    if (card) resize.observe(card)
    return () => resize.disconnect()
  }, [points, sites, selectedId, selectedMarker, focusNetwork, focusHiring])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const group = L.layerGroup()
    connections.forEach((connection, index) => {
      if (connection.from[0] === connection.to[0] && connection.from[1] === connection.to[1]) return
      const label = document.createElement('span')
      label.textContent = connection.label
      const line = L.polyline([connection.from, connection.to], { color: connection.color, weight: 3 })
      line.bindTooltip(label)
      line.on('click', () => onRelationSelect(index))
      group.addLayer(line)
    })
    group.addTo(map)
    return () => { group.removeFrom(map) }
  }, [connections, onRelationSelect])

  return <div className="map-canvas map-leaflet" ref={container} aria-label="Карта місць найму на базі OpenStreetMap" />
}
