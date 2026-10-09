import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, exportUrl, type VacancyQuery } from '../api/client'
import type { ApiVacancyFacets } from '../api/types'
import { AskButton } from '../components/AskButton'
import { ExportButtons } from '../components/ExportButtons'
import { VacancyDirection } from '../components/VacancyDirection'
import { ActiveChips, CheckGroup, FilterHeader, FilterSection, RadioGroup, RangeGroup, ToggleRow, type ActiveChip, type FacetOption } from '../components/FilterSidebar'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { useData } from '../data/DataContext'
import { useApi } from '../data/useApi'
import { ago, fmt, money, plural, salaryRange } from '../domain/format'
import { categoryOf, DOMAINS, employmentName, experienceName, FOCUS, ROLES, scheduleName, sourceName } from '../domain/labels'
import { useDebounced } from '../hooks/useDebounced'
import { CategoryBadge, VacancyBadges } from '../ui/badges'
import { Icon } from '../ui/Icon'
import './VacanciesPage.css'

const PAGE = 50
const SCOPES: { value: NonNullable<VacancyQuery['scope']>; label: string }[] = [
  { value: 'vpk', label: 'Підприємства ВПК' },
  { value: 'agency', label: 'Через кадрові агентства' },
  { value: 'all', label: 'Усі' },
]
const LEVELS: { value: NonNullable<VacancyQuery['level']>; label: string }[] = [
  { value: 'vpk', label: 'Усі' },
  { value: 'confirmed', label: 'Рішення прийнято' },
  { value: 'likely', label: 'На перевірці' },
]
const DAYS = [
  { value: '0', label: 'За весь час' },
  { value: '7', label: 'За 7 днів' },
  { value: '30', label: 'За 30 днів' },
  { value: '90', label: 'За 90 днів' },
  { value: '365', label: 'За рік' },
]

type FacetKey = keyof ApiVacancyFacets
// The region is `region` in the URL, the name the map and the companies use too.
const param = (key: FacetKey) => (key === 'region_id' ? 'region' : key)
const FACETS: { key: FacetKey; title: string; section: 'who' | 'where' | 'job'; searchable?: boolean }[] = [
  { key: 'focus', title: 'Фокус підприємства', section: 'who' },
  { key: 'domain', title: 'Галузь', section: 'who', searchable: true },
  { key: 'role', title: 'Роль підприємства', section: 'who' },
  { key: 'region_id', title: 'Регіон', section: 'where', searchable: true },
  { key: 'category', title: 'Напрям', section: 'job' },
  { key: 'experience', title: 'Досвід', section: 'job' },
  { key: 'schedule', title: 'Графік', section: 'job' },
  { key: 'employment', title: 'Зайнятість', section: 'job' },
  { key: 'source', title: 'Сайт вакансій', section: 'job' },
]

