import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { load } from '@2gis/mapgl'
import { Clusterer } from '@2gis/mapgl-clusterer'
import type { Map as MapGL } from '@2gis/mapgl/types'
import { api } from '../api/client'
import type { ApiMapNetwork, ApiMapPoint, ApiMapRelation, ApiMapSite } from '../api/types'
import { useApi } from '../data/useApi'
import { useData } from '../data/DataContext'
import { effectiveCategory, isSanctioned } from '../domain/labels'
import { categoryKey, HIRING_COLOR, hiringIcon, LEGEND, markerColor, SELECTED_COLOR, siteIcon } from './mapMarkers'
import type { Employer } from '../domain/types'
import { useToast } from '../features/toast/ToastContext'
import { useFilters } from '../state/FiltersContext'
import { Icon } from '../ui/Icon'
import './MapSlot.css'
import type { Bounds, MapView } from '../features/agent/types'
import { insideBounds, normalizeBounds } from '../features/agent/mapBounds'
import { useAgent } from '../features/agent/AgentContext'
import { hiringLocations, mapExtras, markerLocation, type MarkerLocation } from './mapNavigation'
import type { LeafletConnection } from './LeafletMap'
import { cameraPadding, companyLocation } from './mapCamera'

const API_KEY = import.meta.env.VITE_2GIS_API_KEY?.trim()
const EMPTY: ApiMapPoint[] = []
const EMPTY_SITES: ApiMapSite[] = []
const EMPTY_NETWORK: ApiMapNetwork = { relations: [], company_tags: [] }
const RELATION_COLORS = { supplier: '#b45309', parent: '#2563eb', related: '#7c3aed', bank: '#0f766e', successor: '#64748b', branch: '#2563eb' }
const RELATION_NAMES = { supplier: 'Постачальник → замовник', parent: 'Материнська → дочірня компанія', related: 'Пов’язані компанії', bank: 'Зв’язок із банком', successor: 'Правонаступництво', branch: 'Філія або представництво' }
const OTHER_KINDS = ['related', 'bank', 'successor', 'branch'] as const
const COUNTRY_CENTER = [95, 62]
// From this zoom on, markers are never clustered: every cluster can be opened by zooming to it.
const CLUSTER_OFF_ZOOM = 15
const CLUSTER_COLOR = HIRING_COLOR
const SITE_CLUSTER_COLOR = '#334155'
// Keep the count inside the icon: separate MapGL labels can remain visible when
// the clusterer hides cached markers during zooming and overlap the new count.
const clusterIcon = (color: string, count: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="${color}" fill-opacity=".9" stroke="white" stroke-width="3"/><text x="22" y="22" dy=".35em" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="${String(count).length > 3 ? 11 : 14}">${count}</text></svg>`)}`
type Spot = { employer_id: number; lat: number; lng: number }
type Place = { lng: number; lat: number; ids: number[] }
/** Places at (almost) one spot, ~10 m: one marker that lists every employer there. */
const spotKey = (p: { lng: number; lat: number }) => `${p.lng.toFixed(4)}:${p.lat.toFixed(4)}`
function places(points: Spot[]): Place[] {
  const byKey = new Map<string, Place>()
  for (const p of points) {
    const key = spotKey(p)
    const place = byKey.get(key) ?? { lng: p.lng, lat: p.lat, ids: [] }
    if (!place.ids.includes(p.employer_id)) place.ids.push(p.employer_id)
    byKey.set(key, place)
  }
  return [...byKey.values()]
}
let sdkPromise: ReturnType<typeof load> | undefined
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = new Promise<Awaited<ReturnType<typeof load>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MapGL SDK loading timed out')), 15000)
      load('https://mapgl.2gis.com/api/js/v1.78.1').then(resolve, reject).finally(() => clearTimeout(timer))
    }).catch((error: unknown) => {
      sdkPromise = undefined
      throw error
    })
  }
  return sdkPromise
}
// OpenStreetMap stands in when 2GIS cannot be reached (loaded only then).
const LeafletMap = lazy(() => import('./LeafletMap'))

function fit(map: MapGL, points: { lng: number; lat: number }[]) {
  if (!points.length) {
    map.setCenter(COUNTRY_CENTER)
    map.setZoom(3)
  } else if (points.every((p) => p.lng === points[0].lng && p.lat === points[0].lat)) {
    map.setCenter([points[0].lng, points[0].lat])
    map.setZoom(12)
  } else {
    const bounds = points.reduce((b, p) => ({
      west: Math.min(b.west, p.lng), south: Math.min(b.south, p.lat),
      east: Math.max(b.east, p.lng), north: Math.max(b.north, p.lat),
    }), { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity })
    map.fitBounds({
      southWest: [bounds.west, bounds.south], northEast: [bounds.east, bounds.north],
    }, { padding: { top: 80, bottom: 100, left: 50, right: 50 }, maxZoom: 13 })
  }
}

