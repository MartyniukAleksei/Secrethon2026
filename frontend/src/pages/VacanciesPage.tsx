import { Link, useNavigate, useSearchParams } from 'react-router'
import { api, exportUrl, type VacancyQuery } from '../api/client'
import { AskButton } from '../components/AskButton'
import { ExportButtons } from '../components/ExportButtons'
import { FilterBar } from '../components/FilterBar'
import { useData } from '../data/DataContext'
import { useApi } from '../data/useApi'
import { ago, fmt, money, plural, salaryRange } from '../domain/format'
import { experienceName } from '../domain/labels'
import { useDebounced } from '../hooks/useDebounced'
import { useFilters } from '../state/FiltersContext'
import { CategoryBadge, VacancyBadges } from '../ui/badges'
import { Icon } from '../ui/Icon'
import './VacanciesPage.css'

const PAGE = 50
const SCOPES: [NonNullable<VacancyQuery['scope']>, string][] = [
  ['vpk', 'Підприємства ВПК'],
  ['agency', 'Через кадрові агентства'],
]
const LEVELS: [NonNullable<VacancyQuery['level']>, string][] = [
  ['vpk', 'Усі'],
  ['confirmed', 'Рішення прийнято'],
  ['likely', 'На перевірці'],
]

/** Read/write URL search params; changing any filter resets the page. */
function useParams() {
  const [params, setParams] = useSearchParams()
  const update = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v == null || v === '' ? next.delete(k) : next.set(k, v)))
    if (!keepPage) next.delete('page')
    setParams(next, { replace: true })
  }
  return [params, update] as const
}

export function VacanciesPage({ tab }: { tab: 'listings' | 'professions' }) {
  const navigate = useNavigate()
  const filters = useFilters()
  const [params, update] = useParams()
  const scope = (params.get('scope') as VacancyQuery['scope']) || 'vpk'
  const level = (params.get('level') as VacancyQuery['level']) || 'vpk'
  const markers = params.get('markers') === 'true'

  // Shared by both tabs: the top filters plus the final label (scope, level, explicit markers).
  const base: VacancyQuery = {
    scope,
    level,
    markers: markers || undefined,
    region_id: filters.region === 'all' ? undefined : filters.region,
    focus: filters.focus === 'all' ? undefined : filters.focus,
    domain: filters.domain === 'all' ? undefined : filters.domain,
    role: filters.role === 'all' ? undefined : filters.role,
    days: filters.period || undefined,
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Вакансії</h1>
          <p>Усі оголошення підприємств ВПК — не лише профільні посади. Вакансії кадрових агентств, що наймають у ВПК, — окремо. Кожне веде на оригінал.</p>
        </div>
        <div className="segmented">
          <button type="button" aria-pressed={tab === 'listings'} onClick={() => navigate('/vacancies')}>Оголошення</button>
          <button type="button" aria-pressed={tab === 'professions'} onClick={() => navigate('/vacancies/professions')}>Професії</button>
        </div>
      </div>
      <div className="vac-filters">
        <FilterBar />
        <div className="segmented sm" aria-label="Хто наймає">
          {SCOPES.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={scope === k} onClick={() => update({ scope: k === 'vpk' ? null : k })}>{label}</button>
          ))}
        </div>
        <div className="segmented sm" aria-label="Стан рішення">
          {LEVELS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={level === k} onClick={() => update({ level: k === 'vpk' ? null : k })}>{label}</button>
          ))}
        </div>
        <label className="row">
          <input type="checkbox" checked={markers} onChange={(e) => update({ markers: e.target.checked ? 'true' : null })} />
          Лише з явними ознаками ВПК у тексті
        </label>
      </div>
      {tab === 'professions' ? <Professions base={base} /> : <Listings base={base} params={params} update={update} />}
    </>
  )
}

type Update = (patch: Record<string, string | null>, keepPage?: boolean) => void

