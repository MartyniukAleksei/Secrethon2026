import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePageContext } from '../../app/pageContext'
import { useData } from '../../data/DataContext'
import { useFilters } from '../../state/FiltersContext'
import { AgentContext, type AgentMessage, type AgentState } from './AgentContext'
import { answer } from './answer'

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function AgentProvider({ children }: { children: ReactNode }) {
  const data = useData()
  const filters = useFilters()
  const { companyId } = usePageContext()
  const [isOpen, setOpen] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [typing, setTyping] = useState(false)
  const nextId = useRef(1)
  const pending = useRef<number | undefined>(undefined)

  // Latest context for the delayed reply, without re-creating `ask` on every filter change.
  const ctx = useRef({ data, filters, companyId })
  useEffect(() => {
    ctx.current = { data, filters, companyId }
  }, [data, filters, companyId])
  useEffect(() => () => window.clearTimeout(pending.current), [])

  const ask = useCallback((question: string) => {
    const q = question.trim()
    if (!q) return
    setOpen(true)
    setMessages((m) => [...m, { id: nextId.current++, role: 'user', body: q }])
    setTyping(true)
    window.clearTimeout(pending.current)
    pending.current = window.setTimeout(
      () => {
        const a = answer(q, ctx.current)
        setTyping(false)
        setMessages((m) => [...m, { id: nextId.current++, role: 'bot', body: a.body, sources: a.sources, actions: a.actions }])
      },
      reduceMotion() ? 0 : 650,
    )
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
