import { Link } from 'react-router'
import type { Section } from '../app/pageContext'
import { useAgent } from '../features/agent/AgentContext'
import { useOpenPalette } from '../features/palette/PaletteContext'
import { useTheme } from '../hooks/useTheme'
import { Icon } from '../ui/Icon'

const NAV: { section: Section; to: string; label: string }[] = [
  { section: 'overview', to: '/', label: 'Огляд' },
  { section: 'companies', to: '/companies', label: 'Підприємства' },
  { section: 'vacancies', to: '/vacancies', label: 'Вакансії' },
  { section: 'map', to: '/map', label: 'Карта' },
  { section: 'methodology', to: '/methodology', label: 'Про дані' },
]

export function Header({ section }: { section: Section }) {
  const openPalette = useOpenPalette()
  const agent = useAgent()
  const [dark, toggleTheme] = useTheme()

  return (
    <header className="header">
      <Link className="brand" to="/" aria-label="OSINT ВПК РФ, на головну">
        <i className="brand-mark" />
        <span>OSINT ВПК</span>
      </Link>
      <nav className="nav" aria-label="Розділи">
        {NAV.map((n) => (
          <Link key={n.to} className="nav-link" to={n.to} aria-current={n.section === section ? 'page' : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <button className="search-btn" type="button" onClick={() => openPalette()}>
          <Icon name="search" />
          <span>Пошук</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button className="btn btn-ghost btn-icon" type="button" aria-label="Перемкнути тему" onClick={toggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
        <button className="btn btn-secondary" type="button" aria-pressed={agent.isOpen} onClick={agent.toggle}>
          Агент
        </button>
      </div>
    </header>
  )
}