export function VacanciesPage({ tab }: { tab: 'listings' | 'professions' }) {
  const navigate = useNavigate()
  const { regionById } = useData()
  const { params, update, list, setList, num } = useUrlFilters()
  const [mobileOpen, setMobileOpen] = useState(false)
  const scope = (params.get('scope') as VacancyQuery['scope']) || 'vpk'
  const level = (params.get('level') as VacancyQuery['level']) || 'vpk'
  const markers = params.get('markers') === 'true'
  const withSalary = params.get('with_salary') === 'true'
  const days = params.get('days') ?? '0'
  const salaryMin = num('salary_min')
  const salaryMax = num('salary_max')
  const lists = Object.fromEntries(FACETS.map((f) => [f.key, list(param(f.key))])) as Record<FacetKey, string[]>
  const joined = (key: FacetKey) => lists[key].join(',') || undefined

  // Shared by both tabs: everything but the search, the profession and the sort.
  const base: VacancyQuery = {
    scope,
    level,
    markers: markers || undefined,
    with_salary: withSalary || undefined,
    salary_min: salaryMin,
    salary_max: salaryMax,
    days: Number(days) || undefined,
    ...Object.fromEntries(FACETS.map((f) => [f.key, joined(f.key)])),
  }
  const q = useDebounced(params.get('q') ?? '')
  const title = params.get('prof') ?? undefined
  const selection: VacancyQuery = { ...base, q: q || undefined, title }
  const facetsState = useApi(`facets:${JSON.stringify(selection)}`, (signal) => api.vacancyFacets(selection, signal))
  const facets = facetsState.status === 'ready' ? facetsState.data : facetsState.status === 'loading' ? facetsState.stale : undefined

  const label = (key: FacetKey, value: string): string => {
    if (value === 'none') return key === 'region_id' ? 'Регіон не вказано' : key === 'category' ? categoryOf(null).name : 'Не вказано'
    if (key === 'region_id') return regionById[Number(value)]?.name ?? value
    if (key === 'focus') return FOCUS[value as keyof typeof FOCUS] ?? value
    if (key === 'domain') return DOMAINS[value] ?? value
    if (key === 'role') return ROLES[value] ?? value
    if (key === 'category') return categoryOf(value).name
    if (key === 'experience') return experienceName(value) ?? value
    if (key === 'schedule') return scheduleName(value)
    if (key === 'employment') return employmentName(value)
    if (key === 'source') return sourceName(value)
    return value
  }
  // Raw values with one label (hh and trudvsem spell experience differently) form one option.
  const options = (key: FacetKey): FacetOption[] => {
    const groups = new Map<string, { raws: string[]; count: number }>()
    for (const { value, vacancies } of facets?.[key] ?? []) {
      const raw = value ?? 'none'
      const name = label(key, raw)
      const g = groups.get(name) ?? { raws: [], count: 0 }
      g.raws.push(raw)
      g.count += vacancies
      groups.set(name, g)
    }
    for (const raw of lists[key]) {
      const name = label(key, raw)
      if (!groups.has(name)) groups.set(name, { raws: [raw], count: 0 })
      else if (!groups.get(name)!.raws.includes(raw)) groups.get(name)!.raws.push(raw)
    }
    return [...groups].map(([name, g]) => ({ value: g.raws.join('|'), label: name, count: facets ? g.count : undefined }))
      .sort((a, b) => (a.value === 'none' ? 1 : 0) - (b.value === 'none' ? 1 : 0) || (b.count ?? 0) - (a.count ?? 0))
  }
  const facetGroup = (f: (typeof FACETS)[number]) => {
    const opts = options(f.key)
    const selected = opts.filter((o) => o.value.split('|').some((raw) => lists[f.key].includes(raw))).map((o) => o.value)
    return (
      <CheckGroup
        key={f.key}
        title={f.title}
        options={opts}
        selected={selected}
        searchable={f.searchable}
        onChange={(values) => setList(param(f.key), values.flatMap((v) => v.split('|')))}
      />
    )
  }

  const reset = () => update({
    scope: null, level: null, markers: null, with_salary: null, salary_min: null, salary_max: null, days: null, q: null, prof: null,
    ...Object.fromEntries(FACETS.map((f) => [param(f.key), null])),
  })
  const chips: ActiveChip[] = [
    ...(scope !== 'vpk' ? [{ key: 'scope', label: SCOPES.find((s) => s.value === scope)?.label ?? scope, onRemove: () => update({ scope: null }) }] : []),
    ...(level !== 'vpk' ? [{ key: 'level', label: LEVELS.find((l) => l.value === level)?.label ?? level, onRemove: () => update({ level: null }) }] : []),
    ...FACETS.flatMap((f) => lists[f.key].map((raw) => ({
      key: `${f.key}:${raw}`, label: raw === 'none' ? `${f.title}: не вказано` : label(f.key, raw), onRemove: () => setList(param(f.key), lists[f.key].filter((x) => x !== raw)),
    }))),
    ...(markers ? [{ key: 'markers', label: 'Явні ознаки ВПК', onRemove: () => update({ markers: null }) }] : []),
    ...(withSalary ? [{ key: 'with_salary', label: 'Із зарплатою', onRemove: () => update({ with_salary: null }) }] : []),
    ...(salaryMin != null || salaryMax != null ? [{
      key: 'salary', label: `Зарплата ${salaryMin != null ? `від ${fmt(salaryMin)}` : ''} ${salaryMax != null ? `до ${fmt(salaryMax)}` : ''} ₽`.replace(/\s+/g, ' '),
      onRemove: () => update({ salary_min: null, salary_max: null }),
    }] : []),
    ...(days !== '0' ? [{ key: 'days', label: DAYS.find((d) => d.value === days)?.label ?? days, onRemove: () => update({ days: null }) }] : []),
    ...(title ? [{ key: 'prof', label: title, onRemove: () => update({ prof: null }) }] : []),
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Вакансії</h1>
          <p>Усі оголошення підприємств ВПК — не лише профільні посади. Вакансії кадрових агентств, що наймають у ВПК, — окремо. Кожне веде на оригінал.</p>
        </div>
        <div className="segmented">
          <button type="button" aria-pressed={tab === 'listings'} onClick={() => navigate({ pathname: '/vacancies', search: params.toString() })}>Оголошення</button>
          <button type="button" aria-pressed={tab === 'professions'} onClick={() => navigate({ pathname: '/vacancies/professions', search: params.toString() })}>Професії</button>
        </div>
      </div>
      <div className="cat">
        <button className="btn btn-secondary fs-mobile-toggle" type="button" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
          <Icon name="list" />Фільтри{chips.length ? ` (${chips.length})` : ''}
        </button>
        <aside className={`fs-sidebar${mobileOpen ? ' open' : ''}`} aria-label="Фільтри" style={{ opacity: facetsState.status === 'loading' ? 0.75 : 1 }}>
          <FilterHeader active={chips.length} onReset={reset} />
          <FilterSection title="Хто наймає" icon="factory">
            <RadioGroup title="Роботодавець" options={SCOPES} value={scope ?? 'vpk'} onChange={(v) => update({ scope: v === 'vpk' ? null : v })} />
            <RadioGroup title="Стан рішення" options={LEVELS} value={level ?? 'vpk'} onChange={(v) => update({ level: v === 'vpk' ? null : v })} />
            {FACETS.filter((f) => f.section === 'who').map(facetGroup)}
          </FilterSection>
          <FilterSection title="Де" icon="pin">{FACETS.filter((f) => f.section === 'where').map(facetGroup)}</FilterSection>
          <FilterSection title="Вакансія" icon="briefcase">
            {FACETS.filter((f) => f.section === 'job').map(facetGroup)}
            <div className="fs-group">
              <ToggleRow label="Лише з явними ознаками ВПК у тексті" checked={markers} onChange={(v) => update({ markers: v ? 'true' : null })} />
            </div>
          </FilterSection>
          <FilterSection title="Зарплата і дата" icon="graph">
            <RangeGroup
              title="Зарплата на місяць"
              unit="₽"
              from={salaryMin}
              to={salaryMax}
              onChange={(from, to) => update({ salary_min: from == null ? null : String(from), salary_max: to == null ? null : String(to) })}
            />
            <div className="fs-group">
              <ToggleRow label="Лише із зазначеною зарплатою" checked={withSalary} onChange={(v) => update({ with_salary: v ? 'true' : null })} />
            </div>
            <RadioGroup title="Опубліковано" options={DAYS} value={days} onChange={(v) => update({ days: v === '0' ? null : v })} />
          </FilterSection>
          {facetsState.status === 'error' && <p className="fs-empty">Не вдалося порахувати кількість за фільтрами.</p>}
        </aside>
        <div className="cat-results">
          {tab === 'professions'
            ? <><ActiveChips chips={chips} onReset={reset} /><Professions base={base} /></>
            : <Listings base={base} params={params} update={update} chips={<ActiveChips chips={chips} onReset={reset} />} />}
        </div>
      </div>
    </>
  )
}

