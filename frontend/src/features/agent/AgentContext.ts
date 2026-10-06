import { createContext, useContext, type ReactNode } from 'react'

export type AgentAction = { label: string; to: string }

export type AgentMessage = {
  id: number
  role: 'user' | 'bot'
  body: ReactNode
  sources?: string[]
  actions?: AgentAction[]
}

export type AgentState = {
  isOpen: boolean
  messages: AgentMessage[]
  typing: boolean
  open: () => void
  close: () => void
  toggle: () => void
  /** Opens the panel and sends the question. */
  ask: (question: string) => void
}

export const AgentContext = createContext<AgentState | null>(null)

export function useAgent(): AgentState {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>')
  return ctx
}
