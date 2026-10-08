import { api } from '../api/client'
import type { ApiExportCatalog, ApiExportDataset, ExportFormat } from '../api/types'
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

export function OpenDataPage() {
  const catalog = useApi('export-catalog', api.exportCatalog)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Відкриті дані</h1>
          <p>Усі дані платформи у структурованому вигляді: окремі датасети зі словником полів, повний знімок і API.</p>
        </div>
      </div>
      {catalog.status === 'loading' && <div className="skeleton opendata-skeleton" />}
      {catalog.status === 'error' && (
        <div className="empty">
          <h4>Каталог недоступний</h4>
          <p>Не вдалося завантажити перелік датасетів. Спробуйте оновити сторінку.</p>
        </div>
      )}
      {catalog.status === 'ready' && <Catalog catalog={catalog.data} />}
    </>
  )
}

function Catalog({ catalog }: { catalog: ApiExportCatalog }) {
  return (
    <div className="opendata">
      <section className="panel opendata-snapshot">
        <div>
          <h3>Повний знімок</h3>
          <p>
            Усі {catalog.datasets.length} датасетів станом на {catalog.as_of ? longDate(catalog.as_of) : '—'}: CSV і Parquet, SQL-скрипт для
            PostgreSQL, словник полів (<code>schema.json</code>) і <code>manifest.json</code> з кількістю рядків і контрольними сумами SHA-256.
          </p>
        </div>
        <div className="opendata-actions">
          <a className="btn btn-primary" href={catalog.snapshot.zip} download>
            <Icon name="download" />
            Знімок ZIP
          </a>
          <a className="btn btn-secondary" href={catalog.snapshot.sql} download>
            SQL
          </a>
        </div>
      </section>

      <h2 className="opendata-title">Датасети</h2>
      {catalog.datasets.map((d) => (
        <DatasetCard key={d.name} dataset={d} formats={catalog.formats} />
      ))}

      <ApiGuide catalog={catalog} />
    </div>
  )
}

function DatasetCard({ dataset: d, formats }: { dataset: ApiExportDataset; formats: ExportFormat[] }) {
  return (
    <section className="panel opendata-card">
      <div className="opendata-card-head">
        <div>
          <h3>
            {d.title} <code>{d.name}</code>
          </h3>
          <p>{d.description}</p>
          <p className="opendata-meta">
            {fmt(d.row_count)} рядків · {d.columns.length} полів · ключ: {d.key.map((k) => <code key={k}>{k}</code>)}
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
              {d.columns.map((c) => (
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
          <code>GET /api/export</code>: каталог датасетів, кількість рядків і дата зрізу.
        </li>
        <li>
          <code>GET /api/export/{'{dataset}'}/schema</code>: словник полів датасету.
        </li>
        <li>
          <code>GET /api/export/{'{dataset}'}.{'{format}'}</code>: файл у форматі {catalog.formats.join(', ')}.
        </li>
        <li>
          <code>GET /api/export/snapshot.zip</code> і <code>snapshot.sql</code>: повний знімок.
        </li>
      </ul>
      <p>
        Датасет <code>vacancies</code> приймає ті самі фільтри, що й список вакансій: <code>level</code> (vpk, confirmed, likely, all),{' '}
        <code>region_id</code>, <code>category</code>, <code>employer_id</code>, <code>q</code>, <code>days</code>.
      </p>
      <pre>
        <code>{`curl -u логін:пароль -o vacancies.csv \\
  "${origin}/api/export/vacancies.csv?level=vpk&days=30"`}</code>
      </pre>
      <pre>
        <code>{`import pandas as pd, requests, io

auth = ("логін", "пароль")
base = "${origin}/api/export"
get = lambda name: io.BytesIO(requests.get(f"{base}/{name}.parquet", auth=auth).content)

companies = pd.read_parquet(get("companies"))
sanctions = pd.read_parquet(get("company_sanctions"))
employers = pd.read_parquet(get("employers"))

# Санкції компаній, з якими зіставлено роботодавців
employers.merge(sanctions, left_on="matched_company_id", right_on="company_id")`}</code>
      </pre>
      <p>
        Зв'язки: <code>companies.company_id</code> є ключем для <code>company_sanctions</code>, <code>company_relations</code>,{' '}
        <code>company_products</code>, <code>company_sources</code> і <code>employers.matched_company_id</code>;{' '}
        <code>employers.employer_id</code> є ключем для <code>vacancies.employer_id</code>.
      </p>
    </section>
  )
}