type Update = (patch: Record<string, string | null>, keepPage?: boolean) => void

function Listings({ base, params, update, chips }: { base: VacancyQuery; params: URLSearchParams; update: Update; chips: ReactNode }) {
  const { asOf } = useData()
  const navigate = useNavigate()
  const qInput = params.get('q') ?? ''
  const q = useDebounced(qInput)
  const title = params.get('prof') ?? undefined
  const sort = (params.get('sort') as VacancyQuery['sort']) || 'confirmed'
  const page = Number(params.get('page') ?? 0) || 0

  const query: VacancyQuery = { ...base, q: q || undefined, title, sort, limit: PAGE, offset: page * PAGE }
  const state = useApi(JSON.stringify(query), (signal) => api.vacancies(query, signal))
  const data = state.status === 'ready' ? state.data : state.status === 'loading' ? state.stale : undefined
  const pages = data ? Math.ceil(data.total / PAGE) : 0
  // The whole filtered selection, not only this page.
  const selection = { ...base, q: q || undefined, title }
  const exportOptions = (['csv', 'json'] as const).map((f) => ({ label: f.toUpperCase(), href: exportUrl('vacancies', f, selection) }))
  const goPage = (p: number) => update({ page: p ? String(p) : null }, true)
  // A page past the end (narrowed filters, an old link) goes to the last one instead of an empty table.
  const pastEnd = data != null && state.status === 'ready' && page > 0 && page >= pages
  useEffect(() => {
    if (pastEnd) update({ page: pages > 1 ? String(pages - 1) : null }, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastEnd, pages])

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
          <select className="input" id="vacSort" value={sort} onChange={(e) => update({ sort: e.target.value === 'confirmed' ? null : e.target.value })}>
            <option value="confirmed">Спершу підтверджені</option>
            <option value="published">Спершу нові</option>
            <option value="salary">Спершу вища зарплата</option>
          </select>
        </div>
      </div>
      {chips}
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
              <tr><th>Посада</th><th>Галузь</th><th>Роботодавець</th><th>Місто</th><th className="num">Зарплата</th><th>Досвід</th><th>Дотичність</th><th className="num">Опубліковано</th></tr>
            </thead>
            <tbody>
              {data && data.items.length === 0 && (
                <tr><td colSpan={8}><p className="empty-row">Нічого не знайдено. Зміни пошук, період або регіон.</p></td></tr>
              )}
              {data?.items.map((v) => (
                <tr key={v.id} className="clickable" onClick={() => navigate(`/vacancies/${v.id}`)}>
                  <td className="wrap"><Link className="vacancy-title-link" to={`/vacancies/${v.id}`} onClick={(event) => event.stopPropagation()}><b>{v.title}</b></Link></td>
                  <td className="wrap"><VacancyDirection vacancy={v} compact /></td>
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
  const { params } = useUrlFilters()
  const open = (title: string) => {
    const next = new URLSearchParams(params)
    next.set('prof', title)
    navigate({ pathname: '/vacancies', search: next.toString() })
  }
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
              <tr key={p.title} className="clickable" onClick={() => open(p.title)}>
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
