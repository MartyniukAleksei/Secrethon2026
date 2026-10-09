import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { load } from '@2gis/mapgl'
import { Clusterer } from '@2gis/mapgl-clusterer'
import type { Map as MapGL } from '@2gis/mapgl/types'
import { api } from '../api/client'
import type { ApiMapNetwork, ApiMapPoint, ApiMapRelation } from '../api/types'
import { useApi } from '../data/useApi'
import { useData } from '../data/DataContext'
import { effectiveCategory, isSanctioned } from '../domain/labels'
import { categoryKey, LEGEND, markerColor, markerIcon, SELECTED_COLOR } from './mapMarkers'
import type { Employer } from '../domain/types'
import { useToast } from '../features/toast/ToastContext'
import { Icon } from '../ui/Icon'
import './MapSlot.css'

const API_KEY = import.meta.env.VITE_2GIS_API_KEY?.trim()
const EMPTY: ApiMapPoint[] = []
const EMPTY_NETWORK: ApiMapNetwork = { relations: [], company_tags: [] }
const RELATION_COLORS = { supplier: '#b45309', parent: '#2563eb' }
const COUNTRY_CENTER = [95, 62]
// From this zoom on, markers are never clustered: every cluster can be opened by zooming to it.
const CLUSTER_OFF_ZOOM = 15
const CLUSTER_COLOR = '#2f7d4f'
const clusterIcon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="${CLUSTER_COLOR}" fill-opacity=".9" stroke="white" stroke-width="3"/></svg>`)}`
type Place = { lng: number; lat: number; ids: number[] }
/** Hiring places at (almost) one spot, ~10 m: one marker that lists every employer there. */
function places(points: ApiMapPoint[]): Place[] {
  const byKey = new Map<string, Place>()
  for (const p of points) {
    const key = `${p.lng.toFixed(4)}:${p.lat.toFixed(4)}`
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

function fit(map: MapGL, points: ApiMapPoint[]) {
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

export function MapSlot({ employers, selectedId, children }: {
  employers: Employer[]
  selectedId?: number
  children?: ReactNode
}) {
  const { byId } = useData()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialLayers = params.get('layers')?.split(',') ?? []
  const say = useToast()
  const root = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapGL | null>(null)
  const pitch = useRef(0)
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof load>> | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [showMarkers, setShowMarkers] = useState(true)
  const [showSupply, setShowSupply] = useState(() => initialLayers.includes('supplier'))
  const [showHoldings, setShowHoldings] = useState(() => initialLayers.includes('parent'))
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [specialization, setSpecialization] = useState<'all' | 'uav' | 'weapons'>('all')
  const [activeRelation, setActiveRelation] = useState<ApiMapRelation | null>(null)
  const [sanctioned, setSanctioned] = useState(false)
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set())
  // Only the selected company's holdings and/or supply chains (all the links, step by step).
  const [focusKinds, setFocusKinds] = useState<{ parent: boolean; supplier: boolean }>({ parent: false, supplier: false })
  const [placeList, setPlaceList] = useState<number[] | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [theme, setTheme] = useState(document.documentElement.className)
  const pointsState = useApi(`map-points:${attempt}`, api.mapPoints)
  const networkState = useApi(`map-network:${attempt}`, api.mapNetwork)
  const network = networkState.status === 'ready' ? networkState.data : EMPTY_NETWORK
  const companyTags = useMemo(() => new Map(network.company_tags.map((tag) => [tag.company_id, tag])), [network])
  const allPoints = pointsState.status === 'ready' ? pointsState.data : EMPTY
  const filtered = useMemo(() => {
    const ids = new Set(employers.filter((e) => (!sanctioned || isSanctioned(e)) &&
      (specialization === 'all' || (e.gur_company_id != null && companyTags.get(e.gur_company_id)?.[specialization]))).map((e) => e.id))
    return allPoints.filter((p) => ids.has(p.employer_id))
  }, [allPoints, employers, sanctioned, specialization, companyTags])
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const id of new Set(filtered.map((p) => p.employer_id))) {
      const key = byId[id] ? categoryKey(byId[id]) : 'none'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [filtered, byId])
  const selectedCompany = selectedId != null ? byId[selectedId]?.gur_company_id ?? null : null
  const focusing = selectedId != null && (focusKinds.parent || focusKinds.supplier)
  // The companies linked to the selected one by the chosen kinds, directly or through others.
  const focus = useMemo(() => {
    if (!focusing || selectedCompany == null) return null
    const kinds = network.relations.filter((r) => focusKinds[r.kind])
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
  const points = useMemo(() => {
    if (focusing) {
      // The whole network of the company, whatever the other filters: a link would else break off.
      if (!focus) return allPoints.filter((p) => p.employer_id === selectedId)
      return allPoints.filter((p) => p.employer_id === selectedId || focus.companies.has(byId[p.employer_id]?.gur_company_id ?? NaN))
    }
    return filtered.filter((p) => !hiddenCategories.size || !hiddenCategories.has(byId[p.employer_id] ? categoryKey(byId[p.employer_id]) : 'none'))
  }, [focusing, focus, allPoints, filtered, hiddenCategories, byId, selectedId])
  const located = new Set(points.map((p) => p.employer_id)).size
  const vacancies = points.reduce((sum, point) => sum + point.vacancies, 0)
  const companyPoints = useMemo(() => {
    const representatives = new Map<number, ApiMapPoint>()
    for (const point of points) {
      const companyId = byId[point.employer_id]?.gur_company_id
      if (companyId == null) continue
      const current = representatives.get(companyId)
      if (!current || point.vacancies > current.vacancies) representatives.set(companyId, point)
    }
    return representatives
  }, [points, byId])
  const segments = useMemo(() => network.relations.flatMap((relation) => {
    // The database lists related_id as the supplier/parent of company_id.
    const from = companyPoints.get(relation.related_id)
    const to = companyPoints.get(relation.company_id)
    return from && to ? [{ relation, from, to }] : []
  }), [network, companyPoints])
  const visibleSegments = useMemo(() => segments.filter(({ relation }) => focus
    ? focus.relations.has(relation)
    : relation.kind === 'supplier' ? showSupply : showHoldings), [segments, showSupply, showHoldings, focus])
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

  function focusRelation(segment: (typeof segments)[number]) {
    setActiveRelation(segment.relation)
    const map = mapRef.current
    if (map) { fit(map, [segment.from, segment.to]); map.setPitch(pitch.current) }
  }

  useEffect(() => {
    if (!API_KEY || !container.current) return
    let cancelled = false
    let map: MapGL | undefined
    setError('')
    setEngine(null)
    const timer = setTimeout(() => {
      if (!cancelled) setError('2ГІС не відповідає. Перевірте з’єднання та спробуйте ще раз.')
    }, 15000)
    loadSdk().then((sdk) => {
      if (cancelled || !container.current) return
      map = new sdk.Map(container.current, {
        key: API_KEY, center: COUNTRY_CENTER, zoom: 3, zoomControl: false, enableTrackResize: true,
      })
      mapRef.current = map
      map.on('error', () => {
        if (!cancelled) setError('Не вдалося завантажити карту 2ГІС. Перевірте доступ і ключ API.')
      })
      map.on('styleload', () => {
        clearTimeout(timer)
        if (!cancelled) { setError(''); setEngine(sdk) }
      })
    }).catch(() => {
      clearTimeout(timer)
      if (!cancelled) setError('Не вдалося підключитися до 2ГІС. Спробуйте ще раз.')
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
      map?.destroy()
      mapRef.current = null
    }
  }, [attempt])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map || !showMarkers) return
    const clusterer = new Clusterer(map, {
      radius: 55,
      disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
      clusterStyle: { icon: clusterIcon, size: [44, 44], labelColor: '#ffffff', labelFontSize: 14 },
    })
    clusterer.load(places(points).map((place) => ({
      coordinates: [place.lng, place.lat],
      icon: markerIcon(markerColor(byId[place.ids[0]] ? effectiveCategory(byId[place.ids[0]]) : null)),
      size: [32, 40], anchor: [16, 40], userData: place.ids,
      ...(place.ids.length > 1 ? { label: { text: String(place.ids.length), color: '#ffffff', fontSize: 11, offset: [0, -24], haloRadius: 1, haloColor: '#1c1f19' } } : {}),
    })))
    clusterer.on('click', (event) => {
      if (event.target.type === 'cluster') {
        // Zoom at least one step and never past the zoom where clustering stops, so it always opens.
        const zoom = Math.min(Math.max(clusterer.getClusterExpansionZoom(event.target.id), map.getZoom() + 1), CLUSTER_OFF_ZOOM)
        map.setCenter(event.lngLat)
        map.setZoom(zoom)
      } else {
        const ids: number[] = event.target.data.userData
        if (ids.length === 1) navigate(`/map?co=${ids[0]}`)
        else setPlaceList(ids)
      }
    })
    return () => clusterer.destroy()
  }, [engine, points, showMarkers, byId, navigate, theme])

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.className))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map) return
    const arrows = visibleSegments.filter(({ from, to }) => from.lat !== to.lat || from.lng !== to.lng).map(({ relation, from, to }) => {
      const arrow = new engine.Arrow(map, {
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
        color: RELATION_COLORS[relation.kind], width: 3, strokeWidth: 1, strokeColor: '#ffffff',
        tipWidthMultiplier: 3, tipHeightMultiplier: 3, zIndex: 3,
      })
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
    const selected = points.filter((p) => p.employer_id === selectedId)
    fit(map, selected.length && !focusing ? selected : points)
    map.setPitch(pitch.current)
  }, [engine, selectedId, points, focusing])

  useEffect(() => {
    pitch.current = mode === '3d' ? 45 : 0
    mapRef.current?.setPitch(pitch.current)
  }, [mode, engine])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map || !showMarkers) return
    const selected = points.filter((p) => p.employer_id === selectedId)
    const markers = selected.map((p) => new engine.Marker(map, {
      coordinates: [p.lng, p.lat], icon: markerIcon(SELECTED_COLOR),
      size: [40, 50], anchor: [20, 50], zIndex: 10,
    }))
    markers.forEach((marker) => marker.on('click', () => navigate(`/map?co=${selectedId}`)))
    return () => markers.forEach((marker) => marker.destroy())
  }, [engine, selectedId, points, showMarkers, navigate])

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

  // Without 2GIS (no key, an error or no answer in 15 s) the same places go on OpenStreetMap.
  const fallback = !API_KEY || !!error
  const colorOf = useCallback((id: number) => markerColor(byId[id] ? effectiveCategory(byId[id]) : null), [byId])
  const select = useCallback((id: number) => navigate(`/map?co=${id}`), [navigate])
  const status = fallback ? '' : !engine ? 'Завантаження карти 2ГІС…' : ''
  const selectedMissing = selectedId !== undefined && !points.some((p) => p.employer_id === selectedId)
  return (
    <div className="map-slot" ref={root}>
      <div className="map-canvas" ref={container} aria-label="Карта місць найму на базі 2ГІС" />
      {fallback && (
        <Suspense fallback={null}>
          <LeafletMap points={showMarkers ? points : EMPTY} selectedId={selectedId} colorOf={colorOf} onSelect={select} />
        </Suspense>
      )}
      <div className="map-tl">
        <div className="segmented sm">
          {(['2d', '3d'] as const).map((m) => (
            <button key={m} type="button" disabled={!engine} aria-pressed={mode === m} onClick={() => setMode(m)}>{m.toUpperCase()}</button>
          ))}
        </div>
        <details className="map-layers">
          <summary><Icon name="map" />Шари карти</summary>
          <div className="map-layers-body">
            <label><input type="checkbox" checked={showMarkers} onChange={(event) => setShowMarkers(event.target.checked)} /><Icon name="pin" /><span>Мітки місць найму</span><small>{points.length}</small></label>
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
                <i className={`map-line-key ${segment.relation.kind === 'supplier' ? 'supply' : 'holdings'}`} />
                <span>{segment.relation.related_name} → {segment.relation.company_name}</span>
              </button>)}</div>
            </details>}
          </div>
        </details>
        <details className="map-layers map-legend" open={selectedId == null}>
          <summary><Icon name="pin" />Умовні позначення</summary>
          <div className="map-layers-body">
            <p className="map-layer-note">Колір мітки — напрям вакансій підприємства. Зніми позначку, щоб приховати.</p>
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
                <img className="map-legend-pin" src={markerIcon(markerColor(row.category))} alt="" />
                <span>{row.name}</span>
                <small>{categoryCounts.get(row.key) ?? 0}</small>
              </label>
            ))}
            <div className="map-legend-static">
              <p><img className="map-legend-pin" src={markerIcon(SELECTED_COLOR)} alt="" /><span>Обраний роботодавець</span></p>
              <p><i className="map-legend-cluster" style={{ background: CLUSTER_COLOR }}>3</i><span>Кілька місць поруч: натисни, щоб розкрити (з масштабу {CLUSTER_OFF_ZOOM} — окремі мітки)</span></p>
              <p><i className="map-legend-count">2</i><span>Число на мітці — кілька роботодавців в одній точці</span></p>
              <p><i className="map-line-key supply" /><span>Ланцюг постачання: постачальник → замовник</span></p>
              <p><i className="map-line-key holdings" /><span>Холдинг: материнська → дочірня</span></p>
            </div>
          </div>
        </details>
        {selectedId != null && (
          <details className="map-layers map-focus" open aria-label="Зв’язки обраної компанії">
            <summary><Icon name="graph" />Лише зв’язки обраної</summary>
            <div className="map-layers-body">
              {selectedCompany == null ? (
                <p className="map-layer-note">Компанії немає в базі ГУР, тому зв’язків для неї немає.</p>
              ) : (
                <>
                  <label><input type="checkbox" checked={focusKinds.parent} disabled={networkState.status !== 'ready'} onChange={(e) => setFocusKinds((k) => ({ ...k, parent: e.target.checked }))} /><i className="map-line-key holdings" /><span>Її холдинги</span></label>
                  <label><input type="checkbox" checked={focusKinds.supplier} disabled={networkState.status !== 'ready'} onChange={(e) => setFocusKinds((k) => ({ ...k, supplier: e.target.checked }))} /><i className="map-line-key supply" /><span>Її ланцюги постачання</span></label>
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
      <div className="map-tr">
        <button className="btn btn-sm" type="button" onClick={toggleFullscreen} aria-pressed={fullscreen}>
          <Icon name="expand" />{fullscreen ? 'Згорнути' : 'На весь екран'}
        </button>
      </div>
      {status && <div className="map-ph" role="status"><div>
        <Icon name="map" /><h4>{status}</h4>
      </div></div>}
      {(engine || fallback) && <div className="map-info" role="status">
        {fallback && <p>
          Резервна карта OpenStreetMap: 2ГІС недоступний, зв’язки й щільність показуються лише на 2ГІС.{' '}
          {API_KEY && <button type="button" onClick={() => setAttempt((n) => n + 1)}>Спробувати 2ГІС</button>}
        </p>}
        {pointsState.status === 'loading' ? 'Завантаження місць найму…'
          : pointsState.status === 'error' ? <><span>Не вдалося завантажити місця найму.</span> <button type="button" onClick={() => setAttempt((n) => n + 1)}>Повторити</button></>
          : <>{located} з {employers.length} роботодавців на карті · {points.length} місць найму
            {selectedMissing ? <p>Для обраного роботодавця немає координат у поточній вибірці.</p> : !points.length ? <p>У поточній вибірці немає місць із координатами.</p> : <p>Позначки — координати вакансій, а не підтверджені адреси підприємств.</p>}
            {(showSupply || showHoldings) && <p>{showSupply ? `${supplyCount} зв’язків постачання` : ''}{showSupply && showHoldings ? ' · ' : ''}{showHoldings ? `${holdingsCount} зв’язків холдингів` : ''}. Лінії між місцями найму, не маршрути перевезень.</p>}
            {showHeatmap && <p>Щільність: {vacancies} вакансій із координатами.</p>}</>}
      </div>}
      {children}
      {selectedRelation && <div className="map-link-pop" role="dialog" aria-label="Зв’язок між підприємствами">
        <div className="map-link-head"><strong>{selectedRelation.relation.kind === 'supplier' ? 'Постачальник → замовник' : 'Материнська → дочірня компанія'}</strong><button type="button" className="btn btn-icon btn-sm" aria-label="Закрити зв’язок" onClick={() => setActiveRelation(null)}><Icon name="x" /></button></div>
        <Link to={`/companies/${selectedRelation.from.employer_id}`}>{selectedRelation.relation.related_name}</Link>
        <span className="map-link-direction">↓</span>
        <Link to={`/companies/${selectedRelation.to.employer_id}`}>{selectedRelation.relation.company_name}</Link>
        {selectedRelation.relation.label && <p className="map-link-label">{selectedRelation.relation.label}</p>}
        <p>Координати — місця найму; для кожної компанії показано місце з найбільшою кількістю вакансій.</p>
        {selectedRelation.from.lat === selectedRelation.to.lat && selectedRelation.from.lng === selectedRelation.to.lng && <p>Обидві компанії мають спільні координати. Зв’язок показано в переліку без окремої лінії.</p>}
        {(selectedRelation.relation.evidence_url || selectedRelation.relation.profile_url) && <a className="map-link-source" href={selectedRelation.relation.evidence_url ?? selectedRelation.relation.profile_url!} target="_blank" rel="noopener noreferrer">{selectedRelation.relation.evidence_url ? 'Джерело зв’язку' : 'Картка ГУР'} <Icon name="external" /></a>}
      </div>}
      {placeList && (
        <div className="map-link-pop" role="dialog" aria-label="Роботодавці в одній точці">
          <div className="map-link-head"><strong>В одній точці: {placeList.length}</strong><button type="button" className="btn btn-icon btn-sm" aria-label="Закрити" onClick={() => setPlaceList(null)}><Icon name="x" /></button></div>
          <div className="map-place-list">
            {placeList.map((id) => byId[id] && (
              <button key={id} type="button" onClick={() => { setPlaceList(null); navigate(`/map?co=${id}`) }}>
                <img className="map-legend-pin" src={markerIcon(markerColor(effectiveCategory(byId[id])))} alt="" />
                <span>{byId[id].name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="map-orn" role="toolbar" aria-label="Керування картою">
        <button className="btn" type="button" disabled={!engine} onClick={() => { const map = mapRef.current; if (map) { fit(map, points); map.setPitch(pitch.current) } }}><Icon name="globe" />Уся вибірка</button>
        <button className="btn btn-icon" type="button" disabled={!engine} aria-label="Наблизити" onClick={() => { const map = mapRef.current; if (map) map.setZoom(map.getZoom() + 1) }}>+</button>
        <button className="btn btn-icon" type="button" disabled={!engine} aria-label="Віддалити" onClick={() => { const map = mapRef.current; if (map) map.setZoom(map.getZoom() - 1) }}>−</button>
      </div>
    </div>
  )
}
