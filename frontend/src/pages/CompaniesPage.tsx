import { useState } from 'react'
import { Link } from 'react-router'
import { FilterBar } from '../components/FilterBar'
import { useData } from '../data/DataContext'
import { fmt, money, plural } from '../domain/format'
import { CATEGORIES } from '../domain/labels'
import type { Employer } from '../domain/types'
import { useFilters } from '../state/FiltersContext'
import { EmployerBadgeGroups } from '../ui/EmployerBadgeGroups'
import { CompanyTile } from '../ui/CompanyMark'
import { Icon } from '../ui/Icon'
import './CompaniesPage.css'

type Sort = 'vacancies' | 'confirmed' | 'salary' | 'new' | 'sanctions'
const SORTS: Record<Sort, { label: string; key: (e: Employer) => number }> = {
  vacancies: { label: 'Спершу більше вакансій', key: (e) => e.vpk_vacancies },
  confirmed: { label: 'Спершу більше підтверджених', key: (e) => e.confirmed_vacancies },
  new: { label: 'Спершу більше нових за 30 днів', key: (e) => e.new_30d },
  salary: { label: 'Спершу вища зарплата', key: (e) => e.median_salary ?? -1 },
  sanctions: { label: 'Спершу більше санкцій', key: (e) => e.sanctions_count },
}
const PAGE = 60

type Flag = 'confirmed' | 'gur' | 'sanctions'
const FLAGS: [Flag, string, (e: Employer) => boolean][] = [
  ['confirmed', 'ВПК підтверджено', (e) => e.confirmed_vacancies > 0],
  ['gur', 'Є в базі ГУР', (e) => e.gur_company_id != null],
  ['sanctions', 'Під санкціями', (e) => e.sanctions_count > 0],
]

export function CompaniesPage() {
  const { employers } = useData()
  const filters = useFilters()
  const [query, setQuery] = useState('')
  const [flags, setFlags] = useState<Set<Flag>>(new Set())
  const [sort, setSort] = useState<Sort>('vacancies')
  const [shown, setShown] = useState(PAGE)

  const toggle = (f: Flag) => {
    const next = new Set(flags)
    if (next.has(f)) next.delete(f)
    else next.add(f)
    setFlags(next)
    setShown(PAGE)
  }

  const q = query.trim().toLowerCase()
  const list = employers
    .filter(filters.matches)
    .filter((e) => !q || `${e.name} ${e.locality ?? ''} ${e.inn ?? ''}`.toLowerCase().includes(q))
    .filter((e) => FLAGS.every(([f, , test]) => !flags.has(f) || test(e)))
    .sort((a, b) => SORTS[sort].key(b) - SORTS[sort].key(a))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Підприємства</h1>
          <p>Роботодавці, у яких є вакансії, віднесені до ВПК. Відкрий картку, щоб побачити вакансії, зарплати, санкції й зв'язки.</p>
        </div>
        <FilterBar period={false} />
      </div>
      <div className="cat">
        <aside className="panel cat-filters" aria-label="Фільтри">
          <div>
            <div className="group-title">Напрям</div>
            {CATEGORIES.map((c) => (
              <label key={c.key} className="check">
                <input
                  type="radio"
                  name="category"
                  checked={filters.category === c.key}
                  onChange={() => filters.set({ category: c.key })}
                />{' '}
                {c.name}
              </label>
            ))}
            <label className="check">
              <input type="radio" name="category" checked={filters.category === 'all'} onChange={() => filters.set({ category: 'all' })} /> Усі
            </label>
          </div>
          <div>
            <div className="group-title">Ознаки</div>
            <div className="row">
              {FLAGS.map(([f, label]) => (
                <button key={f} className="chip" type="button" aria-pressed={flags.has(f)} onClick={() => toggle(f)}>
                  <Icon name="check" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>
        <div className="cat-results">
          <div className="cat-head">
            <label className="search">
              <span className="sr">Пошук</span>
              <Icon name="search" />
              <input
                className="input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setShown(PAGE)
                }}
                placeholder="Назва, місто або ІПН"
              />
            </label>
            <div className="select">
              <label className="sr" htmlFor="catSort">Сортування</label>
              <select className="input" id="catSort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {Object.entries(SORTS).map(([k, s]) => (
                  <option key={k} value={k}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="cat-count">
            {fmt(list.length)} {plural(list.length, 'роботодавець', 'роботодавці', 'роботодавців')}
          </p>
          <div className="cat-grid">
            {list.length === 0 ? (
              <div className="empty" style={{ gridColumn: '1 / -1' }}>
                <h4>Нічого не знайдено</h4>
                <p>Прибери частину фільтрів або зміни регіон.</p>
              </div>
            ) : (
              list.slice(0, shown).map((e) => (
                <Link key={e.id} className="co-card" to={`/companies/${e.id}`}>
                  <CompanyTile size={56} />
                  <div>
                    <h3>{e.name}</h3>
                    <p className="place"><Icon name="pin" />{[e.locality, e.region].filter(Boolean).join(', ') || 'Місто не вказано'}</p>
                    <dl className="stats">
                      <div><dt>Вакансій ВПК</dt><dd>{fmt(e.vpk_vacancies)}</dd></div>
                      <div><dt>Медіана</dt><dd>{money(e.median_salary)}</dd></div>
                      <div><dt>Нових за 30 днів</dt><dd>{fmt(e.new_30d)}</dd></div>
                    </dl>
                    <EmployerBadgeGroups employer={e} />
                  </div>
                </Link>
              ))
            )}
          </div>
          {shown < list.length && (
            <button className="btn btn-secondary cat-more" type="button" onClick={() => setShown(shown + PAGE)}>
              Показати ще {Math.min(PAGE, list.length - shown)} з {fmt(list.length - shown)}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
