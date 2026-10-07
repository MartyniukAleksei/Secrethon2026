import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { LineChart } from '../../charts/LineChart'
import type { AgentArtifact, AgentResponse, AgentSource } from './types'

const number = (value: number | null) => value == null ? 'Немає даних' : value.toLocaleString('uk-UA', { maximumFractionDigits: 0 })
const date = (value: string) => new Date(value).toLocaleDateString('uk-UA')
const kinds: Record<string, string> = { parent: 'Холдинг', supplier: 'Постачання', bank: 'Банк', related: 'Зв’язок', successor: 'Правонаступник' }

function SourceLink({ source, children }: { source: AgentSource; children?: ReactNode }) {
  if (source.url.startsWith('/')) return <Link to={source.url}>{children ?? source.title}</Link>
  return <a href={source.url} target="_blank" rel="noopener noreferrer">{children ?? source.title}</a>
}

function Artifact({ artifact }: { artifact: AgentArtifact }) {
  if (artifact.kind === 'relations') return <section className="ag-artifact">
    <b>{artifact.title}</b>
    <div className="ag-relations"><div className="ag-relation-center">{artifact.company}</div>
      {artifact.items.map((item, index) => <div className="ag-relation" key={index}>
        <span aria-hidden="true">{item.direction === 'out' ? '→' : '←'}</span>
        <div>{item.employer_id ? <Link to={`/companies/${item.employer_id}`}>{item.name}</Link> : item.name}<small>{kinds[item.kind] ?? item.kind}</small></div>
      </div>)}
    </div>
    {!artifact.items.length && <p>У базі немає записів про зв’язки.</p>}
  </section>
  if (artifact.kind === 'mentions') return <section className="ag-artifact">
    <b>{artifact.title}</b>
    <small>Пошук за {artifact.days} днів. Збіг підприємства потребує перевірки; охоплення соцмереж може бути неповним.</small>
    {artifact.items.map(item => <article className="ag-mention" key={item.url}>
      <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
      <small>{item.published_at ? date(item.published_at) : 'Дата публікації невідома'} · {new URL(item.url).hostname}</small>
      <p>{item.text}</p>
    </article>)}
    {!artifact.items.length && <p>Публічних згадок за цей період не знайдено.</p>}
  </section>
  const { rows, scope } = artifact
  const max = Math.max(1, ...rows.map(row => row.value ?? 0))
  const lineRows = rows.filter(row => row.id != null && row.value != null)
  return <section className="ag-artifact">
    <b>{artifact.title}</b>
    <small>{scope.days ? `За ${scope.days} днів до дати зрізу` : 'За весь доступний період'} · {artifact.unit}{scope.as_of && ` · зріз ${date(scope.as_of)}`}</small>
    {artifact.kind === 'table' ? <div className="ag-table-scroll"><table className="ag-table">
      <thead><tr><th>Назва</th><th>{artifact.unit}</th>{artifact.unit === 'RUB/місяць' && <th>Вибірка зарплат</th>}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}><td>{row.source_id && typeof row.id === 'number' ? <Link to={`/companies/${row.id}`}>{row.label}</Link> : row.label}</td><td>{number(row.value)}</td>{artifact.unit === 'RUB/місяць' && <td>{row.salary_samples}</td>}</tr>)}</tbody>
    </table></div> : artifact.kind === 'line' ? <>
      {!!lineRows.length && <LineChart months={lineRows.map(row => new Date(`${row.id}T00:00:00`))} series={[{ values: lineRows.map(row => row.value!), color: 'var(--accent-foreground)' }]} label={artifact.title} />}
      <small>Активні вакансії за місяцем публікації; місяці без даних не відображені.</small>
    </> : <div className="ag-bars">{rows.map((row, i) => <div key={i} className="ag-bar-row">
      <span>{row.label}</span><strong>{number(row.value)}</strong><div className="ag-bar-track"><div style={{ width: `${100 * (row.value ?? 0) / max}%` }} /></div>
    </div>)}</div>}
    {!rows.length && <p>За вибраними умовами даних немає.</p>}
  </section>
}

export function AgentAnswer({ response }: { response: AgentResponse }) {
  const sources = new Map(response.sources.map(source => [source.id, source]))
  return <>
    <div className="ag-answer-text">{response.text.split(/(\[s\d+\])/g).map((part, index) => {
      const source = sources.get(part.slice(1, -1))
      return source ? <SourceLink key={index} source={source}>{part}</SourceLink> : <span key={index}>{part}</span>
    })}</div>
    {response.artifacts.map(artifact => <Artifact key={artifact.id} artifact={artifact} />)}
    {!!response.sources.length && <div className="ag-evidence">
      <b>Джерела</b>{response.sources.map(source => <div key={source.id}><SourceLink source={source}>[{source.id}] {source.title}</SourceLink></div>)}
    </div>}
    {response.as_of && <small className="ag-snapshot">Дані бази станом на {date(response.as_of)}</small>}
  </>
}
