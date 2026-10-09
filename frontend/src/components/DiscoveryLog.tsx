import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import { useApi } from '../data/useApi'
import { fmt, longDate, plural } from '../domain/format'
import { DISCOVERY_NOTE, DISCOVERY_STATUS, PROVIDERS } from '../domain/labels'
import { useDebounced } from '../hooks/useDebounced'
import { Icon } from '../ui/Icon'
import './DiscoveryLog.css'

const PAGE = 30
/** What was searched in open sources and what came of it; one company's rows, or all with a company search. */
export function DiscoveryLog({ companyId }: { companyId?: number }) {
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState('')
  const [qInput, setQ] = useState('')
  const q = useDebounced(qInput)
  const [page, setPage] = useState(0)
  const params = { company_id: companyId, provider: provider || undefined, status: status || undefined, q: q || undefined, limit: PAGE, offset: page * PAGE }
  const state = useApi(`discovery:${JSON.stringify(params)}`, (signal) => api.discovery(params, signal))
  const data = state.status === 'ready' ? state.data : state.status === 'loading' ? state.stale : undefined
  const pages = data ? Math.ceil(data.total / PAGE) : 0
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0) }

  return (
    <div className="discovery">
      <div className="row discovery-filters">
        {companyId == null && (
          <label className="search">
            <span className="sr">Компанія</span>
            <Icon name="search" />
            <input className="input" value={qInput} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Компанія (будь-якою мовою)" />
          </label>
        )}
        <div className="select">
          <label className="sr" htmlFor="dProvider">Джерело пошуку</label>
          <select className="input" id="dProvider" value={provider} onChange={(e) => reset(setProvider)(e.target.value)}>
            <option value="">Усі джерела</option>
            {Object.entries(PROVIDERS).map(([k, name]) => <option key={k} value={k}>{name}</option>)}
          </select>
        </div>
        <div className="select">
          <label className="sr" htmlFor="dStatus">Результат</label>
          <select className="input" id="dStatus" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
            <option value="">Усі результати</option>
            {Object.entries(DISCOVERY_STATUS).map(([k, name]) => <option key={k} value={k}>{name}</option>)}
          </select>
        </div>
        <span className="discovery-total">{data ? `${fmt(data.total)} ${plural(data.total, 'запис', 'записи', 'записів')}` : 'Завантаження…'}</span>
      </div>
      {state.status === 'error' && <p className="empty-row">Не вдалося завантажити журнал пошуку.</p>}
      {data && data.total === 0 && <p className="empty-row">Записів немає.</p>}
      <ul className="discovery-list" style={{ opacity: state.status === 'loading' ? 0.6 : 1 }}>
        {data?.items.map((d) => (
          <li key={d.log_id}>
            <div className="discovery-head">
              <span className={`badge ${d.status === 'fact' || d.status === 'contact' ? 'info' : ''}`}>{DISCOVERY_STATUS[d.status]}</span>
              <span className="badge">{PROVIDERS[d.provider] ?? d.provider}</span>
              {companyId == null && d.company_name && (
                d.card_id != null ? <Link to={`/companies/${d.card_id}/search`}>{d.company_name}</Link> : <span>{d.company_name}</span>
              )}
              {d.found_at && <time className="discovery-date" dateTime={d.found_at}>{longDate(d.found_at)}</time>}
            </div>
            {d.query && <p className="discovery-query">Запит: «{d.query}»</p>}
            {d.url && <a className="discovery-url" href={d.url} target="_blank" rel="noreferrer noopener">{d.title || d.url}<Icon name="external" /></a>}
            {d.snippet && (
              <details>
                <summary>Фрагмент</summary>
                <p lang="ru">{d.snippet}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-secondary btn-sm" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
          <span>{page + 1} з {fmt(pages)}</span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Далі</button>
        </div>
      )}
      <p className="discovery-note">{DISCOVERY_NOTE}</p>
    </div>
  )
}