function Listings({ base, params, update }: { base: VacancyQuery; params: URLSearchParams; update: Update }) {
  const { asOf } = useData()
  const navigate = useNavigate()
  const qInput = params.get('q') ?? ''
  const q = useDebounced(qInput)
  const title = params.get('prof') ?? undefined
  const sort = (params.get('sort') as VacancyQuery['sort']) || 'published'
  const page = Number(params.get('page') ?? 0) || 0

  const query: VacancyQuery = { ...base, q: q || undefined, title, sort, limit: PAGE, offset: page * PAGE }
  const state = useApi(JSON.stringify(query), (signal) => api.vacancies(query, signal))
  const data = state.status === 'ready' ? state.data : state.status === 'loading' ? state.stale : undefined
  const pages = data ? Math.ceil(data.total / PAGE) : 0
  // The whole filtered selection, not only this page.
  const selection = { ...base, q: q || undefined, title }
  const exportOptions = (['csv', 'json'] as const).map((f) => ({ label: f.toUpperCase(), href: exportUrl('vacancies', f, selection) }))
  const goPage = (p: number) => update({ page: p ? String(p) : null }, true)

  return (
    <>
      <div className="vac-bar">
        <label className="search">
          <span className="sr">Пошук</span>
          <Icon name="search" />
          <input className="input" value={qInput} onChange={(e) => update({ q: e.target.value })} placeholder="Посада, роботодавець або місто" />
        </label>
        <div className="select">
          <label className="sr" htmlFor="vacSort">Сортування</label>
          <select className="input" id="vacSort" value={sort} onChange={(e) => update({ sort: e.target.value === 'published' ? null : e.target.value })}>
            <option value="published">Спершу нові</option>
            <option value="salary">Спершу вища зарплата</option>
          </select>
        </div>
      </div>
      {title && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="chip" type="button" aria-pressed="true" onClick={() => update({ prof: null })} aria-label={`Прибрати фільтр «${title}»`}>
            {title}
            <Icon name="x" style={{ display: 'block' }} />
          </button>
        </div>
      )}
      <div className="panel">
        <div className="panel-head">
          <p>{data ? `${fmt(data.total)} ${plural(data.total, 'оголошення', 'оголошення', 'оголошень')}` : 'Завантаження…'}</p>
          <div className="row">
            <ExportButtons options={exportOptions} />
            <AskButton question="Кого найбільше наймає ВПК і за які гроші?" label="Підсумувати" />
          </div>
        </div>
        {state.status === 'error' && <p className="empty-row">Не вдалося завантажити вакансії. Спробуй ще раз.</p>}
        <div className="table-wrap" style={{ opacity: state.status === 'loading' ? 0.6 : 1 }}>
          <table className="data">
            <thead>
              <tr><th>Посада</th><th>Роботодавець</th><th>Місто</th><th className="num">Зарплата</th><th>Досвід</th><th>Дотичність</th><th className="num">Опубліковано</th></tr>
            </thead>
            <tbody>
              {data && data.items.length === 0 && (
                <tr><td colSpan={7}><p className="empty-row">Нічого не знайдено. Зміни пошук, період або регіон.</p></td></tr>
              )}
              {data?.items.map((v) => (
                <tr key={v.id} className="clickable" onClick={() => navigate(`/vacancies/${v.id}`)}>
                  <td className="wrap"><Link className="vacancy-title-link" to={`/vacancies/${v.id}`} onClick={(event) => event.stopPropagation()}><b>{v.title}</b></Link></td>
                  <td className="wrap">{v.employer_name}</td>
                  <td>{v.locality ?? '—'}</td>
                  <td className="num">{salaryRange(v) ?? '—'}</td>
                  <td>{experienceName(v.experience) ?? '—'}</td>
                  <td className="wrap"><VacancyBadges vacancy={v} /></td>
                  <td className="num">{ago(v.published_at, asOf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && state.status === 'loading' && <div className="skeleton" style={{ height: 400 }} />}
        </div>
        {pages > 1 && (
          <div className="pager">
            <button className="btn btn-secondary btn-sm" type="button" disabled={page === 0} onClick={() => goPage(page - 1)}>Назад</button>
            <span>Сторінка {page + 1} з {fmt(pages)}</span>
            <button className="btn btn-secondary btn-sm" type="button" disabled={page + 1 >= pages} onClick={() => goPage(page + 1)}>Далі</button>
          </div>
        )}
      </div>
    </>
  )
}

function Professions({ base }: { base: VacancyQuery }) {
  const navigate = useNavigate()
  const query = { ...base, limit: 100 }
  const state = useApi(`prof:${JSON.stringify(query)}`, (signal) => api.professions(query, signal))
  const rows = state.status === 'ready' ? state.data : state.status === 'loading' ? state.stale : undefined
  const max = rows?.[0]?.vacancies ?? 1

  if (state.status === 'error') return <p className="empty-row">Не вдалося завантажити професії.</p>
  if (rows && !rows.length) return <div className="empty"><h4>За цими фільтрами вакансій немає</h4><p>Розшир період або прибери фільтри.</p></div>

  return (
    <div className="panel" style={{ opacity: state.status === 'loading' ? 0.6 : 1 }}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Професія</th><th>Напрям</th><th className="num">Вакансій</th><th className="num">Роботодавців</th><th className="num">Медіана</th></tr>
          </thead>
          <tbody>
            {rows?.map((p) => (
              <tr key={p.title} className="clickable" onClick={() => navigate(`/vacancies?prof=${encodeURIComponent(p.title)}`)}>
                <td className="wrap"><b>{p.title}</b></td>
                <td>{p.category ? <CategoryBadge category={p.category} /> : '—'}</td>
                <td className="num"><span className="inline-bar" style={{ width: `${((p.vacancies / max) * 60).toFixed(0)}px` }} />{fmt(p.vacancies)}</td>
                <td className="num">{fmt(p.employers ?? 0)}</td>
                <td className="num">{money(p.median_salary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows && <div className="skeleton" style={{ height: 300 }} />}
      </div>
    </div>
  )
}
