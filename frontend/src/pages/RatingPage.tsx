import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import type { ApiRatingMeta, ApiRatingParams, ApiRatingRow, ApiRatingUnit, FocusKey, RatingTier } from '../api/types'
import { FinanceBlock, HiddenAccountsBadge } from '../components/rating/Finance'
import { FocusDot, FocusLegend, FocusStack, IMPORTANCE_DEFINITION, RankInterval, RatingBreakdown, TierBadge } from '../components/rating/RatingParts'
import { SupplyChainList } from '../components/rating/SupplyChain'
import { useApi } from '../data/useApi'
import { dec, fmt, longDate, pct, plural } from '../domain/format'
import { domainName, RATING_FOCUSES, TIERS, WEAPON_FOCUS } from '../domain/labels'
import { useUrlFilters } from '../hooks/useUrlFilters'
import { Icon } from '../ui/Icon'
import './RatingPage.css'

const PAGE = 100

const TABS = [
  ['companies', 'Підприємства'],
  ['domains', 'Галузі'],
  ['regions', 'Регіони'],
  ['holdings', 'Холдинги'],
  ['systems', 'Системи та ваги'],
  ['checks', 'Перевірка'],
  ['weak', 'Слабкі місця'],
  ['method', 'Методика'],
] as const
type Tab = (typeof TABS)[number][0]

const SORTS: Record<string, string> = { '': 'Загальний бал', drone: 'Внесок БпЛА', missile: 'Внесок ракет', kab: 'Внесок КАБ' }
const isFocus = (v: string | null): v is FocusKey => v === 'drone' || v === 'missile' || v === 'kab'
const isTier = (v: string | null): v is RatingTier => v === 'bom' || v === 'evidence' || v === 'peer'

export function RatingPage() {
  const { params, update } = useUrlFilters()
  const tab = (TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'companies') as Tab
  const meta = useApi('rating-meta', (s) => api.ratingMeta(s))
  const data = meta.status === 'ready' ? meta.data : undefined
  const p = data?.params
  const setTab = (id: Tab) => update({ tab: id === 'companies' ? null : id })
  /** A click on an industry or a region opens the companies filtered by it. */
  const openCompanies = (patch: Record<string, string>) => update({ tab: null, company: null, ...patch })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Рейтинг важливості</h1>
          <p>{IMPORTANCE_DEFINITION}</p>
          {data && (
            <p className="src rt-run">
              Прогін {data.run.version} від {longDate(data.run.started_at)}{p?.runs ? `, Монте-Карло: ${fmt(p.runs)} прогонів` : ''}
            </p>
          )}
        </div>
      </div>
      {meta.status === 'error' ? (
        <div className="empty"><h4>Рейтинг ще не пораховано</h4><p>У базі немає прогону рейтингу важливості.</p></div>
      ) : (
        <>
          <Kpis params={p} />
          <div className="tabs rt-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'companies' && <Companies ranked={p?.counts?.ranked} />}
          {tab === 'domains' && (
            <Units kind="domain" title="Галузь" onPick={(unit) => openCompanies({ domain: unit })}
              note="Важливість галузі — та сама формула для всіх її підприємств як одного постачальника: частки однієї деталі складаються, потім береться вузьке місце. Враховано підприємства зі зв’язками постачання." />
          )}
          {tab === 'regions' && (
            <Units kind="region" title="Регіон" onPick={(unit) => openCompanies({ region: unit })}
              note="Внесок підприємства ділиться порівну між регіонами його майданчиків (юридична адреса і філії за реєстром), а не лише за юрадресою." />
          )}
          {tab === 'holdings' && (
            <Units kind="holding" title="Холдинг"
              note="Головний холдинг (ОАК, КТРВ, Алмаз-Антей) у загальному списку не отримує балу як «головний виробник» — він переданий заводам, а тут видно весь холдинг." />
          )}
          {tab === 'systems' && (p ? <Systems params={p} /> : <div className="skeleton rt-skeleton" />)}
          {tab === 'checks' && (data ? <Checks meta={data} /> : <div className="skeleton rt-skeleton" />)}
          {tab === 'weak' && (p ? <Weaknesses params={p} /> : <div className="skeleton rt-skeleton" />)}
          {tab === 'method' && (p ? <Method params={p} /> : <div className="skeleton rt-skeleton" />)}
        </>
      )}
    </>
  )
}

