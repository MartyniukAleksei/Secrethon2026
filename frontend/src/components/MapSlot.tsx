import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { load } from '@2gis/mapgl'
import { Clusterer } from '@2gis/mapgl-clusterer'
import type { Map as MapGL } from '@2gis/mapgl/types'
import { api } from '../api/client'
import type { ApiMapPoint } from '../api/types'
import { useApi } from '../data/useApi'
import { useData } from '../data/DataContext'
import { categoryOf } from '../domain/labels'
import type { Employer } from '../domain/types'
import { useToast } from '../features/toast/ToastContext'
import { Icon } from '../ui/Icon'
import './MapSlot.css'

const API_KEY = import.meta.env.VITE_2GIS_API_KEY?.trim()
const EMPTY: ApiMapPoint[] = []
const COUNTRY_CENTER = [95, 62]
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
function markerColor(category: Employer['category']) {
  const color = categoryOf(category).color
  const token = /^var\((--[\w-]+)\)$/.exec(color)
  return token ? getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim() || '#73786a' : color
}
const markerIcon = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path fill="${color}" stroke="white" stroke-width="2" d="M16 1a15 15 0 0 0-15 15c0 11 15 23 15 23s15-12 15-23A15 15 0 0 0 16 1Z"/><circle cx="16" cy="16" r="5" fill="white"/></svg>`)}`

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
  const [sanctioned, setSanctioned] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [theme, setTheme] = useState(document.documentElement.className)
  const pointsState = useApi(`map-points:${attempt}`, api.mapPoints)
  const allPoints = pointsState.status === 'ready' ? pointsState.data : EMPTY
  const points = useMemo(() => {
    const ids = new Set(employers.filter((e) => !sanctioned || e.sanctions_count > 0).map((e) => e.id))
    return allPoints.filter((p) => ids.has(p.employer_id))
  }, [allPoints, employers, sanctioned])
  const located = new Set(points.map((p) => p.employer_id)).size

  useEffect(() => {
    if (!API_KEY || !container.current) return
    let cancelled = false
    let map: MapGL | undefined
    setError('')
    setEngine(null)
    const timer = setTimeout(() => {
      if (!cancelled) setError('2ГІС не відповідає. Перевірте з’єднання та спробуйте ще раз.')
    }, 20000)
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
    const clusterer = new Clusterer(map, { radius: 55 })
    clusterer.load(points.map((p) => ({
      coordinates: [p.lng, p.lat],
      icon: markerIcon(markerColor(byId[p.employer_id]?.category ?? null)),
      size: [32, 40], anchor: [16, 40], userData: p.employer_id,
    })))
    clusterer.on('click', (event) => {
      if (event.target.type === 'cluster') {
        map.setCenter(event.lngLat)
        map.setZoom(clusterer.getClusterExpansionZoom(event.target.id))
      } else {
        navigate(`/map?co=${event.target.data.userData}`)
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
    const selected = points.filter((p) => p.employer_id === selectedId)
    fit(map, selected.length ? selected : points)
    map.setPitch(pitch.current)
  }, [engine, selectedId, points])

  useEffect(() => {
    pitch.current = mode === '3d' ? 45 : 0
    mapRef.current?.setPitch(pitch.current)
  }, [mode, engine])

  useEffect(() => {
    const map = mapRef.current
    if (!engine || !map || !showMarkers) return
    const selected = points.filter((p) => p.employer_id === selectedId)
    const markers = selected.map((p) => new engine.Marker(map, {
      coordinates: [p.lng, p.lat], icon: markerIcon('#d97706'),
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

  const status = !API_KEY ? 'Карта 2ГІС ще не налаштована.'
    : error || (!engine ? 'Завантаження карти 2ГІС…' : '')
  const selectedMissing = selectedId !== undefined && !points.some((p) => p.employer_id === selectedId)
  return (
    <div className="map-slot" ref={root}>
      <div className="map-canvas" ref={container} aria-label="Карта місць найму на базі 2ГІС" />
      <div className="map-tl">
        <div className="segmented sm">
          {(['2d', '3d'] as const).map((m) => (
            <button key={m} type="button" disabled={!engine} aria-pressed={mode === m} onClick={() => setMode(m)}>{m.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="map-tr">
        <button className="btn btn-sm" type="button" onClick={toggleFullscreen} aria-pressed={fullscreen}>
          <Icon name="expand" />{fullscreen ? 'Згорнути' : 'На весь екран'}
        </button>
      </div>
      {status && <div className="map-ph" role="status"><div>
        <Icon name="map" /><h4>{status}</h4>
        {!API_KEY ? <p>Карта стане доступною після налаштування сервісу. Список роботодавців і профілі вже доступні.</p>
          : error ? <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAttempt((n) => n + 1)}>Спробувати ще раз</button> : null}
      </div></div>}
      {engine && <div className="map-info" role="status">
        {pointsState.status === 'loading' ? 'Завантаження місць найму…'
          : pointsState.status === 'error' ? <><span>Не вдалося завантажити місця найму.</span> <button type="button" onClick={() => setAttempt((n) => n + 1)}>Повторити</button></>
          : <>{located} з {employers.length} роботодавців на карті · {points.length} місць найму
            {selectedMissing ? <p>Для обраного роботодавця немає координат у поточній вибірці.</p> : !points.length ? <p>У поточній вибірці немає місць із координатами.</p> : <p>Позначки — координати вакансій, а не підтверджені адреси підприємств.</p>}</>}
      </div>}
      {children}
      <div className="map-orn" role="toolbar" aria-label="Керування картою">
        <button className="btn" type="button" disabled={!engine} aria-pressed={showMarkers} onClick={() => setShowMarkers((v) => !v)}><Icon name="pin" />Місця найму</button>
        <button className="btn" type="button" disabled={!engine} aria-pressed={sanctioned} onClick={() => setSanctioned((v) => !v)}>Під санкціями</button>
        <span className="sep" />
        <button className="btn" type="button" disabled={!engine} onClick={() => { const map = mapRef.current; if (map) { fit(map, points); map.setPitch(pitch.current) } }}><Icon name="globe" />Уся вибірка</button>
        <button className="btn btn-icon" type="button" disabled={!engine} aria-label="Наблизити" onClick={() => { const map = mapRef.current; if (map) map.setZoom(map.getZoom() + 1) }}>+</button>
        <button className="btn btn-icon" type="button" disabled={!engine} aria-label="Віддалити" onClick={() => { const map = mapRef.current; if (map) map.setZoom(map.getZoom() - 1) }}>−</button>
      </div>
    </div>
  )
}
