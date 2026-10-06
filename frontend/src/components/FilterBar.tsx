import { useData } from '../data/DataContext'
import { CATEGORIES } from '../domain/labels'
import { PERIODS, useFilters, type Period } from '../state/FiltersContext'

/** Period, region and category filters. Shared state: the choice follows the user across pages. */
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
        <label className="sr" htmlFor="fCategory">Напрям</label>
        <select className="input" id="fCategory" value={filters.category} onChange={(e) => filters.set({ category: e.target.value })}>
          <option value="all">Усі напрями</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
