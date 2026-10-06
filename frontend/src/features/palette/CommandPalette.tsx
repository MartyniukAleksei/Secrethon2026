import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { useData } from '../../data/DataContext'
import { Icon } from '../../ui/Icon'
import type { IconName } from '../../ui/icons'
import { useAgent } from '../agent/AgentContext'
import './CommandPalette.css'

type Item = { label: string; sub?: string; icon: IconName; run: () => void }

const PAGES: [string, string, IconName][] = [
  ['Огляд', '/', 'grid'],
  ['Карта', '/map', 'map'],
  ['Підприємства', '/companies', 'factory'],
  ['Вакансії', '/vacancies', 'briefcase'],
  ['Професії', '/vacancies/professions', 'list'],
  ['Сигнали', '/signals', 'bell'],
  ['Про дані', '/methodology', 'doc'],
]

/** Global search over companies, professions, regions and sections; falls back to asking the agent. */
export function CommandPalette({ initialQuery = '', onClose }: { initialQuery?: string; onClose: () => void }) {
  const { employers, regions } = useData()
  const { ask } = useAgent()
  const navigate = useNavigate()
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const m = (s: string) => !q || s.toLowerCase().includes(q)
    const go = (to: string) => () => navigate(to)
    const list: [string, Item[]][] = [
      ['Підприємства', employers.filter((e) => m(`${e.name} ${e.locality ?? ''} ${e.inn ?? ''}`)).slice(0, 7).map((e) => ({ label: e.name, sub: e.locality ?? undefined, icon: 'factory' as const, run: go(`/companies/${e.id}`) }))],
      ['Регіони', regions.filter((r) => m(r.name)).slice(0, 4).map((r) => ({ label: r.name, sub: 'регіон', icon: 'pin' as const, run: go(`/regions/${r.region_id}`) }))],
      ['Розділи', PAGES.filter(([label]) => m(label)).map(([label, to, icon]) => ({ label, icon, run: go(to) }))],
    ]
    if (q) list.push(['Вакансії', [{ label: `Шукати у вакансіях: «${query.trim()}»`, icon: 'briefcase', run: go(`/vacancies?q=${encodeURIComponent(query.trim())}`) }]])
    if (q) list.push(['Агент', [{ label: `Запитати агента: «${query.trim()}»`, icon: 'spark', run: () => ask(query) }]])
    return list.filter(([, items]) => items.length)
  }, [query, employers, regions, navigate, ask])

  const items = groups.flatMap(([, it]) => it)
  const current = Math.min(active, Math.max(0, items.length - 1))
  const choose = (i: number) => {
    const it = items[i]
    if (!it) return
    onClose()
    it.run()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(items.length - 1, current + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(0, current - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(current)
    }
  }

  let k = 0
  return (
    <div className="pal-bd" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pal" role="dialog" aria-label="Пошук">
        <div className="pal-in">
          <Icon name="search" />
          <label className="sr" htmlFor="palIn">
            Пошук
          </label>
          <input
            id="palIn"
            ref={input}
            value={query}
            placeholder="Підприємство, професія, регіон або розділ"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="palRes"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="pal-res" id="palRes" role="listbox">
          {groups.length === 0 && <p className="empty-row">Нічого не знайдено. Спробуй інше слово або запитай агента.</p>}
          {groups.map(([name, its]) => (
            <div key={name}>
              <div className="pal-grp">{name}</div>
              {its.map((it) => {
                const i = k++
                return (
                  <div key={`${name}-${it.label}`} className="pal-item" role="option" aria-selected={i === current} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
                    <Icon name={it.icon} />
                    {it.label}
                    {it.sub && <small>{it.sub}</small>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