export function MapSlot({ employers, selectedId, children, onContextChange, search = '', resultIds = [] }: {
  employers: Employer[]
  selectedId?: number
  children?: ReactNode
  onContextChange?: (view: MapView | null) => void
  search?: string
  resultIds?: number[]
}) {
  const { byId } = useData()
  const agent = useAgent()
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const navigate = useNavigate()
  const filters = useFilters()
  const [params] = useSearchParams()
  const selectedMarker = useMemo(() => markerLocation(params, selectedId), [params, selectedId])
  const requestedHiring = useMemo(() => hiringLocations(params), [params])
  const initialLayers = params.get('layers')?.split(',') ?? []
  const say = useToast()
  const root = useRef<HTMLDivElement>(null)
  const settingsPanel = useRef<HTMLDetailsElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapGL | null>(null)
  const pitch = useRef(0)
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof load>> | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [showMarkers, setShowMarkers] = useState(true)
  useEffect(() => { if (requestedHiring.length) setShowMarkers(true) }, [requestedHiring])
  const [showSites, setShowSites] = useState(true)
  const [showSupply, setShowSupply] = useState(() => initialLayers.includes('supplier'))
  const [showHoldings, setShowHoldings] = useState(() => initialLayers.includes('parent'))
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [specialization, setSpecialization] = useState<'all' | 'uav' | 'weapons'>('all')
  const [activeRelation, setActiveRelation] = useState<ApiMapRelation | null>(null)
  const [sanctioned, setSanctioned] = useState(false)
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set())
  // Only the selected company's holdings and/or supply chains (all the links, step by step).
  const [focusKinds, setFocusKinds] = useState(() => ({ parent: params.get('network') === '1' && initialLayers.includes('parent'), supplier: params.get('network') === '1' && initialLayers.includes('supplier'), other: params.get('network') === '1' && params.get('network_other') === '1' }))
  const [placeList, setPlaceList] = useState<Place | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [theme, setTheme] = useState(document.documentElement.className)
  const pointsState = useApi(`map-points:${attempt}`, api.mapPoints)
  const sitesState = useApi(`map-sites:${attempt}`, api.mapSites)
  const networkState = useApi(`map-network:${attempt}`, api.mapNetwork)
  const network = networkState.status === 'ready' ? networkState.data : EMPTY_NETWORK
  const companyTags = useMemo(() => new Map(network.company_tags.map((tag) => [tag.company_id, tag])), [network])
  const allPoints = pointsState.status === 'ready' ? pointsState.data : EMPTY
  const allSites = sitesState.status === 'ready' ? sitesState.data : EMPTY_SITES
  const filterIds = useMemo(() => new Set(employers.filter((e) => (!sanctioned || isSanctioned(e)) &&
    (specialization === 'all' || (e.gur_company_id != null && companyTags.get(e.gur_company_id)?.[specialization]))).map((e) => e.id)),
  [employers, sanctioned, specialization, companyTags])
  const filtered = useMemo(() => allPoints.filter((p) => filterIds.has(p.employer_id)), [allPoints, filterIds])
  const filteredSites = useMemo(() => allSites.filter((s) => filterIds.has(s.employer_id)), [allSites, filterIds])
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const id of new Set([...filtered, ...filteredSites].map((p) => p.employer_id))) {
      const key = byId[id] ? categoryKey(byId[id]) : 'none'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [filtered, filteredSites, byId])
  const selectedCompany = selectedId != null ? byId[selectedId]?.gur_company_id ?? null : null
  const focusing = !requestedHiring.length && selectedId != null && (focusKinds.parent || focusKinds.supplier || focusKinds.other)
  // The companies linked to the selected one by the chosen kinds, directly or through others.
  const focus = useMemo(() => {
    if (!focusing || selectedCompany == null) return null
    const kinds = network.relations.filter((r) => r.kind === 'supplier' || r.kind === 'parent'
      ? focusKinds[r.kind]
      : focusKinds.other && (r.company_id === selectedCompany || r.related_id === selectedCompany))
    const companies = new Set([selectedCompany])
    const relations = new Set<ApiMapRelation>()
    for (let grew = true; grew;) {
      grew = false
      for (const r of kinds) {
        if (relations.has(r) || !(companies.has(r.company_id) || companies.has(r.related_id))) continue
        relations.add(r)
        for (const id of [r.company_id, r.related_id]) if (!companies.has(id)) { companies.add(id); grew = true }
        grew = true
      }
    }
    return { companies, relations }
  }, [focusing, selectedCompany, network, focusKinds])
  // Hiring places and register sites go through the same filters, by their employer.
  const shown = useCallback(<T extends Spot>(all: T[], filteredAll: T[]) => {
    if (focusing) {
      // The whole network of the company, whatever the other filters: a link would else break off.
      if (!focus) return all.filter((p) => p.employer_id === selectedId)
      return all.filter((p) => p.employer_id === selectedId || focus.companies.has(byId[p.employer_id]?.gur_company_id ?? NaN))
    }
    return filteredAll.filter((p) => !hiddenCategories.size || !hiddenCategories.has(byId[p.employer_id] ? categoryKey(byId[p.employer_id]) : 'none'))
  }, [focusing, focus, hiddenCategories, byId, selectedId])
  const hiringFocus = requestedHiring.length > 0
  const points = useMemo(() => hiringFocus ? allPoints.filter(p => requestedHiring.some(q => q.employer_id === p.employer_id && q.lat === p.lat && q.lng === p.lng)) : shown(allPoints, filtered), [shown, allPoints, filtered, requestedHiring, hiringFocus])
  const sites = useMemo(() => hiringFocus ? [] : shown(allSites, filteredSites), [shown, allSites, filteredSites, hiringFocus])
  const located = new Set([...(showMarkers ? points : []), ...(showSites ? sites : [])].map((p) => p.employer_id)).size
  const vacancies = points.reduce((sum, point) => sum + point.vacancies, 0)
  // One spot per company for relation lines: its head office by the register, else the
  // hiring place with the most vacancies.
  const companyPoints = useMemo(() => {
    const representatives = new Map<number, Spot>()
    const heads = new Map<number, Spot>()
    for (const site of sites) {
      const companyId = byId[site.employer_id]?.gur_company_id
      if (companyId != null && site.kind === 'head_office' && !heads.has(companyId)) heads.set(companyId, site)
    }
    const most = new Map<number, number>()
    for (const point of points) {
      const companyId = byId[point.employer_id]?.gur_company_id
      if (companyId == null || heads.has(companyId)) continue
      if (point.vacancies > (most.get(companyId) ?? -1)) { representatives.set(companyId, point); most.set(companyId, point.vacancies) }
    }
    for (const [companyId, site] of heads) representatives.set(companyId, site)
    return representatives
  }, [points, sites, byId])
  const segments = useMemo(() => network.relations.flatMap((relation) => {
    // The database lists related_id as the supplier/parent of company_id.
    const from = companyPoints.get(relation.related_id)
    const to = companyPoints.get(relation.company_id)
    return from && to ? [{ relation, from, to }] : []
  }), [network, companyPoints])
  const visibleSegments = useMemo(() => segments.filter(({ relation }) => focus
    ? focus.relations.has(relation)
    : relation.kind === 'supplier' ? showSupply : relation.kind === 'parent' && showHoldings), [segments, showSupply, showHoldings, focus])
  // Linked companies with no hiring place on the map: listed, but no line can reach them.
  const focusUnplaced = useMemo(() => {
    if (!focus) return []
    const names = new Map<number, string>()
    for (const r of focus.relations) { names.set(r.company_id, r.company_name); names.set(r.related_id, r.related_name) }
    return [...names].filter(([id]) => id !== selectedCompany && !companyPoints.has(id)).map(([, name]) => name)
  }, [focus, companyPoints, selectedCompany])
  const supplyCount = segments.filter(({ relation }) => relation.kind === 'supplier').length
  const holdingsCount = segments.filter(({ relation }) => relation.kind === 'parent').length
  const selectedRelation = visibleSegments.find(({ relation }) => relation === activeRelation)
  const leafletConnections = useMemo<LeafletConnection[]>(() => visibleSegments.map(({ from, to, relation }) => ({
    from: [from.lat, from.lng], to: [to.lat, to.lng], color: RELATION_COLORS[relation.kind],
    label: `${RELATION_NAMES[relation.kind]}: ${relation.related_name} — ${relation.company_name}`,
  })), [visibleSegments])
  const selectLeafletRelation = useCallback((index: number) => setActiveRelation(visibleSegments[index]?.relation ?? null), [visibleSegments, setActiveRelation])
  const onBoundsChange = useCallback((value: Bounds) => setBounds(old => JSON.stringify(old) === JSON.stringify(value) ? old : value), [])
  useEffect(() => {
    if (!onContextChange) return
    const layers: ('supplier' | 'parent')[] = [...(showSupply ? ['supplier' as const] : []), ...(showHoldings ? ['parent' as const] : [])]
    const kinds: MapView['network_kinds'] = [...(focusKinds.supplier ? ['supplier' as const] : []), ...(focusKinds.parent ? ['parent' as const] : []), ...(focusKinds.other ? OTHER_KINDS : [])]
    onContextChange({ bounds, search, sanctioned, specialization, hidden_categories: [...hiddenCategories], layers,
      network_company_id: focusing ? selectedId! : null, network_kinds: focusing ? kinds : [], result_ids: resultIds,
      visible_count: new Set(points.filter(p => !bounds || insideBounds(p.lng, p.lat, bounds)).map(p => p.employer_id)).size })
  }, [onContextChange, bounds, search, sanctioned, specialization, hiddenCategories, showSupply, showHoldings, focusKinds, focusing, selectedId, points, resultIds])
  useEffect(() => () => onContextChange?.(null), [onContextChange])

  function focusRelation(segment: (typeof segments)[number]) {
    setActiveRelation(segment.relation)
    const map = mapRef.current
    if (map) { fit(map, [segment.from, segment.to]); map.setPitch(pitch.current) }
  }

  useEffect(() => {
    if (!API_KEY || !container.current) return
    let cancelled = false
    let map: MapGL | undefined
    let sizeObserver: ResizeObserver | undefined
    let resizeFrame = 0
    setError('')
    setEngine(null)
    const timer = setTimeout(() => {
      if (!cancelled) setError('2ГІС не відповідає. Перевірте з’єднання та спробуйте ще раз.')
    }, 15000)
    loadSdk().then((sdk) => {
      if (cancelled || !container.current) return
      map = new sdk.Map(container.current, {
        key: API_KEY, center: COUNTRY_CENTER, zoom: 3, zoomControl: false, enableTrackResize: true,
        loopWorld: true,
      })
      mapRef.current = map
      const resizeMap = () => {
        cancelAnimationFrame(resizeFrame)
        resizeFrame = requestAnimationFrame(() => map?.invalidateSize())
      }
      // Grid/panel changes can resize the container without a window resize.
      // Update the renderer as soon as layout settles, including during loading.
      sizeObserver = new ResizeObserver(resizeMap)
      sizeObserver.observe(container.current)
      resizeMap()
      map.on('error', () => {
        if (!cancelled) setError('Не вдалося завантажити карту 2ГІС. Перевірте доступ і ключ API.')
      })
      map.on('styleload', () => {
        clearTimeout(timer)
        resizeMap()
        if (!cancelled) { setError(''); setEngine(sdk) }
      })
    }).catch(() => {
      clearTimeout(timer)
      if (!cancelled) setError('Не вдалося підключитися до 2ГІС. Спробуйте ще раз.')
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
      sizeObserver?.disconnect()
      cancelAnimationFrame(resizeFrame)
      map?.destroy()
      mapRef.current = null
    }
  }, [attempt])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map) return
    const update = () => { const b = map.getBounds(); onBoundsChange(normalizeBounds(b.southWest[0], b.southWest[1], b.northEast[0], b.northEast[1])) }
    map.on('moveend', update); map.on('resize', update); update()
    return () => { map.off('moveend', update); map.off('resize', update) }
  }, [engine, onBoundsChange])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map || !showMarkers) return
    const clusterer = new Clusterer(map, {
      radius: 55,
      disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
      clusterStyle: (count) => ({ icon: clusterIcon(CLUSTER_COLOR, count), size: [44, 44], labelText: '' }),
    })
    clusterer.load(places(points).map((place) => ({
      coordinates: [place.lng, place.lat],
      icon: hiringIcon(), size: [18, 18], anchor: [9, 9], userData: place,
      ...(place.ids.length > 1 ? { label: { text: String(place.ids.length), color: '#ffffff', fontSize: 11, offset: [0, -16], haloRadius: 1, haloColor: '#1c1f19' } } : {}),
    })))
    clusterer.on('click', (event) => {
      if (event.target.type === 'cluster') {
        // Zoom at least one step and never past the zoom where clustering stops, so it always opens.
        const zoom = Math.min(Math.max(clusterer.getClusterExpansionZoom(event.target.id), map.getZoom() + 1), CLUSTER_OFF_ZOOM)
        map.setCenter(event.lngLat)
        map.setZoom(zoom)
      } else {
        const place: Place = event.target.data.userData
        if (place.ids.length === 1) navigate(filters.href('/map', mapExtras(params, place.ids[0], place)))
        else setPlaceList(place)
      }
    })
    return () => clusterer.destroy()
  }, [engine, points, showMarkers, navigate, filters, params])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map || !showSites) return
    const clusterer = new Clusterer(map, {
      radius: 55,
      disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
      clusterStyle: (count) => ({ icon: clusterIcon(SITE_CLUSTER_COLOR, count), size: [44, 44], labelText: '' }),
    })
    // Several sites at one spot: the first one's kind draws the pin (head offices come first).
    const kindAt = new Map<string, ApiMapSite['kind']>()
    for (const site of sites) if (!kindAt.has(spotKey(site))) kindAt.set(spotKey(site), site.kind)
    clusterer.load(places(sites).map((place) => {
      const kind = kindAt.get(spotKey(place)) ?? 'head_office'
      return {
        coordinates: [place.lng, place.lat],
        icon: siteIcon(markerColor(byId[place.ids[0]] ? effectiveCategory(byId[place.ids[0]]) : null), kind),
        size: [32, 40], anchor: [16, 40], userData: place, zIndex: 2,
        ...(place.ids.length > 1 ? { label: { text: String(place.ids.length), color: '#ffffff', fontSize: 11, offset: [0, -24], haloRadius: 1, haloColor: '#1c1f19' } } : {}),
      }
    }))
    clusterer.on('click', (event) => {
      if (event.target.type === 'cluster') {
        const zoom = Math.min(Math.max(clusterer.getClusterExpansionZoom(event.target.id), map.getZoom() + 1), CLUSTER_OFF_ZOOM)
        map.setCenter(event.lngLat)
        map.setZoom(zoom)
      } else {
        const place: Place = event.target.data.userData
        if (place.ids.length === 1) navigate(filters.href('/map', mapExtras(params, place.ids[0], place)))
        else setPlaceList(place)
      }
    })
    return () => clusterer.destroy()
  }, [engine, sites, showSites, byId, navigate, theme, filters, params])

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.className))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map) return
    const arrows = visibleSegments.filter(({ from, to }) => from.lat !== to.lat || from.lng !== to.lng).map(({ relation, from, to }) => {
      const options = {
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
        color: RELATION_COLORS[relation.kind], width: 3, strokeWidth: 1, strokeColor: '#ffffff',
        tipWidthMultiplier: 3, tipHeightMultiplier: 3, zIndex: 3,
      }
      const arrow = relation.kind === 'supplier' || relation.kind === 'parent'
        ? new engine.Arrow(map, options)
        : new engine.Polyline(map, { coordinates: options.coordinates, color: options.color, width: options.width, zIndex: 3 })
      arrow.on('click', () => setActiveRelation(relation))
      return arrow
    })
    return () => arrows.forEach((arrow) => arrow.destroy())
  }, [engine, visibleSegments])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map || !showHeatmap) return
    const source = new engine.GeoJsonSource(map, {
      data: {
        type: 'FeatureCollection',
        features: points.map((point) => ({
          type: 'Feature', properties: { vacancies: point.vacancies },
          geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
        })),
      },
      attributes: { purpose: 'hiring-heatmap' },
    })
    map.addLayer({
      id: 'hiring-heatmap', type: 'heatmap',
      filter: ['==', ['sourceAttr', 'purpose'], 'hiring-heatmap'],
      style: {
        radius: 35, weight: ['get', 'vacancies'], intensity: 0.2, opacity: 0.7,
        color: ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)', 0.2, '#fef08a', 0.5, '#fb923c', 1, '#dc2626'],
      },
    })
    return () => { map.removeLayer('hiring-heatmap'); source.destroy() }
  }, [engine, points, showHeatmap])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map) return
    const frame = () => {
      const selected = hiringFocus ? undefined : selectedMarker ?? (!focusing ? companyLocation(points, sites, selectedId) : undefined)
      const padding = root.current ? cameraPadding(root.current) : { top: 80, bottom: 100, left: 50, right: 50 }
      map.setPadding(selected ? padding : { top: 0, bottom: 0, left: 0, right: 0 }, { duration: 0 })
      if (selected) {
        map.setCenter([selected.lng, selected.lat])
        map.setZoom(14)
      } else fit(map, [...points, ...sites])
      map.setPitch(pitch.current)
    }
    frame()
    const resize = new ResizeObserver(frame)
    if (root.current) resize.observe(root.current)
    const card = root.current?.querySelector('.map-pop')
    if (card) resize.observe(card)
    return () => resize.disconnect()
  }, [engine, selectedId, selectedMarker, points, sites, focusing, hiringFocus])

  useEffect(() => {
    pitch.current = mode === '3d' ? 45 : 0
    mapRef.current?.setPitch(pitch.current)
  }, [mode, engine])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map) return
    const hiring = showMarkers ? points.filter((p) => p.employer_id === selectedId) : []
    const own = showSites ? sites.filter((s) => s.employer_id === selectedId) : []
    const markers = [
      ...hiring.map((p) => new engine.Marker(map, {
        coordinates: [p.lng, p.lat], icon: hiringIcon(SELECTED_COLOR), size: [24, 24], anchor: [12, 12], zIndex: 9,
      })),
      ...own.map((s) => new engine.Marker(map, {
        coordinates: [s.lng, s.lat], icon: siteIcon(SELECTED_COLOR, s.kind), size: [40, 50], anchor: [20, 50], zIndex: 10,
      })),
    ]
    const locations = [...hiring, ...own]
    markers.forEach((marker, index) => marker.on('click', () => navigate(filters.href('/map', mapExtras(params, selectedId, locations[index])))))
    return () => markers.forEach((marker) => marker.destroy())
  }, [engine, selectedId, points, sites, showMarkers, showSites, navigate, filters, params])

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen()
      else await root.current?.requestFullscreen()
    } catch { say('Повноекранний режим недоступний у цьому браузері.') }
  }

  async function openMapAgent() {
    if (document.fullscreenElement === root.current) {
      try { await document.exitFullscreen() }
      catch { say('Вийди з повноекранного режиму, щоб відкрити агента.'); return }
    }
    if (settingsPanel.current) settingsPanel.current.open = false
    agent.setTarget(selectedId != null ? 'company' : 'viewport')
    agent.setPanelTab('chat')
    agent.open()
  }

  // Without 2GIS (no key, an error or no answer in 15 s) the same places go on OpenStreetMap.
  const fallback = !API_KEY || !!error
  const colorOf = useCallback((id: number) => markerColor(byId[id] ? effectiveCategory(byId[id]) : null), [byId])
  const select = useCallback((id: number, marker: MarkerLocation) => navigate(filters.href('/map', mapExtras(params, id, marker))), [navigate, filters, params])
  const status = fallback ? '' : !engine ? 'Завантаження карти 2ГІС…' : ''
  const selectedMissing = selectedId !== undefined && ![...points, ...sites].some((p) => p.employer_id === selectedId)
  return (
    <div className="map-slot" ref={root}>
      <div className="map-canvas" ref={container} aria-label="Карта місць найму на базі 2ГІС" />
      {fallback && (
        <Suspense fallback={null}>
          <LeafletMap points={showMarkers || hiringFocus ? points : EMPTY} sites={showSites ? sites : EMPTY_SITES} selectedId={selectedId} selectedMarker={selectedMarker} colorOf={colorOf} onSelect={select} onBoundsChange={onBoundsChange} connections={leafletConnections} focusNetwork={focusing} focusHiring={hiringFocus} onRelationSelect={selectLeafletRelation} />
        </Suspense>
      )}
      <div className="map-tl">
        <details className="map-settings" ref={settingsPanel}>
          <summary><Icon name="map" />Шари та вигляд<Icon name="chev" /></summary>
          <div className="map-settings-body">
        <div className="segmented sm">
          {(['2d', '3d'] as const).map((m) => (
            <button key={m} type="button" disabled={!engine} aria-pressed={mode === m} onClick={() => setMode(m)}>{m.toUpperCase()}</button>
          ))}
        </div>
        <details className="map-layers">
          <summary><Icon name="map" />Шари карти</summary>
          <div className="map-layers-body">
            <label><input type="checkbox" checked={showSites} onChange={(event) => setShowSites(event.target.checked)} /><img className="map-legend-pin" src={siteIcon(markerColor(null), 'head_office')} alt="" /><span>Адреси підприємств (реєстр)</span><small>{sites.length}</small></label>
            <label><input type="checkbox" checked={showMarkers} onChange={(event) => setShowMarkers(event.target.checked)} /><img className="map-legend-dot" src={hiringIcon()} alt="" /><span>Місця найму (вакансії)</span><small>{points.length}</small></label>
            <label><input type="checkbox" checked={showSupply} disabled={networkState.status !== 'ready'} onChange={(event) => setShowSupply(event.target.checked)} /><i className="map-line-key supply" /><span>Ланцюги постачання</span><small title="У поточній вибірці / у БД">{supplyCount} / {network.relations.filter((r) => r.kind === 'supplier').length}</small></label>
            <label><input type="checkbox" checked={showHoldings} disabled={networkState.status !== 'ready'} onChange={(event) => setShowHoldings(event.target.checked)} /><i className="map-line-key holdings" /><span>Холдинги</span><small title="У поточній вибірці / у БД">{holdingsCount} / {network.relations.filter((r) => r.kind === 'parent').length}</small></label>
            <label><input type="checkbox" checked={showHeatmap} onChange={(event) => setShowHeatmap(event.target.checked)} /><Icon name="heat" /><span>Щільність вакансій</span></label>
            <p className="map-layer-note">Зв’язки: у вибірці / у БД. Для лінії потрібні координати обох компаній.</p>
            <div className="map-layer-filters">
              <label><input type="checkbox" checked={sanctioned} onChange={(event) => setSanctioned(event.target.checked)} /><span>Лише під санкціями</span></label>
              <label className="map-specialization"><span>Спеціалізація</span>
                <select aria-label="Спеціалізація на карті" value={specialization} disabled={networkState.status !== 'ready'} onChange={(event) => setSpecialization(event.target.value as typeof specialization)}>
                  <option value="all">Усі підприємства</option><option value="uav">БПЛА</option><option value="weapons">Озброєння та компоненти</option>
                </select>
              </label>
            </div>
            {networkState.status === 'loading' && <p className="map-layer-note">Завантаження зв’язків…</p>}
            {networkState.status === 'error' && <p className="map-layer-note">Не вдалося завантажити зв’язки. <button type="button" onClick={() => setAttempt((n) => n + 1)}>Повторити</button></p>}
            {(showSupply || showHoldings) && !visibleSegments.length && <p className="map-layer-note">У цій вибірці немає зв’язків із координатами на обох кінцях.</p>}
            {visibleSegments.length > 0 && <details className="map-connections">
              <summary>Перелік зв’язків ({visibleSegments.length})</summary>
              <div>{visibleSegments.map((segment) => <button type="button" key={`${segment.relation.kind}:${segment.relation.company_id}:${segment.relation.related_id}`} onClick={() => focusRelation(segment)}>
                <i className="map-line-key" style={{ background: RELATION_COLORS[segment.relation.kind] }} />
                <span>{segment.relation.related_name} — {segment.relation.company_name}<small>{RELATION_NAMES[segment.relation.kind]}</small></span>
              </button>)}</div>
            </details>}
          </div>
        </details>
        <details className="map-layers map-legend">
          <summary><Icon name="pin" />Умовні позначення</summary>
          <div className="map-layers-body">
            <p className="map-layer-note">Колір будівлі — напрям вакансій підприємства. Зніми позначку, щоб приховати підприємства цього напряму.</p>
            {LEGEND.map((row) => (
              <label key={row.key}>
                <input
                  type="checkbox"
                  checked={!hiddenCategories.has(row.key)}
                  disabled={focusing}
                  onChange={() => setHiddenCategories((prev) => {
                    const next = new Set(prev)
                    if (next.has(row.key)) next.delete(row.key)
                    else next.add(row.key)
                    return next
                  })}
                />
                <img className="map-legend-pin" src={siteIcon(markerColor(row.category), 'head_office')} alt="" />
                <span>{row.name}</span>
                <small>{categoryCounts.get(row.key) ?? 0}</small>
              </label>
            ))}
            <div className="map-legend-static">
              <p><img className="map-legend-pin" src={siteIcon(markerColor(null), 'head_office')} alt="" /><span>Юридична адреса (головний офіс) за реєстром</span></p>
              <p><img className="map-legend-pin" src={siteIcon(markerColor(null), 'branch')} alt="" /><span>Філія або представництво за реєстром: часто завод чи КБ</span></p>
              <p><img className="map-legend-dot" src={hiringIcon()} alt="" /><span>Місце найму: адреса з вакансій</span></p>
              <p><img className="map-legend-pin" src={siteIcon(SELECTED_COLOR, 'head_office')} alt="" /><span>Обраний роботодавець</span></p>
              <p><i className="map-legend-cluster" style={{ background: SITE_CLUSTER_COLOR }}>3</i><i className="map-legend-cluster" style={{ background: CLUSTER_COLOR }}>3</i><span>Кілька підприємств / місць найму поруч: натисни, щоб розкрити (з масштабу {CLUSTER_OFF_ZOOM} — окремі мітки)</span></p>
              <p><i className="map-legend-count">2</i><span>Число на мітці — кілька роботодавців в одній точці</span></p>
              <p><i className="map-line-key supply" /><span>Ланцюг постачання: постачальник → замовник</span></p>
              <p><i className="map-line-key holdings" /><span>Холдинг: материнська → дочірня</span></p>
            </div>
          </div>
        </details>
        {selectedId != null && (
          <details className="map-layers map-focus" open={focusing} aria-label="Зв’язки обраної компанії">
            <summary><Icon name="graph" />Лише зв’язки обраної</summary>
            <div className="map-layers-body">
              {selectedCompany == null ? (
                <p className="map-layer-note">Компанії немає в базі ГУР, тому зв’язків для неї немає.</p>
              ) : (
                <>
                  <label><input type="checkbox" checked={focusKinds.parent} disabled={networkState.status !== 'ready'} onChange={(e) => setFocusKinds((k) => ({ ...k, parent: e.target.checked }))} /><i className="map-line-key holdings" /><span>Її холдинги</span></label>
                  <label><input type="checkbox" checked={focusKinds.supplier} disabled={networkState.status !== 'ready'} onChange={(e) => setFocusKinds((k) => ({ ...k, supplier: e.target.checked }))} /><i className="map-line-key supply" /><span>Її ланцюги постачання</span></label>
                  <label><input type="checkbox" checked={focusKinds.other} disabled={networkState.status !== 'ready'} onChange={(e) => setFocusKinds((k) => ({ ...k, other: e.target.checked }))} /><i className="map-line-key" style={{ background: RELATION_COLORS.related }} /><span>Інші її зв’язки</span></label>
                  {focus && (
                    <p className="map-layer-note">
                      {focus.companies.size > 1 ? `Пов’язаних компаній: ${focus.companies.size - 1}, з них на карті — ${focus.companies.size - 1 - focusUnplaced.length}.` : 'Зв’язків обраного типу немає.'}
                      {' '}Інші фільтри карти тимчасово не діють.
                    </p>
                  )}
                  {focusUnplaced.length > 0 && (
                    <details className="map-connections">
                      <summary>Без координат ({focusUnplaced.length})</summary>
                      <div>{focusUnplaced.map((name) => <span key={name} className="map-focus-unplaced">{name}</span>)}</div>
                    </details>
                  )}
                </>
              )}
            </div>
          </details>
        )}
          </div>
        </details>
        {focusing && focus && networkState.status === 'ready' && <div className="map-network-status" role="status">
          <b>Зв’язки {byId[selectedId!]?.name ?? 'обраного підприємства'}</b>
          <small>{focus.relations.size} у базі · {visibleSegments.filter(({ from, to }) => from.lat !== to.lat || from.lng !== to.lng).length} ліній на карті</small>
          {focusUnplaced.length > 0 && <small>{focusUnplaced.length} пов’язаних компаній без координат</small>}
        </div>}
      </div>
      <div className="map-tr">
        <button className="btn btn-icon btn-sm" type="button" onClick={toggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen ? 'Згорнути карту' : 'Карта на весь екран'} title={fullscreen ? 'Згорнути карту' : 'На весь екран'}>
          <Icon name="expand" />
        </button>
      </div>
      {status && <div className="map-ph" role="status"><div>
        <Icon name="map" /><h4>{status}</h4>
      </div></div>}
      {(engine || fallback) && <details className="map-info">
        <summary><Icon name="pin" /><span>{pointsState.status === 'loading' ? 'Завантаження місць найму…' : pointsState.status === 'error' ? 'Місця найму недоступні' : `${located} роботодавців`}</span><Icon name="chev" /></summary>
        <div className="map-info-body" role="status">
        {fallback && <p>
          Резервна карта OpenStreetMap: 2ГІС недоступний, щільність показується лише на 2ГІС.{' '}
          {API_KEY && <button type="button" onClick={() => setAttempt((n) => n + 1)}>Спробувати 2ГІС</button>}
        </p>}
        {pointsState.status === 'loading' ? 'Завантаження місць найму…'
          : pointsState.status === 'error' ? <><span>Не вдалося завантажити місця найму.</span> <button type="button" onClick={() => setAttempt((n) => n + 1)}>Повторити</button></>
          : <>{located} з {employers.length} роботодавців на карті · {sites.length} адрес підприємств · {points.length} місць найму
            {sitesState.status === 'error' && <p>Не вдалося завантажити адреси підприємств. <button type="button" onClick={() => setAttempt((n) => n + 1)}>Повторити</button></p>}
            {selectedMissing ? <p>Для обраного роботодавця немає координат у поточній вибірці.</p> : !points.length && !sites.length ? <p>У поточній вибірці немає місць із координатами.</p> : <p>Будівлі — адреси підприємств за реєстром (ФНС через DaData), кружки — місця найму з вакансій.</p>}
            {(showSupply || showHoldings) && <p>{showSupply ? `${supplyCount} зв’язків постачання` : ''}{showSupply && showHoldings ? ' · ' : ''}{showHoldings ? `${holdingsCount} зв’язків холдингів` : ''}. Лінії між підприємствами, не маршрути перевезень.</p>}
            {showHeatmap && <p>Щільність: {vacancies} вакансій із координатами.</p>}</>}
        </div>
      </details>}
      <button className="map-agent-launch" type="button" aria-label="Запитати агента на карті" aria-expanded={agent.isOpen} onClick={openMapAgent}>
        <span className="map-agent-launch-icon"><Icon name="spark" /></span>
        <span><b>Запитати агента</b><small>{selectedId != null ? byId[selectedId]?.name ?? 'Про обране підприємство' : 'Про цю область карти'}</small></span>
      </button>
      {children}
      {selectedRelation && <div className="map-link-pop" role="dialog" aria-label="Зв’язок між підприємствами">
        <div className="map-link-head"><strong>{RELATION_NAMES[selectedRelation.relation.kind]}</strong><button type="button" className="btn btn-icon btn-sm" aria-label="Закрити зв’язок" onClick={() => setActiveRelation(null)}><Icon name="x" /></button></div>
        <Link to={`/companies/${selectedRelation.from.employer_id}`}>{selectedRelation.relation.related_name}</Link>
        <span className="map-link-direction">{selectedRelation.relation.kind === 'supplier' || selectedRelation.relation.kind === 'parent' ? '↓' : '↔'}</span>
        <Link to={`/companies/${selectedRelation.to.employer_id}`}>{selectedRelation.relation.company_name}</Link>
        {selectedRelation.relation.label && <p className="map-link-label">{selectedRelation.relation.label}</p>}
        <p>Координати — юридична адреса компанії за реєстром, а якщо її немає — місце найму з найбільшою кількістю вакансій.</p>
        {selectedRelation.from.lat === selectedRelation.to.lat && selectedRelation.from.lng === selectedRelation.to.lng && <p>Обидві компанії мають спільні координати. Зв’язок показано в переліку без окремої лінії.</p>}
        {(selectedRelation.relation.evidence_url || selectedRelation.relation.profile_url) && <a className="map-link-source" href={selectedRelation.relation.evidence_url ?? selectedRelation.relation.profile_url!} target="_blank" rel="noopener noreferrer">{selectedRelation.relation.evidence_url ? 'Джерело зв’язку' : 'Картка ГУР'} <Icon name="external" /></a>}
        <button type="button" className="btn btn-sm" onClick={() => agent.ask(`Поясни зв’язок «${selectedRelation.relation.related_name} → ${selectedRelation.relation.company_name}», тип ${selectedRelation.relation.kind}. Покажи докази цього зв’язку та обмеження даних.`, { target: 'company', companyId: selectedRelation.to.employer_id })}><Icon name="spark" />Пояснити зв’язок</button>
      </div>}
      {placeList && (
        <div className="map-link-pop" role="dialog" aria-label="Роботодавці в одній точці">
          <div className="map-link-head"><strong>В одній точці: {placeList.ids.length}</strong><button type="button" className="btn btn-icon btn-sm" aria-label="Закрити" onClick={() => setPlaceList(null)}><Icon name="x" /></button></div>
          <div className="map-place-list">
            {placeList.ids.map((id) => byId[id] && (
              <button key={id} type="button" onClick={() => { setPlaceList(null); navigate(filters.href('/map', mapExtras(params, id, placeList))) }}>
                <img className="map-legend-pin" src={siteIcon(markerColor(effectiveCategory(byId[id])), 'head_office')} alt="" />
                <span>{byId[id].name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!fallback && <div className="map-orn" role="toolbar" aria-label="Керування картою">
        <button className="btn btn-icon" type="button" disabled={!engine} aria-label="Показати всю вибірку" title="Уся вибірка" onClick={() => { const map = mapRef.current; if (map) { fit(map, [...(showMarkers ? points : []), ...(showSites ? sites : [])]); map.setPitch(pitch.current) } }}><Icon name="globe" /></button>
        <button className="btn btn-icon" type="button" disabled={!engine} aria-label="Наблизити" onClick={() => { const map = mapRef.current; if (map) map.setZoom(map.getZoom() + 1) }}>+</button>
        <button className="btn btn-icon" type="button" disabled={!engine} aria-label="Віддалити" onClick={() => { const map = mapRef.current; if (map) map.setZoom(map.getZoom() - 1) }}>−</button>
      </div>}
    </div>
  )
}
