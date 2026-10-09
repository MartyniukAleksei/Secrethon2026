import { useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { ApiExportCatalog, ApiExportDataset, ExportCoverage, ExportFormat } from '../api/types'
import { useApi } from '../data/useApi'
import { fmt, longDate } from '../domain/format'
import { Icon } from '../ui/Icon'
import './OpenDataPage.css'

const FORMAT_LABELS: Record<ExportFormat, string> = { csv: 'CSV', json: 'JSON', jsonl: 'JSONL', parquet: 'Parquet' }

const TYPE_LABELS: Record<string, string> = {
  int: 'ціле',
  float: 'число',
  text: 'текст',
  bool: 'так/ні',
  date: 'дата',
  timestamp: 'дата й час',
  'text[]': 'список',
}

const COVERAGES: ExportCoverage[] = ['site', 'vpk', 'all']

/** Who each coverage is for, shown under its title. */
const COVERAGE_FOR: Record<ExportCoverage, string> = {
  site: 'Щоб відтворити сайт або перевірити його цифри.',
  vpk: 'Для аналітики ВПК: зокрема заводи, які зараз не публікують вакансій.',
  all: 'Для власної класифікації: все, що ми зібрали, з нашими мітками.',
}

/** Columns that only mark duplicates; empty in a set without them. */
const DUPLICATE_COLUMNS = new Set(['duplicate_of', 'duplicate_method', 'duplicate_score', 'canonical_id'])

type Variant = { coverage: ExportCoverage; dedup: boolean }

/** The chosen coverage and duplicates mode, kept in the URL so a choice can be shared. */
function useVariant(): [Variant, (patch: Partial<Variant>) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('coverage')
  const variant: Variant = {
    coverage: COVERAGES.includes(raw as ExportCoverage) ? (raw as ExportCoverage) : 'site',
    dedup: params.get('dedup') !== 'false',
  }
  const update = (patch: Partial<Variant>) => {
    const next = { ...variant, ...patch }
    const q = new URLSearchParams()
    if (next.coverage !== 'site') q.set('coverage', next.coverage)
    if (!next.dedup) q.set('dedup', 'false')
    setParams(q, { replace: true })
  }
  return [variant, update]
}

export function OpenDataPage() {
  const [variant, setVariant] = useVariant()
  const catalog = useApi(`export-catalog:${variant.coverage}:${variant.dedup}`, (signal) => api.exportCatalog(variant, signal))
  const data = catalog.status === 'ready' ? catalog.data : catalog.status === 'loading' ? catalog.stale : undefined
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Відкриті дані</h1>
          <p>Усі дані платформи у структурованому вигляді: датасети зі словником полів, повний знімок і API. Оберіть, що саме завантажити.</p>
        </div>
      </div>
      {catalog.status === 'error' && (
        <div className="empty">
          <h4>Каталог недоступний</h4>
          <p>Не вдалося завантажити перелік датасетів. Спробуйте оновити сторінку.</p>
        </div>
      )}
      {!data && catalog.status === 'loading' && <div className="skeleton opendata-skeleton" />}
      {data && <Catalog catalog={data} variant={variant} setVariant={setVariant} loading={catalog.status === 'loading'} />}
    </>
  )
}

