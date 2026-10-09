import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { PageTitleContext, usePageContext } from '../app/pageContext'
import { useData } from '../data/DataContext'
import { useAgent } from '../features/agent/AgentContext'
import { AgentPanel } from '../features/agent/AgentPanel'
import { CommandPalette } from '../features/palette/CommandPalette'
import { PaletteContext } from '../features/palette/PaletteContext'
import { Header } from './Header'
import './AppShell.css'

const isTyping = (el: Element | null) => !!el && /^(input|textarea|select)$/i.test(el.tagName)
// Tabs of one company profile share a page: switching them keeps the scroll position.
const profileOf = (path: string) => /^\/companies\/([^/]+)/.exec(path)?.[1]

export function AppShell() {
  const page = usePageContext()
  const { byId } = useData()
  const agent = useAgent()
  const [agentFullscreen, setAgentFullscreen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const agentOverlay = agent.isOpen && (agentFullscreen || viewportWidth <= 900)
  const closeAgent = () => {
    setAgentFullscreen(false)
    agent.close()
  }
  // null = closed, string = open with this initial query
  const [palette, setPalette] = useState<string | null>(null)
  const openPalette = useCallback((query = '') => setPalette(query), [])
  const { pathname } = useLocation()
  const main = useRef<HTMLDivElement>(null)
  const prevPath = useRef(pathname)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const prev = prevPath.current
    prevPath.current = pathname
    const same = profileOf(prev) && profileOf(prev) === profileOf(pathname)
    if (!same && main.current) main.current.scrollTop = 0
  }, [pathname])

  const company = page.companyId ? byId[page.companyId] : undefined
  const [pageTitle, setPageTitle] = useState<string | null>(null)
  useEffect(() => {
    document.title = `${pageTitle ?? `${company ? `${company.name}, ` : ''}${page.label}`} | StayHard`
  }, [company, page.label, pageTitle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette('')
      } else if (e.key === 'Escape') {
        // Close the topmost layer only.
        if (palette != null) setPalette(null)
        else if (agent.isOpen && agentFullscreen) setAgentFullscreen(false)
        else if (agent.isOpen) agent.close()
      } else if (e.key === '/' && !isTyping(document.activeElement)) {
        e.preventDefault()
        agent.open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palette, agent, agentFullscreen])

  return (
    <PaletteContext.Provider value={openPalette}>
      <div className={`app${agent.isOpen ? ' agent-open' : ''}${agentFullscreen ? ' agent-fullscreen' : ''}`}>
        <div className="main" ref={main} inert={agentOverlay}>
          <Header section={page.section} />
          <div className="page">
            <PageTitleContext.Provider value={setPageTitle}><Outlet /></PageTitleContext.Provider>
          </div>
        </div>
        <AgentPanel
          fullscreen={agentFullscreen}
          onToggleFullscreen={() => setAgentFullscreen((value) => !value)}
          onClose={closeAgent}
        />
        {palette != null && <CommandPalette initialQuery={palette} onClose={() => setPalette(null)} />}
      </div>
    </PaletteContext.Provider>
  )
}