function Kpis({ params: p }: { params: ApiRatingParams | undefined }) {
  const ours = p?.checks?.recall?.['Наш рейтинг']
  const tiles: [string, string, string?][] = p
    ? [
      ['Підприємств у рейтингу', fmt(p.counts?.ranked ?? 0)],
      ['За специфікаціями ГУР', fmt(p.counts?.bom ?? 0)],
      ['За знайденими зв’язками', fmt(p.counts?.evidence ?? 0)],
      ['За аналогами', fmt(p.counts?.peer ?? 0)],
      ['Кореляція з датою санкцій', p.validation?.spearman_sanction_date != null ? dec(p.validation.spearman_sanction_date, 2) : '—',
        'Спірмен між місцем у рейтингу і датою перших санкцій: від’ємна — важливіші потрапили під санкції раніше'],
      ['Ключових за зовнішніми джерелами в топ-100', ours ? `${ours.top100}/${ours.n}` : '—',
        'Скільки підприємств, які незалежні джерела називають ключовими виробниками, увійшли до першої сотні'],
    ]
    : []
  return (
    <div className="rt-kpis">
      {p ? tiles.map(([label, value, hint]) => (
        <div key={label} className="kpi-tile" title={hint}>
          <span className="k-label">{label}</span>
          <span className="k-value">{value}</span>
        </div>
      )) : Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton rt-kpi-skeleton" />)}
    </div>
  )
}

/* ---------- Підприємства ---------- */

function Companies({ ranked }: { ranked: number | undefined }) {
  const { params, update } = useUrlFilters()
  const focus = isFocus(params.get('sort')) ? (params.get('sort') as FocusKey) : undefined
  const tier = isTier(params.get('tier')) ? (params.get('tier') as RatingTier) : undefined
  const domain = params.get('domain') ?? undefined
  const region = params.get('region') ?? undefined
  const q = params.get('q') ?? ''
  const company = Number(params.get('company')) || undefined
  const [text, setText] = useState(q)
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState<Set<number>>(() => new Set(company ? [company] : []))
  const filterKey = JSON.stringify([focus, tier, domain, region, q])
  const [lastKey, setLastKey] = useState(filterKey)
  if (lastKey !== filterKey) {
    setLastKey(filterKey)
    setShown(PAGE)
  }

  // Typing updates the URL (and the request) after a pause.
  useEffect(() => {
    if (text === q) return
    const t = setTimeout(() => update({ q: text.trim() || null, company: null }), 300)
    return () => clearTimeout(t)
    // `update` is recreated every render; the text and the URL value are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, q])

  // A link «Як порахували» opens the list on the company's row: load enough rows to reach it.
  const target = useApi(`rating-detail:${company ?? 0}`, (s) => (company ? api.ratingDetail(company, s) : Promise.resolve(null)))
  const targetRank = target.status === 'ready' ? target.data?.rating.rank : undefined
  const filtered = !!(focus || tier || domain || region || q)
  const need = company && targetRank && !filtered ? Math.ceil(targetRank / PAGE) * PAGE : 0
  const limit = Math.max(shown, need)

  const list = useApi(`rating:${filterKey}:${limit}`, (s) => api.rating({ focus, tier, domain, region, q: q || undefined, limit }, s))
  const result = list.status === 'ready' ? list.data : list.stale
  const items = useMemo(() => result?.items ?? [], [result])
  const first = items[0]
  const scale = first ? (focus ? first.score_by_focus[focus] ?? 0 : first.score) : 1
  const n = ranked ?? result?.total ?? 1

  const scrolled = useRef(false)
  useEffect(() => {
    if (!company || scrolled.current || !items.some((r) => r.company_id === company)) return
    scrolled.current = true
    document.getElementById(`rt-row-${company}`)?.scrollIntoView({ block: 'center' })
  }, [company, items])

  const toggle = (id: number) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const facets = result?.facets
  const set = (patch: Record<string, string | null>) => update({ ...patch, company: null })

  return (
    <section className="panel rt-companies">
      <div className="filter-bar rt-filters">
        <label className="search rt-search">
          <span className="sr">Пошук</span>
          <Icon name="search" />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Назва або ІПН" />
        </label>
        <Select label="Сортувати за" value={focus ?? ''} onChange={(v) => set({ sort: v || null })}
          options={Object.entries(SORTS)} />
        <Select label="Докази" value={tier ?? ''} onChange={(v) => set({ tier: v || null })}
          options={[['', 'Усі докази'], ...Object.entries(TIERS)]} />
        <Select label="Галузь" value={domain ?? ''} onChange={(v) => set({ domain: v || null })}
          options={[['', 'Усі галузі'], ...(facets?.domains ?? (domain ? [domain] : [])).map((d): [string, string] => [d, domainName(d)])]} />
        <Select label="Регіон" value={region ?? ''} onChange={(v) => set({ region: v || null })}
          options={[['', 'Усі регіони'], ...(facets?.regions ?? (region ? [region] : [])).map((r): [string, string] => [r, r])]} />
      </div>
      <div className="rt-count-row">
        <p className="cat-count">
          {result ? `${fmt(result.total)} ${plural(result.total, 'підприємство', 'підприємства', 'підприємств')}` : 'Завантаження…'}
          {focus && ` з внеском у категорію «${WEAPON_FOCUS[focus]}»`}
        </p>
        <FocusLegend />
      </div>
      {list.status === 'error' ? (
        <p className="empty-row">Не вдалося завантажити рейтинг.</p>
      ) : result && items.length === 0 ? (
        <div className="empty"><h4>Нічого не знайдено</h4><p>Зміни пошук або прибери частину фільтрів.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data rt-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Підприємство</th>
                <th className="num">{focus ? `Внесок ${WEAPON_FOCUS[focus]}` : 'Бал'}</th>
                <th>Склад</th>
                <th className="rt-col-ci" title="Ранг у 90% прогонів Монте-Карло, логарифмічна шкала">Інтервал рангу</th>
                <th>Докази</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <Fragment key={r.company_id}>
                  <Row row={r} focus={focus} scale={scale} n={n} open={open.has(r.company_id)} onToggle={() => toggle(r.company_id)} />
                  {open.has(r.company_id) && (
                    <tr className="rt-detail-row"><td colSpan={6}><RowDetail row={r} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && items.length < result.total && (
        <div className="pager">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShown(limit + PAGE)} disabled={list.status === 'loading'}>
            Показати ще {fmt(Math.min(PAGE, result.total - items.length))}
          </button>
          <span>{fmt(items.length)} з {fmt(result.total)}</span>
        </div>
      )}
    </section>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="select">
      <span className="sr">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} title={label}>
        {options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  )
}

function Row({ row: r, focus, scale, n, open, onToggle }: { row: ApiRatingRow; focus?: FocusKey; scale: number; n: number; open: boolean; onToggle: () => void }) {
  const value = focus ? r.score_by_focus[focus] ?? 0 : r.score
  return (
    <tr id={`rt-row-${r.company_id}`} className={`clickable${open ? ' rt-open' : ''}`} onClick={onToggle} aria-expanded={open}>
      <td className="num rt-rank">{fmt(r.position)}{focus && <span className="src" title="Місце за загальним балом"> ({fmt(r.rank)})</span>}</td>
      <td className="rt-name">
        <Link to={r.url} onClick={(e) => e.stopPropagation()}>{r.name ?? `Юрособа ${r.company_id}`}</Link>
        <span className="sm2">
          {[r.direction_label ?? (r.direction_domain ? domainName(r.direction_domain) : null), ...r.regions.slice(0, 2)].filter(Boolean).join(' · ')}
          {r.regions.length > 2 && ` +${r.regions.length - 2}`}
          {' '}<HiddenAccountsBadge status={r.disclosure} />
        </span>
      </td>
      <td className="num rt-score">{dec(value, 4)}</td>
      <td className="rt-col-stack"><FocusStack score={r.score} byFocus={r.score_by_focus} scale={scale} peer={r.tier === 'peer'} only={focus} /></td>
      <td className="rt-col-ci"><RankInterval lo={r.rank_lo} med={r.rank_med} hi={r.rank_hi} n={n} /></td>
      <td><TierBadge tier={r.tier} /></td>
    </tr>
  )
}

/** The opened row: why the score, the first supply links and the accounts. */
function RowDetail({ row }: { row: ApiRatingRow }) {
  const detail = useApi(`rating-detail:${row.company_id}`, (s) => api.ratingDetail(row.company_id, s))
  if (detail.status === 'loading') return <div className="skeleton rt-detail-skeleton" />
  if (detail.status === 'error') return <p className="empty-row">Не вдалося завантажити розклад балу.</p>
  const d = detail.data
  return (
    <div className="rt-detail">
      <p className="src rt-detail-meta">
        Місце {fmt(d.rating.rank)}
        {d.rating.rank_med != null && `, медіана Монте-Карло ${fmt(d.rating.rank_med)}`}
        {d.rating.rank_lo != null && d.rating.rank_hi != null && ` (90%: ${fmt(d.rating.rank_lo)}–${fmt(d.rating.rank_hi)})`}
        {d.rating.p_vpk != null && ` · P(ВПК) ${pct(d.rating.p_vpk)}`}
      </p>
      <h4>Чому такий бал</h4>
      <RatingBreakdown rating={d.rating} />
      <div className="rt-detail-cols">
        <div className="card">
          <h4>Ланцюг постачання</h4>
          <SupplyChainList chain={d.supply_chain} limit={5} />
        </div>
        <div className="card">
          <h4>Фінанси</h4>
          <FinanceBlock finance={d.finance} compact />
        </div>
      </div>
      <Link className="btn btn-secondary btn-sm" to={d.url}>Відкрити підприємство</Link>
    </div>
  )
}

/* ---------- Галузі, регіони, холдинги ---------- */

function Units({ kind, title, note, onPick }: { kind: 'domain' | 'region' | 'holding'; title: string; note: string; onPick?: (unit: string) => void }) {
  const units = useApi(`rating-units:${kind}`, (s) => api.ratingUnits(kind, s))
  const rows: ApiRatingUnit[] = units.status === 'ready' ? units.data : []
  const scale = rows[0]?.score ?? 1
  return (
    <section className="panel">
      <div className="panel-head"><div><p>{note}</p></div><FocusLegend peer={false} /></div>
      {units.status === 'loading' ? <div className="skeleton rt-skeleton" /> : units.status === 'error' ? (
        <p className="empty-row">Не вдалося завантажити.</p>
      ) : rows.length === 0 ? <p className="empty-row">Немає даних.</p> : (
        <div className="table-wrap">
          <table className="data rt-units">
            <thead>
              <tr>
                <th>{title}</th>
                <th className="num">Важливість</th>
                <th>БпЛА / ракети / КАБ</th>
                <th className="num" title="Концентрація: 1 — галузь тримається на одному підприємстві">HHI</th>
                <th className="num">Підприємств</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.unit} className={onPick ? 'clickable' : undefined} onClick={onPick ? () => onPick(u.unit) : undefined}>
                  <td className="rt-wrap"><b>{kind === 'domain' ? domainName(u.unit) : u.unit}</b></td>
                  <td className="num">{dec(u.score, 3)}</td>
                  <td className="rt-col-stack"><FocusStack score={u.score} byFocus={u.score_by_focus} scale={scale} /></td>
                  <td className="num" title="Концентрація: 1 — галузь тримається на одному підприємстві">{u.hhi != null ? dec(u.hhi, 2) : '—'}</td>
                  <td className="num">{u.members != null ? fmt(u.members) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ---------- Системи та ваги ---------- */

const SEGMENTS: Record<string, string> = { long_range: 'далекі', frontline: 'фронтові' }

function Systems({ params: p }: { params: ApiRatingParams }) {
  const all = p.systems ?? []
  const names = new Map(all.map((s) => [s.system, s.name]))
  const carriers = (list: (string | null)[] | null) => {
    if (!list?.length) return '—'
    const known = [...new Set(list.filter((c): c is string => !!c).map((c) => names.get(c) ?? c))]
    const unknown = list.filter((c) => !c).length
    return [...known, unknown ? `${unknown} без специфікації` : null].filter(Boolean).join(', ')
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p>
            Кожна категорія — ⅓. Ракети й далекі дрони — за пусками за 12 місяців (зведення Повітряних сил), фронтові дрони — порівну на половину
            ваги БпЛА, КАБ — порівну. «Невідомі БпЛА» і KN-23 — пуски, яких не можна приписати російському підприємству.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data rt-systems-weights">
          <thead>
            <tr>
              <th>Система</th><th>Категорія</th><th className="num">Вага в категорії</th><th className="num">Деталей</th>
              <th className="num">З виробником</th><th className="num">Кооперація</th><th>Носії</th>
            </tr>
          </thead>
          <tbody>
            {RATING_FOCUSES.flatMap((f) => all.filter((s) => s.focus === f).sort((a, b) => b.weight - a.weight)).map((s) => (
              <tr key={s.system}>
                <td className="rt-wrap"><FocusDot focus={s.focus} /> {s.name}</td>
                <td>{WEAPON_FOCUS[s.focus] ?? s.focus}{s.segment ? `, ${SEGMENTS[s.segment] ?? s.segment}` : ''}</td>
                <td className="num">{dec(s.weight * 100, 1)}%</td>
                <td className="num">{fmt(s.parts)}</td>
                <td className="num">{fmt(s.parts_with_maker)}</td>
                <td className="num">{fmt(s.coop)}</td>
                <td className="rt-wrap src">{carriers(s.carriers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---------- Перевірка ---------- */

/** Reference rankings of the check, in this order; keys as the pipeline writes them. */
const RECALL_ROWS: [string, string][] = [
  ['Наш рейтинг', 'Наш рейтинг'],
  ['Число систем ГУР', 'Число систем ГУР'],
  ['Число вакансий', 'Число вакансій'],
  ['Выручка (ГИР БО)', 'Виручка (ГІР БО)'],
]
const JUDGE_SOURCES: Record<string, string> = { exa: 'відкриті джерела (Exa)', gur_description: 'опис ГУР', gur: 'специфікації ГУР', facts: 'перевірені факти', vacancy: 'вакансії' }

function Checks({ meta }: { meta: ApiRatingMeta }) {
  const p = meta.params
  const c = p.checks ?? {}
  const recall = c.recall ?? {}
  const rows = [...RECALL_ROWS.filter(([k]) => recall[k]), ...Object.keys(recall).filter((k) => !RECALL_ROWS.some(([r]) => r === k)).map((k): [string, string] => [k, k])]
  const urlOf = (id: number | null) => (id != null ? meta.urls[String(id)] : undefined)
  const judge = Object.entries(c.judge_supply ?? {})
  const precision = Object.entries(p.link_precision ?? {})
  return (
    <div className="rt-stack-panels">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Зовнішній еталон</h3>
            <p>Скільки підприємств, яких незалежні джерела (санкційні обґрунтування, розслідування) називають ключовими виробниками, потрапляють у верх рейтингу — порівняно з наївними рейтингами.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Рейтинг</th><th className="num">У топ-50</th><th className="num">У топ-100</th><th className="num">У топ-200</th><th className="num">Спірмен з датою санкцій</th></tr>
            </thead>
            <tbody>
              {rows.map(([key, label]) => {
                const r = recall[key]
                return (
                  <tr key={key} className={key === 'Наш рейтинг' ? 'rt-ours' : undefined}>
                    <td>{label}</td>
                    <td className="num">{r.top50}/{r.n}</td>
                    <td className="num">{r.top100}/{r.n}</td>
                    <td className="num">{r.top200}/{r.n}</td>
                    <td className="num">{r.spearman_sanctions != null ? dec(r.spearman_sanctions, 2) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {c.external?.length ? (
          <details className="rt-details">
            <summary>Джерела еталону ({fmt(c.external.length)})</summary>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Підприємство</th><th>Роль</th><th>Джерело</th></tr></thead>
                <tbody>
                  {c.external.map((x, i) => {
                    const url = urlOf(x.company_id)
                    return (
                      <tr key={i} className={x.independent ? undefined : 'rt-muted'}>
                        <td className="rt-wrap">
                          <FocusDot focus={x.focus} /> {url ? <Link to={url}>{x.company_ru}</Link> : x.company_ru}
                          {!x.independent && <span className="sm2">не враховано: джерело — сам портал ГУР</span>}
                        </td>
                        <td className="rt-wrap" lang="en">{x.role}{x.systems ? ` · ${x.systems}` : ''}</td>
                        <td className="rt-wrap" lang="en">{x.source_url ? <a href={x.source_url} target="_blank" rel="noreferrer noopener">{x.source}</a> : x.source}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      {c.anchors?.length ? (
        <section className="panel">
          <div className="panel-head"><div><h3>Орієнтири</h3><p>Відомі ключові заводи і де вони в рейтингу.</p></div></div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Орієнтир</th><th>Знайдене підприємство</th><th className="num">Місце</th><th>Чому так</th></tr></thead>
              <tbody>
                {c.anchors.map((a) => {
                  const url = urlOf(a.company_id)
                  return (
                    <tr key={a.anchor}>
                      <td>{a.anchor}</td>
                      <td className="rt-wrap">{a.name ? (url ? <Link to={url}>{a.name}</Link> : a.name) : '—'}</td>
                      <td className={`num ${a.rank != null && a.rank <= 50 ? 'rt-good' : 'rt-bad'}`}>{a.rank != null ? fmt(a.rank) : '—'}</td>
                      <td className="rt-wrap src" lang="ru">{p.anchor_notes?.[a.anchor] ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {p.sensitivity?.length ? (
        <section className="panel">
          <div className="panel-head"><div><h3>Чутливість</h3><p>Скільки підприємств основного топу залишаються в топі за іншого варіанта моделі.</p></div></div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Варіант</th><th className="num">Топ-20</th><th className="num">Топ-50</th><th className="num">Топ-100</th></tr></thead>
              <tbody>
                {p.sensitivity.map((s) => (
                  <tr key={s.variant}>
                    <td className="rt-wrap" lang="ru">{s.variant}</td>
                    <td className="num">{s.top20}/20</td><td className="num">{s.top50}/50</td><td className="num">{s.top100}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {(judge.length > 0 || precision.length > 0) && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Точність зв’язків</h3>
              <p>Інша модель (GPT) наосліп вирішує, чи підтверджує цитата зв’язок «підприємство → система»; розбіжності розібрано вручну — частина з них помилки самого судді.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Джерело зв’язку</th><th className="num">Суддя погодився</th><th className="num">Точність у формулі</th></tr></thead>
              <tbody>
                {[...new Set([...judge.map(([k]) => k), ...precision.map(([k]) => k)])].map((k) => {
                  const j = c.judge_supply?.[k]
                  const prec = p.link_precision?.[k]
                  return (
                    <tr key={k}>
                      <td>{JUDGE_SOURCES[k] ?? k}</td>
                      <td className="num">{j ? `${j.agree}/${j.n}` : '—'}</td>
                      <td className="num" title="Після ручного розбору розбіжностей; використовується у формулі">{prec != null ? pct(prec) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

/* ---------- Слабкі місця і методика ---------- */

function Weaknesses({ params: p }: { params: ApiRatingParams }) {
  const items = p.weaknesses ?? []
  if (!items.length) return <p className="empty-row">Слабких місць не описано.</p>
  return (
    <div className="rt-weak" lang="ru">
      {items.map((w) => (
        <article key={w.title} className="panel">
          <h3>{w.title}</h3>
          <p>{w.problem}</p>
          <p><b lang="uk">Вплив:</b> {w.impact}</p>
          <p><b lang="uk">Що зроблено / що робити:</b> {w.action}</p>
        </article>
      ))}
    </div>
  )
}

const FORMULA = `I(c)   = Σ_k ⅓ · Σ_{s∈k} u_s · D_s(c)                      k ∈ {БпЛА, ракети, КАБ}
D_s(c) = max( max_p w_p·π_c(p),  γ·Σ_носії D_нос(c)/n,  coop_s(c) )
π_c(p) = e_c(p)·m_c / (Σ_j m_j + α)                       частка c у постачанні деталі p
Оцінка за аналогами: I(c) = P(c) · E[D | роль] · поправка на пропуск · (m_c/m̄)^β`

function Method({ params: p }: { params: ApiRatingParams }) {
  const num = (v: number | undefined, d = 2) => (v != null ? dec(v, d) : '—')
  return (
    <div className="rt-stack-panels rt-method">
      <section className="panel">
        <h3>Формула</h3>
        <pre><code>{FORMULA}</code></pre>
        <ul>
          <li><b>u<sub>s</sub></b> — вага системи в категорії (вкладка «Системи та ваги»); кожна категорія — ⅓.</li>
          <li><b>D<sub>s</sub>(c)</b> — частка випуску системи, яка залежить від підприємства: вузьке місце серед деталей, які воно постачає.</li>
          <li><b>π<sub>c</sub>(p)</b> — частка підприємства в постачанні деталі: e — підтвердженість зв’язку, m — масштаб, α — невідомі постачальники.</li>
          <li><b>γ</b> — знижка для носіїв (Су-34/35/57): вони потрібні для пуску КАБ і ракет, але не входять у саму систему.</li>
          <li>Підприємства без зв’язків постачання оцінюються за аналогами: імовірність ролі за JEV × очікувана залежність для ролі.</li>
        </ul>
      </section>
      <section className="panel">
        <h3>Параметри прогону</h3>
        <dl className="rt-params">
          <div><dt>α — невідомі постачальники деталі</dt><dd>{num(p.alpha)}</dd></div>
          <div><dt>q — поправка на пропуск у даних</dt><dd>{num(p.q)}</dd></div>
          <div><dt>δ — вага головного розробника</dt><dd>{num(p.delta)}</dd></div>
          <div><dt>γ — знижка для носіїв</dt><dd>{num(p.gamma)}</dd></div>
          <div><dt>Частка фронтових дронів у вазі БпЛА</dt><dd>{p.frontline_share != null ? pct(p.frontline_share) : '—'}</dd></div>
          <div><dt>Прогонів Монте-Карло</dt><dd>{p.runs != null ? fmt(p.runs) : '—'}</dd></div>
        </dl>
        <h4>Діапазони Монте-Карло</h4>
        <p>α від α/2 до 2α, δ 0,15–0,5, γ 0,2–0,6; інтервал рангу — 5-й і 95-й процентилі місця.</p>
        {p.link_precision && (
          <>
            <h4>Точність зв’язку за джерелом (e)</h4>
            <p>{Object.entries(p.link_precision).map(([k, v]) => `${JUDGE_SOURCES[k] ?? k} — ${pct(v)}`).join('; ')}.</p>
          </>
        )}
        {p.p_levels && (
          <>
            <h4>P(ВПК) за класом і рівнем рішення</h4>
            <p>{Object.entries(p.p_levels).map(([k, v]) => `${k} — ${pct(v)}`).join('; ')}.</p>
          </>
        )}
        <p className="src">Як збирали й класифікували дані — на сторінці <Link to="/methodology">«Про дані»</Link>.</p>
      </section>
    </div>
  )
}