function Catalog({
  catalog,
  variant,
  setVariant,
  loading,
}: {
  catalog: ApiExportCatalog
  variant: Variant
  setVariant: (patch: Partial<Variant>) => void
  loading: boolean
}) {
  const coverage = catalog.coverages.find((c) => c.name === variant.coverage)
  return (
    <div className={`opendata${loading ? ' opendata-loading' : ''}`} aria-busy={loading}>
      <WhatYouGet catalog={catalog} />

      <section className="panel opendata-builder">
        <h3>Що завантажити</h3>
        <div className="opendata-step">Охоплення</div>
        <div className="opendata-options" role="radiogroup" aria-label="Охоплення">
          {catalog.coverages.map((c) => {
            const n = catalog.overview.coverages[c.name]
            return (
              <button
                key={c.name}
                type="button"
                role="radio"
                aria-checked={variant.coverage === c.name}
                className="opendata-option"
                onClick={() => setVariant({ coverage: c.name })}
              >
                <span className="opendata-option-title">{c.title}</span>
                <span className="opendata-option-counts">
                  {fmt(n.companies)} юросіб · {fmt(n.cards)} карток · {fmt(n.vacancies)} вакансій
                </span>
                <span className="opendata-option-for">{COVERAGE_FOR[c.name]}</span>
              </button>
            )
          })}
        </div>
        {coverage && <p className="opendata-hint">{coverage.description}</p>}

        <div className="opendata-step">Дублі</div>
        <div className="segmented" role="group" aria-label="Дублі">
          <button type="button" aria-pressed={variant.dedup} onClick={() => setVariant({ dedup: true })}>
            Без дублів
          </button>
          <button type="button" aria-pressed={!variant.dedup} onClick={() => setVariant({ dedup: false })}>
            З дублями (позначені)
          </button>
        </div>
        <p className="opendata-hint">
          {variant.dedup ? (
            <>Кожна вакансія і кожна юрособа — один раз, як на сайті. Профілі одного підприємства на різних сайтах вакансій склеєно в одну картку.</>
          ) : (
            <>
              Повтори вакансій (повторні публікації та та сама вакансія на іншому сайті) залишено з позначкою <code>duplicate_of</code> — посиланням на основну
              вакансію; дублі компаній — з <code>canonical_id</code>. Так можна перевірити нашу дедуплікацію або зробити власну.
            </>
          )}
        </p>

        <div className="opendata-snapshot">
          <p>
            Повний знімок цього набору станом на {catalog.as_of ? longDate(catalog.as_of) : '—'}: усі {catalog.datasets.length} датасетів у CSV і Parquet,
            SQL-скрипт для PostgreSQL, словник полів (<code>schema.json</code>), <code>README.md</code> і <code>manifest.json</code> з кількістю рядків і
            контрольними сумами SHA-256.
            {variant.coverage !== 'site' && ' Знімок великого набору готується при першому запиті після оновлення даних — це може тривати кілька хвилин.'}
          </p>
          <div className="opendata-actions">
            <a className="btn btn-primary" href={catalog.snapshot.zip} download>
              <Icon name="download" />
              Знімок ZIP
            </a>
            <a className="btn btn-secondary" href={catalog.snapshot.sql} download>
              SQL
            </a>
          </div>
        </div>
      </section>

      <h2 className="opendata-title">Датасети цього набору</h2>
      {catalog.datasets.map((d) => (
        <DatasetCard key={d.name} dataset={d} formats={catalog.formats} dedup={variant.dedup} />
      ))}

      <ApiGuide catalog={catalog} />
    </div>
  )
}

/** Why the database is bigger than the site, and what deduplication removes. */
function WhatYouGet({ catalog }: { catalog: ApiExportCatalog }) {
  const { coverages: c, dedup: d } = catalog.overview
  return (
    <section className="panel opendata-overview">
      <h3>Що ви отримуєте</h3>
      <div className="opendata-funnel">
        <div>
          <strong>{fmt(c.all.companies)}</strong>
          <span>юросіб у базі</span>
        </div>
        <Icon name="chev" />
        <div>
          <strong>{fmt(c.vpk.companies)}</strong>
          <span>з них ВПК</span>
        </div>
        <Icon name="chev" />
        <div>
          <strong>{fmt(c.site.companies)}</strong>
          <span>показано на сайті</span>
        </div>
      </div>
      <p>
        База більша за сайт, бо в ній є всі компанії порталу ГУР «Війна та санкції», зокрема цивільні під санкціями та іноземні, і юрособи всіх роботодавців,
        яких ми перевіряли, щоб знайти підприємства ВПК. На сайті — лише юрособи, чиї вакансії ми показуємо: {fmt(c.site.cards)} карток підприємств і{' '}
        {fmt(c.site.vacancies)} вакансій.
      </p>
      <p className="opendata-dedup">
        Дублі: з {fmt(d.vacancies_raw)} активних вакансій прибрано {fmt(d.vacancies_raw - d.vacancies_unique)} повторів ({fmt(d.reposts)} повторних публікацій
        на тому самому сайті, {fmt(d.cross_source)} — та сама вакансія на іншому сайті); {fmt(d.site_profiles)} профілів роботодавців на сайтах вакансій склеєно
        в {fmt(d.site_cards)} карток підприємств (філії — окремо); дублів компаній — {fmt(d.company_duplicates)}. <a href="/methodology">Як ми рахуємо</a>
      </p>
    </section>
  )
}

