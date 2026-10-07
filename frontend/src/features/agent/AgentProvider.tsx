import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePageContext } from '../../app/pageContext'
import { useFilters } from '../../state/FiltersContext'
import { AgentContext, type AgentMessage, type AgentState } from './AgentContext'
import { AgentAnswer } from './AgentAnswer'
import { sendAgentRequest, type AgentRequest } from './types'

export function AgentProvider({ children }: { children: ReactNode }) {
  const filters = useFilters()
  const { companyId } = usePageContext()
  const [isOpen, setOpen] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [typing, setTyping] = useState(false)
  const nextId = useRef(1)
  const pending = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const history = useRef<AgentRequest['history']>([])

  // Keep the current page context without recreating the request callback.
  const ctx = useRef({ filters, companyId })
  useEffect(() => {
    ctx.current = { filters, companyId }
  }, [filters, companyId])
  useEffect(() => () => pending.current?.abort(), [])

  const ask = useCallback(function ask(question: string) {
    const q = question.trim()
    if (!q || busy.current) return
    busy.current = true
    setOpen(true)
    setMessages((m) => [...m, { id: nextId.current++, role: 'user', body: q }])
    setTyping(true)
    const controller = new AbortController()
    pending.current = controller
    const { filters: f, companyId: id } = ctx.current
    const payload: AgentRequest = { message: q, history: history.current.slice(-12), context: {
      company_id: id, region_id: f.region === 'all' ? undefined : f.region,
      category: f.category === 'all' ? undefined : f.category, days: f.period,
    } }
    void sendAgentRequest(payload, controller.signal).then(response => {
      const turns: AgentRequest['history'] = [{ role: 'user', text: q }, {
        role: 'assistant', text: response.text + '\n' + JSON.stringify({ artifacts: response.artifacts, sources: response.sources }),
      }]
      history.current = [...history.current, ...turns].slice(-12).map(item => ({ ...item, text: item.text.slice(0, 12000) }))
      setMessages(m => [...m, { id: nextId.current++, role: 'bot', body: <AgentAnswer response={response} /> }])
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      const text = error instanceof Error ? error.message : 'Не вдалося отримати відповідь. Спробуйте ще раз.'
      setMessages(m => [...m, { id: nextId.current++, role: 'bot', body: <div role="alert">{text}<button type="button" className="btn btn-sm" onClick={() => ask(q)}>Повторити</button></div> }])
    }).finally(() => {
      busy.current = false
      pending.current = null
      if (!controller.signal.aborted) setTyping(false)
    })
  }, [])

  const value = useMemo<AgentState>(
    () => ({
      isOpen,
      messages,
      typing,
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((o) => !o),
      ask,
    }),
    [isOpen, messages, typing, ask],
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}
