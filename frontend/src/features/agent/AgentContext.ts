import { createContext, useContext, type ReactNode } from 'react'
import type { AgentTarget, MapView, WebPermission } from './types'

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
  webPermission: WebPermission | null
  chooseWebAccess: (access: 'allowed' | 'db_only') => void
  startNewChat: () => void
  open: () => void
  close: () => void
  toggle: () => void
  panelTab: 'chat' | 'research'
  setPanelTab: (tab: 'chat' | 'research') => void
  target: AgentTarget
  setTarget: (target: AgentTarget) => void
  mapView: MapView | null
  setMapView: (view: MapView | null) => void
  comparisonIds: number[]
  toggleComparison: (id: number) => void
  /** Opens the panel and sends the question. */
  ask: (question: string, options?: { target?: AgentTarget; companyId?: number }) => void
}

export const AgentContext = createContext<AgentState | null>(null)

export function useAgent(): AgentState {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>')
  return ctx
}
