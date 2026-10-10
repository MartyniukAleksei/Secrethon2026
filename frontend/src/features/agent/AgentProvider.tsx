import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { usePageContext } from '../../app/pageContext'
import { useFilters } from '../../state/FiltersContext'
import { AgentContext, type AgentMessage, type AgentState } from './AgentContext'
import { AgentAnswer } from './AgentAnswer'
import { ResearchDraft } from './ResearchDraft'
import { progressLabel, sendAgentRequest, type AgentRequest, type AgentTarget, type MapView, type WebPermission } from './types'
import { useData } from '../../data/DataContext'
import { mapActionHref } from './mapActions'
import { researchContext, type Research } from './research'

type QuestionSnapshot = { payload: AgentRequest; locationKey: string; requestedLocation: string }

export function AgentProvider({ children }: { children: ReactNode }) {
  const filters = useFilters()
  const { companyId, section } = usePageContext()
  const { byId } = useData()
  const navigate = useNavigate()
  const location = useLocation()
  const [target, setTarget] = useState<AgentTarget>('company')
  const [mapView, updateMapView] = useState<MapView | null>(null)
  const setMapView = useCallback((view: MapView | null) => updateMapView(previous => JSON.stringify(previous) === JSON.stringify(view) ? previous : view), [])
  const [comparisonIds, setComparisonIds] = useState<number[]>([])
  const [isOpen, setOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'chat' | 'research'>('chat')
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [typing, setTyping] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [webPermission, setWebPermission] = useState<WebPermission | null>(null)
  const waitingForPermission = useRef<QuestionSnapshot | null>(null)
  const nextId = useRef(1)
  const pending = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const history = useRef<AgentRequest['history']>([])
  const approvedContext = useRef<string[]>([])
  const rememberResearch = useCallback((record: Research) => {
    const value = researchContext(record)
    approvedContext.current = [...approvedContext.current.filter(item => item !== value), value].slice(-8)
  }, [])

  // Keep the current page context without recreating the request callback.
  const ctx = useRef({ filters, companyId, section, target, mapView, comparisonIds, byId, locationKey: location.key })
  useEffect(() => {
    ctx.current = { filters, companyId, section, target, mapView, comparisonIds, byId, locationKey: location.key }
  }, [filters, companyId, section, target, mapView, comparisonIds, byId, location.key])
  useEffect(() => () => pending.current?.abort(), [])

  const startNewChat = useCallback(() => {
    pending.current?.abort()
    pending.current = null
    busy.current = false
    waitingForPermission.current = null
    history.current = []
    approvedContext.current = []
    setMessages([])
    setTyping(false)
    setProgress(null)
    setWebPermission(null)
    setPanelTab('chat')
    setOpen(true)
  }, [])

  const execute = useCallback(function execute(snapshot: QuestionSnapshot) {
    if (busy.current || waitingForPermission.current) return
    const { payload, locationKey, requestedLocation } = snapshot
    const q = payload.message
    busy.current = true
    setPanelTab('chat')
    setTyping(true)
    setProgress(null)
    const controller = new AbortController()
    pending.current = controller
    const onProgress = (step: Parameters<typeof progressLabel>[0]) => {
      if (!controller.signal.aborted && pending.current === controller) setProgress(progressLabel(step))
    }
    void sendAgentRequest(payload, controller.signal, onProgress).then(response => {
      if (controller.signal.aborted || pending.current !== controller) return
      const action = response.map_action
      if (action && ['focus_company', 'show_relations', 'show_hiring_places'].includes(action.kind) && Number.isSafeInteger(action.employer_id) && ctx.current.byId[action.employer_id] && ctx.current.locationKey === locationKey && window.location.href === requestedLocation) {
        setTarget('company')
        navigate(`${mapActionHref(action)}&agent_view=${nextId.current}`)
      }
      if (response.web_permission) {
        if (payload.web_access !== 'ask') throw new Error('Не вдалося застосувати вибір джерел. Спробуйте повторити запит.')
        waitingForPermission.current = snapshot
        setWebPermission(response.web_permission)
        return
      }
      const turns: AgentRequest['history'] = [{ role: 'user', text: q }, {
        role: 'assistant', text: response.text + '\n' + JSON.stringify({ artifacts: response.artifacts, sources: response.sources, map_action: response.map_action }),
      }]
      history.current = [...history.current, ...turns].slice(-12).map(item => ({ ...item, text: item.text.slice(0, 12000) }))
      setMessages(m => [...m, { id: nextId.current++, role: 'bot', body: <><AgentAnswer response={response} /><ResearchDraft response={response} question={q} context={payload.context} onRemember={rememberResearch} /></> }])
    }).catch((error: unknown) => {
      if (controller.signal.aborted || pending.current !== controller) return
      const text = error instanceof Error ? error.message : 'Не вдалося отримати відповідь. Спробуйте ще раз.'
      setMessages(m => [...m, { id: nextId.current++, role: 'bot', body: <div role="alert">{text}<button type="button" className="btn btn-sm" onClick={() => execute(snapshot)}>Повторити</button></div> }])
    }).finally(() => {
      if (pending.current !== controller) return
      busy.current = false
      pending.current = null
      if (!controller.signal.aborted) {
        setTyping(false)
        setProgress(null)
      }
    })
  }, [navigate, rememberResearch])

  const chooseWebAccess = useCallback((access: 'allowed' | 'db_only') => {
    const snapshot = waitingForPermission.current
    if (!snapshot || busy.current) return
    waitingForPermission.current = null
    setWebPermission(null)
    execute({ ...snapshot, payload: { ...snapshot.payload, web_access: access } })
  }, [execute])

  const ask = useCallback(function ask(question: string, options?: { target?: AgentTarget; companyId?: number }) {
    const q = question.trim()
    if (!q || busy.current || waitingForPermission.current) return
    const requestedLocation = window.location.href
    setPanelTab('chat')
    const { filters: f, companyId: currentId, section: page, target: activeTarget, mapView: view, comparisonIds: chosen, locationKey } = ctx.current
    const id = options?.companyId ?? currentId
    const selectedTarget = options?.target ?? (page === 'map' ? activeTarget : 'company')
    if (options?.target) setTarget(options.target)
    const mapMode = page === 'map' && selectedTarget !== 'company' ? selectedTarget : null
    if (mapMode === 'viewport' && !view?.bounds || mapMode === 'selection' && !chosen.length) {
      setOpen(true)
      setMessages(m => [...m, { id: nextId.current++, role: 'bot', body: mapMode === 'viewport' ? 'Зачекай завантаження карти або обери «Поточні фільтри».' : 'Додай підприємства до порівняння на карті.' }])
      return
    }
    setOpen(true)
    setMessages((m) => [...m, { id: nextId.current++, role: 'user', body: q }])
    const payload: AgentRequest = { message: q, history: history.current.slice(-12), approved_context: [...approvedContext.current], web_access: 'ask', context: {
      page: page === 'map' ? 'map' : 'other',
      // The agent takes one region; several or «none» leave the question country-wide.
      company_id: mapMode ? undefined : id,
      region_id: !mapMode && f.region.length === 1 && f.region[0] !== 'none' ? Number(f.region[0]) : undefined,
      days: f.days,
      map_scope: mapMode ? { mode: mapMode, bounds: mapMode === 'viewport' ? view!.bounds : null,
        employer_ids: mapMode === 'selection' ? chosen : [], filters: {
          region: f.region, focus: f.focus, domain: f.domain, role: f.role,
          search: view?.search ?? '', sanctioned: view?.sanctioned ?? false, specialization: view?.specialization ?? 'all',
          hidden_categories: view?.hidden_categories ?? [], layers: view?.layers ?? [],
          network_company_id: view?.network_company_id ?? null, network_kinds: view?.network_kinds ?? [],
          result_ids: view?.result_ids ?? [],
        } } : undefined,
    } }
    execute({ payload, locationKey, requestedLocation })
  }, [execute])

  const value = useMemo<AgentState>(
    () => ({
      isOpen,
      messages,
      typing,
      progress,
      webPermission, chooseWebAccess,
      startNewChat,
      rememberResearch,
      panelTab, setPanelTab,
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((o) => !o),
      ask,
      target, setTarget, mapView, setMapView, comparisonIds,
      toggleComparison: (id: number) => setComparisonIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : ids.length < 5 ? [...ids, id] : ids),
    }),
    [isOpen, messages, typing, progress, ask, target, mapView, comparisonIds, setMapView, panelTab, webPermission, chooseWebAccess, startNewChat, rememberResearch],
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}
