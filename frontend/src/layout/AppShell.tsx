import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { usePageContext } from '../app/pageContext'
import { useData } from '../data/DataContext'
import { useAgent } from '../features/agent/AgentContext'
import { AgentPanel } from '../features/agent/AgentPanel'
import { CommandPalette } from '../features/palette/CommandPalette'
import { PaletteContext } from '../features/palette/PaletteContext'
import { useVacancyDrawer } from '../features/vacancy/VacancyDrawerContext'
import { Header } from './Header'
import './AppShell.css'

const isTyping = (el: Element | null) => !!el && /^(input|textarea|select)$/i.test(el.tagName)
// Tabs of one company profile share a page: switching them keeps the scroll position.
const profileOf = (path: string) => /^\/companies\/([^/]+)/.exec(path)?.[1]

export function AppShell() {
  const page = usePageContext()
  const { byId } = useData()
  const agent = useAgent()
  const drawer = useVacancyDrawer()
  // null = closed, string = open with this initial query
  const [palette, setPalette] = useState<string | null>(null)
  const openPalette = useCallback((query = '') => setPalette(query), [])
  const { pathname } = useLocation()
  const main = useRef<HTMLDivElement>(null)
  const prevPath = useRef(pathname)

  useEffect(() => {
    const prev = prevPath.current
    prevPath.current = pathname
    const same = profileOf(prev) && profileOf(prev) === profileOf(pathname)
    if (!same && main.current) main.current.scrollTop = 0
  }, [pathname])

  const company = page.companyId ? byId[page.companyId] : undefined
  useEffect(() => {
    document.title = `${company ? `${company.name}, ` : ''}${page.label} | OSINT ВПК РФ`
  }, [company, page.label])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette('')
      } else if (e.key === 'Escape') {
        // Close the topmost layer only.
        if (palette != null) setPalette(null)
        else if (drawer.openId != null) drawer.close()
        else if (agent.isOpen) agent.close()
      } else if (e.key === '/' && !isTyping(document.activeElement)) {
        e.preventDefault()
        agent.open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palette, drawer, agent])

  return (
    <PaletteContext.Provider value={openPalette}>
      <div className={`app${agent.isOpen ? ' agent-open' : ''}`}>
        <div className="main" ref={main}>
          <Header section={page.section} />
          <div className="page">
            <Outlet />
          </div>
        </div>
        <AgentPanel />
        {palette != null && <CommandPalette initialQuery={palette} onClose={() => setPalette(null)} />}
      </div>
    </PaletteContext.Provider>
  )
}