function DatasetCard({ dataset: d, formats, dedup }: { dataset: ApiExportDataset; formats: ExportFormat[]; dedup: boolean }) {
  const columns = dedup ? d.columns.filter((c) => !DUPLICATE_COLUMNS.has(c.name)) : d.columns
  return (
    <section className="panel opendata-card">
      <div className="opendata-card-head">
        <div>
          <h3>
            {d.title} <code>{d.name}</code>
          </h3>
          <p>{d.description}</p>
          <p className="opendata-meta">
            <strong>{fmt(d.row_count)}</strong> рядків · один рядок — {d.row} · {d.columns.length} полів · ключ:{' '}
            {d.key.map((k) => (
              <code key={k}>{k}</code>
            ))}
          </p>
        </div>
        <div className="opendata-actions">
          {formats.map((f) => (
            <a key={f} className="btn btn-secondary btn-sm" href={d.urls[f]} download>
              {FORMAT_LABELS[f]}
            </a>
          ))}
        </div>
      </div>
      <details>
        <summary>Словник полів</summary>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Поле</th>
                <th>Тип</th>
                <th>Опис</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.name}>
                  <td>
                    <code>{c.name}</code>
                  </td>
                  <td>{TYPE_LABELS[c.type] ?? c.type}</td>
                  <td className="opendata-desc">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {columns.length < d.columns.length && (
          <p className="opendata-meta">Поля позначення дублів у файлі є, але порожні; вони заповнені в наборі «З дублями».</p>
        )}
      </details>
    </section>
  )
}

function ApiGuide({ catalog }: { catalog: ApiExportCatalog }) {
  const origin = window.location.origin
  return (
    <section className="panel opendata-guide">
      <h3>API</h3>
      <p>
        Ті самі дані доступні програмно. Інтерактивна документація всіх ендпойнтів:{' '}
        <a href="/docs" target="_blank" rel="noreferrer">
          /docs
        </a>
        . Якщо сайт захищено паролем, передайте ті самі логін і пароль (HTTP Basic Auth).
      </p>
      <ul>
        <li>
          <code>GET /api/export</code>: каталог датасетів набору, кількість рядків, дата зрізу і зведення за всіма охопленнями.
        </li>
        <li>
          <code>GET /api/export/{'{dataset}'}/schema</code>: словник полів датасету.
        </li>
        <li>
          <code>GET /api/export/{'{dataset}'}.{'{format}'}</code>: файл у форматі {catalog.formats.join(', ')}.
        </li>
        <li>
          <code>GET /api/export/snapshot.zip</code> і <code>snapshot.sql</code>: повний знімок набору.
        </li>
      </ul>
      <p>
        Усі ці адреси приймають <code>coverage</code> (<code>site</code> — як на сайті, типово; <code>vpk</code> — усі підприємства ВПК; <code>all</code> —
        уся база) і <code>dedup</code> (типово <code>true</code>; <code>false</code> — з дублями, позначеними <code>duplicate_of</code> /{' '}
        <code>canonical_id</code>). Датасет <code>vacancies</code> додатково приймає фільтри списку вакансій: <code>scope</code> (vpk, agency, all),{' '}
        <code>level</code> (confirmed, likely, all), <code>markers</code>, <code>focus</code>, <code>region_id</code>, <code>employer_id</code>,{' '}
        <code>q</code>, <code>days</code> та інші.
      </p>
      <pre>
        <code>{`curl -u логін:пароль -o vacancies.csv \\
  "${origin}/api/export/vacancies.csv?coverage=vpk&days=30"`}</code>
      </pre>
      <pre>
        <code>{`import pandas as pd, requests, io

auth = ("логін", "пароль")
base = "${origin}/api/export"
get = lambda name, q="": io.BytesIO(requests.get(f"{base}/{name}.parquet{q}", auth=auth).content)

# уся база з нашими мітками: відбираємо ВПК самі
companies = pd.read_parquet(get("companies", "?coverage=all"))
vpk = companies[companies.vpk_category == "vpk"]

# картки сайту та їхні вакансії
employers = pd.read_parquet(get("employers"))
vacancies = pd.read_parquet(get("vacancies"))
vacancies.merge(employers, on="employer_id")`}</code>
      </pre>
      <p>
        Зв'язки: <code>companies.company_id</code> є ключем для <code>company_sanctions</code>, <code>company_relations</code> (обидва кінці;{' '}
        <code>both_in_dataset</code> показує, чи є в наборі обидві компанії), <code>company_products</code>, <code>company_sources</code>,{' '}
        <code>employers.matched_company_id</code> і <code>employer_profiles.company_id</code>; <code>employers.employer_id</code> — для{' '}
        <code>vacancies.employer_id</code> і <code>employer_profiles.card_id</code>.
      </p>
    </section>
  )
}
