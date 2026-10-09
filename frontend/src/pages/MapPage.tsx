import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { FilterBar } from '../components/FilterBar'
import { MapSlot } from '../components/MapSlot'
import { EmployerRow } from '../components/rows'
import { useData } from '../data/DataContext'
import { fmt, money, plural } from '../domain/format'
import { shownVacancies } from '../domain/labels'
import { useFilters } from '../state/FiltersContext'
import type { Employer } from '../domain/types'
import { EmployerBadgeGroups } from '../ui/EmployerBadgeGroups'
import { Icon } from '../ui/Icon'
import './MapPage.css'
import { matcher } from '../domain/search'
import { useAgent } from '../features/agent/AgentContext'
import { mapExtras } from '../components/mapNavigation'

const LIST_LIMIT = 300

export function MapPage() {
  const { employers, byId } = useData()
  const filters = useFilters()
  const agent = useAgent()
  const [params] = useSearchParams()
  const rawResultIds = params.get('agent_ids') ?? ''
  const resultIds = useMemo(() => rawResultIds.split(',').map(Number).filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 30), [rawResultIds])
  const [search, setSearch] = useState('')
  const list = useMemo(() => {
    const m = matcher(search)
    return employers.filter((e) => (!resultIds.length || resultIds.includes(e.id)) && filters.matches(e) && m(e.name, e.gur_name, e.locality, e.region, e.inn))
  }, [employers, filters, search, resultIds])
  // The selected employer opens even if the map filters leave it out (a link from its profile).
  const sel = byId[Number(params.get('co'))] as Employer | undefined
  const outside = sel != null && !list.includes(sel)
  const onMap = useMemo(() => outside ? [sel!, ...list] : list, [outside, sel, list])

  return (
    <div className="map-screen">
      <div className="page-head">
        <div>
          <h1>Карта</h1>
          <p>Адреси підприємств за реєстром, місця найму, постачання та холдинги. Увімкни потрібні шари на карті або обери роботодавця.</p>
        </div>
        <FilterBar />
      </div>
      <div className="map-page">
        <aside className="panel map-list">
          <div className="panel-head" style={{ padding: '0 6px' }}>
            <div>
              <h3>Роботодавці</h3>
              <p>
                {fmt(list.length)} {plural(list.length, 'роботодавець', 'роботодавці', 'роботодавців')}
                {list.length > LIST_LIMIT ? `, показано ${LIST_LIMIT} найбільших` : ''}
              </p>
            </div>
          </div>
          <label className="sr" htmlFor="map-search">Пошук роботодавця, міста, регіону або ІПН</label>
          <input id="map-search" className="input" type="search" placeholder="Роботодавець, місто або ІПН" value={search} onChange={(event) => setSearch(event.target.value)} />
          {resultIds.length > 0 && <div className="map-result-note"><span>Вибірка з відповіді агента</span><Link to={filters.href('/map')}>Показати всі</Link></div>}
          <div className="scroll">
            {!list.length && <p className="map-list-empty">За обраними фільтрами роботодавців не знайдено.</p>}
            {list.slice(0, LIST_LIMIT).map((e) => (
              <EmployerRow key={e.id} employer={e} to={filters.href('/map', mapExtras(params, e.id))} current={e.id === sel?.id} />
            ))}
          </div>
        </aside>
        <div className="panel" style={{ display: 'flex' }}>
          <MapSlot key={`${rawResultIds}:${params.get('layers')}:${params.get('network')}:${params.get('network_other')}:${params.get('agent_view')}`} employers={onMap} selectedId={sel?.id} onContextChange={agent.setMapView} search={search} resultIds={resultIds}>
            {sel && (
              <div className="map-pop" role="dialog" aria-label={sel.name}>
                <div className="pop-top">
                  <Link className="btn btn-secondary btn-icon btn-sm" to={filters.href('/map', mapExtras(params))} aria-label="Закрити"><Icon name="x" /></Link>
                </div>
                <h4>{sel.name}</h4>
                <p className="place"><Icon name="pin" />{[sel.locality, sel.region].filter(Boolean).join(', ') || 'Місто не вказано'}</p>
                {outside && (
                  <p className="map-pop-note">
                    Не відповідає фільтрам карти чи пошуку.{' '}
                    <button type="button" className="map-pop-reset" onClick={() => { filters.set({ region: [], focus: [], domain: [], role: [] }); setSearch('') }}>Скинути фільтри</button>
                  </p>
                )}
                <dl className="stats" style={{ marginTop: 12 }}>
                  <div><dt>{shownVacancies(sel).label}</dt><dd>{fmt(shownVacancies(sel).value)}</dd></div>
                  <div><dt>Медіана</dt><dd>{money(sel.median_salary)}</dd></div>
                  <div><dt>Нових за 30 днів</dt><dd>{fmt(sel.new_30d)}</dd></div>
                </dl>
                <EmployerBadgeGroups employer={sel} />
                <div className="map-pop-actions">
                  <Link className="btn btn-primary btn-sm" to={`/companies/${sel.id}`}>Відкрити профіль</Link>
                </div>
              </div>
            )}
          </MapSlot>
        </div>
      </div>
    </div>
  )
}
