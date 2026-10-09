import { useData } from '../data/DataContext'
import { DOMAINS, FOCUS, ROLES } from '../domain/labels'
import { useFilters, type Filters } from '../state/FiltersContext'

type Key = 'region' | 'focus' | 'domain' | 'role'

/** Region, focus, industry and role as single selects; kept in the URL, shared with the catalogs. */
export function FilterBar() {
  const { regions } = useData()
  const filters = useFilters()
  const select = (key: Key, id: string, label: string, all: string, options: [string, string][]) => {
    const values = filters[key]
    // Several values come from a catalog sidebar; they stay until a single one is picked here.
    const many = values.length > 1 || (values.length === 1 && !options.some(([k]) => k === values[0]))
    const value = many ? 'many' : values[0] ?? 'all'
    return (
      <div className="select">
        <label className="sr" htmlFor={id}>{label}</label>
        <select className="input" id={id} value={value} onChange={(e) => filters.set({ [key]: e.target.value === 'all' ? [] : [e.target.value] } as Partial<Filters>)}>
          <option value="all">{all}</option>
          {many && <option value="many" disabled>{label}: обрано {values.length}</option>}
          {options.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
        </select>
      </div>
    )
  }
  return (
    <div className="filter-bar" aria-label="Фільтри">
      {select('region', 'fRegion', 'Регіон', 'Усі регіони', regions.map((r) => [String(r.region_id), r.name]))}
      {select('focus', 'fFocus', 'Фокус', 'Фокус: усі', Object.entries(FOCUS).map(([k, name]) => [k, `Фокус: ${name}`]))}
      {select('domain', 'fDomain', 'Галузь', 'Усі галузі', Object.entries(DOMAINS))}
      {select('role', 'fRole', 'Роль', 'Усі ролі', Object.entries(ROLES))}
    </div>
  )
}
