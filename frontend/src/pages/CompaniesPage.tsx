import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ExportButtons } from '../components/ExportButtons'
import { ActiveChips, CheckGroup, FilterHeader, FilterSection, RangeGroup, type ActiveChip, type FacetOption } from '../components/FilterSidebar'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { downloadText, toCsv, toJson } from '../data/download'
import { useData } from '../data/DataContext'
import { fmt, money, plural } from '../domain/format'
import { categoryOf, DOMAINS, effectiveCategory, effectiveVpk, FOCUS, focusKeys, HUMAN_VPK, isSanctioned, isVpkConfirmed, ROLES, sanctionsOf, shownVacancies, sourceName, vpkCategoryName } from '../domain/labels'
import type { Employer } from '../domain/types'
import { EmployerBadgeGroups } from '../ui/EmployerBadgeGroups'
import { CompanyTile } from '../ui/CompanyMark'
import { Icon } from '../ui/Icon'
import './CompaniesPage.css'
import { matcher } from '../domain/search'

type Sort = 'vacancies' | 'confirmed' | 'salary' | 'new' | 'sanctions'
const SORTS: Record<Sort, { label: string; key: (e: Employer) => number }> = {
  vacancies: { label: 'Спершу більше вакансій', key: (e) => e.vpk_vacancies + e.agency_vacancies },
  confirmed: { label: 'Спершу більше підтверджених', key: (e) => e.confirmed_vacancies },
  new: { label: 'Спершу більше нових за 30 днів', key: (e) => e.new_30d },
  salary: { label: 'Спершу вища зарплата', key: (e) => e.median_salary ?? -1 },
  sanctions: { label: 'Спершу більше санкцій', key: (e) => (isSanctioned(e) ? Math.max(sanctionsOf(e).total, 1) : 0) },
}
const PAGE = 60

// Same fields as the `employers` open data set (its id is `employer_id` there).
const EXPORT_COLUMNS = [
  'id', 'name', 'source', 'profile_url', 'inn', 'ogrn', 'kpp', 'region', 'locality', 'category',
  'vpk_vacancies', 'confirmed_vacancies', 'total_vacancies', 'new_30d', 'median_salary',
  'last_published_at', 'gur_company_id', 'gur_name', 'sanctions_count',
  'human_sources', 'human_reliability', 'human_category', 'human_sanctions', 'human_vpk',
  'human_reviewed_by', 'human_reviewed_at',
] as const
type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], unknown>

// The human review flattened into `human_*` columns, as in the open data set.
const exportRow = ({ human_review: hr, ...e }: Employer): ExportRow => ({
  ...e,
  human_sources: hr?.sources?.join('; ') ?? null,
  human_reliability: hr?.reliability ?? null,
  human_category: hr?.category ?? null,
  human_sanctions: hr?.sanctions ?? null,
  human_vpk: hr?.vpk ?? null,
  human_reviewed_by: hr?.reviewed_by ?? null,
  human_reviewed_at: hr?.reviewed_at ?? null,
})

type Dim = {
  key: string
  title: string
  section: 'what' | 'where' | 'signs'
  /** The values the card counts under; a card may have several (focus tags). */
  of: (e: Employer) => string[]
  label: (value: string) => string
  searchable?: boolean
  limit?: number
}

const yesNo = (test: (e: Employer) => boolean) => (e: Employer) => [test(e) ? 'yes' : 'no']
const named = (names: Record<string, string>, none = 'Не визначено') => (v: string) => (v === 'none' ? none : names[v] ?? v)

type Range = { key: string; title: string; of: (e: Employer) => number | null; unit?: string }
const RANGES: Range[] = [
  { key: 'vac', title: 'Вакансій ВПК', of: (e) => shownVacancies(e).value },
  { key: 'new', title: 'Нових за 30 днів', of: (e) => e.new_30d },
  { key: 'sal', title: 'Медіана зарплати', of: (e) => e.median_salary, unit: '₽' },
  // A human review wins, as in the «Санкції» filter and the badge.
  { key: 'sanc', title: 'Санкцій (юрисдикцій)', of: (e) => {
    const total = sanctionsOf(e).total
    if (e.human_review?.sanctions === 'not_sanctioned') return 0
    return e.human_review?.sanctions === 'sanctioned' ? Math.max(total, 1) : total
  } },
]

