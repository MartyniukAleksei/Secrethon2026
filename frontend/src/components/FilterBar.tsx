import { useData } from '../data/DataContext'
import { DOMAINS, FOCUS, ROLES } from '../domain/labels'
import { PERIODS, useFilters, type Filters, type Period } from '../state/FiltersContext'

/** Period, region, focus, industry and role filters. Shared state: the choice follows the user across pages. */
export function FilterBar({ period = true }: { period?: boolean }) {
  const { regions } = useData()
  const filters = useFilters()
  return (
    <div className="filter-bar" aria-label="Фільтри">
      {period && (
        <div className="select">
          <label className="sr" htmlFor="fPeriod">Період публікації</label>
          <select className="input" id="fPeriod" value={filters.period} onChange={(e) => filters.set({ period: Number(e.target.value) as Period })}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="select">
        <label className="sr" htmlFor="fRegion">Регіон</label>
        <select className="input" id="fRegion" value={filters.region} onChange={(e) => filters.set({ region: e.target.value === 'all' ? 'all' : Number(e.target.value) })}>
          <option value="all">Усі регіони</option>
          {regions.map((r) => (
            <option key={r.region_id} value={r.region_id}>{r.name}</option>
          ))}
        </select>
      </div>
      <div className="select">
        <label className="sr" htmlFor="fFocus">Фокус</label>
        <select className="input" id="fFocus" value={filters.focus} onChange={(e) => filters.set({ focus: e.target.value as Filters['focus'] })}>
          <option value="all">Фокус: усі</option>
          {Object.entries(FOCUS).map(([k, name]) => (
            <option key={k} value={k}>Фокус: {name}</option>
          ))}
        </select>
      </div>
      <div className="select">
        <label className="sr" htmlFor="fDomain">Галузь</label>
        <select className="input" id="fDomain" value={filters.domain} onChange={(e) => filters.set({ domain: e.target.value })}>
          <option value="all">Усі галузі</option>
          {Object.entries(DOMAINS).map(([k, name]) => (
            <option key={k} value={k}>{name}</option>
          ))}
        </select>
      </div>
      <div className="select">
        <label className="sr" htmlFor="fRole">Роль</label>
        <select className="input" id="fRole" value={filters.role} onChange={(e) => filters.set({ role: e.target.value })}>
          <option value="all">Усі ролі</option>
          {Object.entries(ROLES).map(([k, name]) => (
            <option key={k} value={k}>{name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