export function CompaniesPage() {
  const { employers, regionById } = useData()
  const { params, update, list: urlList, setList, num } = useUrlFilters()
  const [shown, setShown] = useState(PAGE)
  const [mobileOpen, setMobileOpen] = useState(false)
  const query = params.get('q') ?? ''
  const sort = (params.get('sort') as Sort | null) ?? 'vacancies'

  const dims = useMemo<Dim[]>(() => [
    { key: 'vpk', title: 'Рішення щодо ВПК', section: 'what', of: (e) => [isVpkConfirmed(e) ? 'confirmed' : effectiveVpk(e)], label: named(HUMAN_VPK) },
    { key: 'kind', title: 'Тип юрособи', section: 'what', of: (e) => [e.classification?.vpk_category ?? e.agency?.category ?? 'unknown'], label: vpkCategoryName },
    { key: 'focus', title: 'Фокус', section: 'what', of: (e) => focusKeys(e), label: named(FOCUS) },
    { key: 'domain', title: 'Галузь', section: 'what', of: (e) => [e.classification?.direction_domain ?? 'none'], label: named(DOMAINS), searchable: true },
    { key: 'role', title: 'Роль', section: 'what', of: (e) => [e.classification?.direction_role ?? 'none'], label: named(ROLES) },
    { key: 'dir', title: 'Напрям вакансій', section: 'what', of: (e) => [effectiveCategory(e) ?? 'none'], label: (v) => categoryOf(v === 'none' ? null : v).name },
    { key: 'region', title: 'Регіон', section: 'where', of: (e) => [e.region_id == null ? 'none' : String(e.region_id)], label: (v) => (v === 'none' ? 'Регіон не вказано' : regionById[Number(v)]?.name ?? v), searchable: true },
    { key: 'city', title: 'Місто', section: 'where', of: (e) => [e.locality ?? 'none'], label: (v) => (v === 'none' ? 'Місто не вказано' : v), searchable: true },
    { key: 'sanctions', title: 'Санкції', section: 'signs', of: yesNo(isSanctioned), label: named({ yes: 'Під санкціями', no: 'Санкцій не виявлено' }) },
    { key: 'gur', title: 'База ГУР «Війна і санкції»', section: 'signs', of: yesNo((e) => e.gur_company_id != null), label: named({ yes: 'Є в базі ГУР', no: 'Немає в базі ГУР' }) },
    { key: 'agency', title: 'Кадрове агентство', section: 'signs', of: yesNo((e) => e.agency_vacancies > 0), label: named({ yes: 'Наймає у ВПК як агентство', no: 'Не агентство' }) },
    { key: 'card', title: 'Картка', section: 'signs', of: (e) => [e.is_branch ? 'branch' : 'main'], label: named({ main: 'Головне підприємство', branch: 'Філія' }) },
    { key: 'review', title: 'Ручна перевірка', section: 'signs', of: yesNo((e) => e.human_review != null), label: named({ yes: 'Перевірено людиною', no: 'Без ручної перевірки' }) },
    { key: 'conflict', title: 'Зіставлення з юрособою', section: 'signs', of: yesNo((e) => e.match_conflict), label: named({ yes: 'Сумнівне зіставлення', no: 'Без сумнівів' }) },
    { key: 'source', title: 'Сайт вакансій', section: 'signs', of: (e) => [e.source], label: sourceName },
  ], [regionById])

  const selected = Object.fromEntries(dims.map((d) => [d.key, urlList(d.key)])) as Record<string, string[]>
  const ranges = Object.fromEntries(RANGES.map((r) => [r.key, [num(`${r.key}_from`), num(`${r.key}_to`)]])) as Record<string, [number | undefined, number | undefined]>

  // Ukrainian or Latin spelling finds the Russian names too.
  const m = matcher(query)
  const base = employers.filter((e) => m(e.name, e.gur_name, e.locality, e.inn) && RANGES.every((r) => {
    const [from, to] = ranges[r.key]
    if (from == null && to == null) return true
    const value = r.of(e)
    return value != null && (from == null || value >= from) && (to == null || value <= to)
  }))
  const passes = (e: Employer, skip?: string) =>
    dims.every((d) => d.key === skip || !selected[d.key].length || d.of(e).some((v) => selected[d.key].includes(v)))
  const list = base.filter((e) => passes(e)).sort((a, b) => SORTS[sort].key(b) - SORTS[sort].key(a))

  // Counts per value under all the other filters, as a facet sidebar shows them.
  const options = (d: Dim): FacetOption[] => {
    const counts = new Map<string, number>()
    for (const e of base) if (passes(e, d.key)) for (const v of new Set(d.of(e))) counts.set(v, (counts.get(v) ?? 0) + 1)
    for (const v of selected[d.key]) if (!counts.has(v)) counts.set(v, 0)
    return [...counts].map(([value, count]) => ({ value, count, label: d.label(value) }))
      .sort((a, b) => (a.value === 'none' ? 1 : 0) - (b.value === 'none' ? 1 : 0) || b.count - a.count || a.label.localeCompare(b.label, 'uk'))
  }

  const change = (patch: Record<string, string | null>) => {
    update(patch)
    setShown(PAGE)
  }
  const reset = () => change({
    q: null,
    ...Object.fromEntries(dims.map((d) => [d.key, null])),
    ...Object.fromEntries(RANGES.flatMap((r) => [[`${r.key}_from`, null], [`${r.key}_to`, null]])),
  })
  const chips: ActiveChip[] = [
    ...dims.flatMap((d) => selected[d.key].map((v) => ({
      key: `${d.key}:${v}`, label: v === 'none' ? `${d.title}: ${d.label(v).toLowerCase()}` : d.label(v),
      onRemove: () => { setList(d.key, selected[d.key].filter((x) => x !== v)); setShown(PAGE) },
    }))),
    ...RANGES.flatMap((r) => {
      const [from, to] = ranges[r.key]
      if (from == null && to == null) return []
      const text = `${r.title}: ${from != null ? `від ${fmt(from)}` : ''}${from != null && to != null ? ' ' : ''}${to != null ? `до ${fmt(to)}` : ''}`
      return [{ key: r.key, label: text, onRemove: () => change({ [`${r.key}_from`]: null, [`${r.key}_to`]: null }) }]
    }),
  ]
  const group = (d: Dim) => (
    <CheckGroup
      key={d.key}
      title={d.title}
      options={options(d)}
      selected={selected[d.key]}
      onChange={(values) => { setList(d.key, values); setShown(PAGE) }}
      searchable={d.searchable}
      defaultOpen={d.section !== 'signs' || d.key === 'sanctions' || d.key === 'gur'}
    />
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Підприємства</h1>
          <p>Роботодавці, у яких є вакансії, віднесені до ВПК. Відкрий картку, щоб побачити вакансії, зарплати, санкції й зв'язки.</p>
        </div>
      </div>
      <div className="cat">
        <button className="btn btn-secondary fs-mobile-toggle" type="button" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
          <Icon name="list" />Фільтри{chips.length ? ` (${chips.length})` : ''}
        </button>
        <aside className={`fs-sidebar${mobileOpen ? ' open' : ''}`} aria-label="Фільтри">
          <FilterHeader active={chips.length} onReset={reset} />
          <FilterSection title="Що за підприємство" icon="factory">{dims.filter((d) => d.section === 'what').map(group)}</FilterSection>
          <FilterSection title="Де наймає" icon="pin">{dims.filter((d) => d.section === 'where').map(group)}</FilterSection>
          <FilterSection title="Ознаки" icon="bookmark">{dims.filter((d) => d.section === 'signs').map(group)}</FilterSection>
          <FilterSection title="Показники" icon="graph">
            {RANGES.map((r) => (
              <RangeGroup
                key={r.key}
                title={r.title}
                unit={r.unit}
                from={ranges[r.key][0]}
                to={ranges[r.key][1]}
                defaultOpen={r.key === 'vac' || r.key === 'sal'}
                onChange={(from, to) => change({ [`${r.key}_from`]: from == null ? null : String(from), [`${r.key}_to`]: to == null ? null : String(to) })}
              />
            ))}
          </FilterSection>
        </aside>
        <div className="cat-results">
          <div className="cat-head">
            <label className="search">
              <span className="sr">Пошук</span>
              <Icon name="search" />
              <input className="input" value={query} onChange={(e) => change({ q: e.target.value })} placeholder="Назва, місто або ІПН" />
            </label>
            <div className="select">
              <label className="sr" htmlFor="catSort">Сортування</label>
              <select className="input" id="catSort" value={sort} onChange={(e) => update({ sort: e.target.value === 'vacancies' ? null : e.target.value })}>
                {Object.entries(SORTS).map(([k, s]) => (
                  <option key={k} value={k}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <ActiveChips chips={chips} onReset={reset} />
          <div className="cat-count-row">
            <p className="cat-count">
              {fmt(list.length)} {plural(list.length, 'роботодавець', 'роботодавці', 'роботодавців')}
            </p>
            <ExportButtons
              options={[
                { label: 'CSV', onClick: () => downloadText('companies_selection.csv', toCsv(list.map(exportRow), [...EXPORT_COLUMNS]), 'text/csv;charset=utf-8') },
                { label: 'JSON', onClick: () => downloadText('companies_selection.json', toJson(list.map(exportRow), [...EXPORT_COLUMNS]), 'application/json') },
              ]}
            />
          </div>
          <div className="cat-grid">
            {list.length === 0 ? (
              <div className="empty" style={{ gridColumn: '1 / -1' }}>
                <h4>Нічого не знайдено</h4>
                <p>Прибери частину фільтрів або зміни регіон.</p>
              </div>
            ) : (
              list.slice(0, shown).map((e) => (
                <Link key={e.id} className="co-card" to={`/companies/${e.id}`}>
                  <CompanyTile size={56} logo={e.logo_url} name={e.name} />
                  <div>
                    <h3>{e.name}</h3>
                    <p className="place"><Icon name="pin" />{[e.locality, e.region].filter(Boolean).join(', ') || 'Місто не вказано'}</p>
                    <dl className="stats">
                      <div><dt>{shownVacancies(e).label}</dt><dd>{fmt(shownVacancies(e).value)}</dd></div>
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
