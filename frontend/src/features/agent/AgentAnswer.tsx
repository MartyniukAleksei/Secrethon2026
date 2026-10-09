import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { LineChart } from '../../charts/LineChart'
import type { AgentArtifact, AgentResponse, AgentSource } from './types'
import { useData } from '../../data/DataContext'
import { mapActionHref } from './mapActions'

const number = (value: number | null) => value == null ? 'Немає даних' : value.toLocaleString('uk-UA', { maximumFractionDigits: 0 })
const date = (value: string) => new Date(value).toLocaleDateString('uk-UA')
const kinds: Record<string, string> = { parent: 'Холдинг', supplier: 'Постачання', bank: 'Банк', related: 'Зв’язок', successor: 'Правонаступник', branch: 'Філія' }

function SourceLink({ source, children }: { source: AgentSource; children?: ReactNode }) {
  if (source.url.startsWith('/')) return <Link to={source.url}>{children ?? source.title}</Link>
  return <a href={source.url} target="_blank" rel="noopener noreferrer">{children ?? source.title}</a>
}

function Artifact({ artifact, sources }: { artifact: AgentArtifact; sources: Map<string, AgentSource> }) {
  if (artifact.kind === 'relations') return <section className="ag-artifact">
    <b>{artifact.title}</b>
    <div className="ag-relations"><div className="ag-relation-center">{artifact.company}</div>
      {artifact.items.map((item, index) => <div className="ag-relation" key={index}>
        <span aria-hidden="true">{item.direction === 'out' ? '→' : '←'}</span>
        <div>{item.employer_id ? <Link to={`/companies/${item.employer_id}`}>{item.name}</Link> : item.name}<small>{kinds[item.kind] ?? item.kind}{item.source_id && sources.has(item.source_id) && <> · <SourceLink source={sources.get(item.source_id)!}>Джерело</SourceLink></>}</small></div>
      </div>)}
    </div>
    {!artifact.items.length && <p>У базі немає записів про зв’язки.</p>}
    {artifact.total != null && artifact.total > artifact.items.length && <small>Показано {artifact.items.length} із {artifact.total} зв’язків.</small>}
    {artifact.employer_id && <Link className="btn btn-sm" to={`/map?co=${artifact.employer_id}&layers=supplier,parent&network=1&network_other=1`}>Показати мережу на карті</Link>}
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
  const { byId } = useData()
  const sources = new Map(response.sources.map(source => [source.id, source]))
  const renderText = (text: string) => <div className="ag-answer-text">{text.split(/(\[s\d+\])/g).map((part, index) => {
    const source = sources.get(part.slice(1, -1))
    return source ? <SourceLink key={index} source={source}>{part}</SourceLink> : <span key={index}>{part}</span>
  })}</div>
  const labels = { database: 'За даними платформи', public_web: 'З відкритих джерел', analysis: 'Висновок агента' }
  return <>
    {response.context && <small className="ag-snapshot">Запит: {response.context.company_id ? byId[response.context.company_id]?.name ?? `підприємство ${response.context.company_id}` : response.context.map_scope?.mode === 'viewport' ? 'зафіксована область карти' : response.context.map_scope?.mode === 'selection' ? 'вибрані підприємства' : 'поточні фільтри'} · {response.context.days ? `${response.context.days} днів до зрізу` : 'увесь доступний період'}</small>}
    {response.scope_totals && <div className="ag-scope-summary"><b>Область дослідження</b><span>{number(response.scope_totals.employers)} підприємств · {number(response.scope_totals.vacancies)} вакансій</span><small>Підсумок усієї вибірки. Рейтинги нижче показують лише зазначену кількість підприємств.</small></div>}
    {response.sections?.length ? (['database', 'public_web', 'analysis'] as const).map(kind => {
      const section = response.sections!.find(s => s.kind === kind)
      const artifacts = response.artifacts.filter(a => kind === 'database' ? a.kind !== 'mentions' : kind === 'public_web' && a.kind === 'mentions')
      if (!section && !artifacts.length) return null
      return <section className={`ag-evidence-section ag-origin-${kind}`} key={kind}>
        <b className="ag-section-title">{labels[kind]}</b>
        {kind === 'public_web' && <small className="ag-origin-note">Матеріали вебпошуку. Збіг підприємства та заяви джерела потребують перевірки.</small>}
        {section && renderText(section.text)}
        {section && !!section.source_ids.length && <div className="ag-inline-evidence">{section.source_ids.filter(id => sources.has(id)).map(id => <SourceLink key={id} source={sources.get(id)!}>[{id}]</SourceLink>)}</div>}
        {artifacts.map(artifact => <Artifact key={artifact.id} artifact={artifact} sources={sources} />)}
      </section>
    }) : <>{renderText(response.text)}{response.artifacts.map(artifact => <Artifact key={artifact.id} artifact={artifact} sources={sources} />)}</>}
    {!!response.actions?.length && <div className="ag-actions">{response.actions.map((action, i) => <Link key={i} className="btn btn-sm" to={action.kind === 'show_companies' ? `/map?agent_ids=${action.employer_ids.join(',')}` : `/map?co=${action.employer_id}&layers=supplier,parent&network=1`}>{action.kind === 'show_companies' ? 'Показати підприємства на карті' : 'Показати зв’язки на карті'}</Link>)}<small>Відкриє карту з вибіркою відповіді.</small></div>}
    {!!response.sources.length && <div className="ag-evidence">
      <details><summary>Джерела ({response.sources.length})</summary>{(['database', 'public_web'] as const).map(origin => {
        const group = response.sources.filter(s => (s.origin ?? 'database') === origin)
        return group.length > 0 && <div className="ag-source-group" key={origin}><b>{labels[origin]}</b>{group.map(source => <div key={source.id}><SourceLink source={source}>[{source.id}] {source.title}</SourceLink>
          {source.retrieved_at && <small>Отримано {date(source.retrieved_at)}{source.published_at && ` · опубліковано ${date(source.published_at)}`}</small>}
          {source.excerpt && <details><summary>Використаний фрагмент</summary><p>{source.excerpt}</p></details>}
        </div>)}</div>
      })}</details>
    </div>}
    {response.map_action && byId[response.map_action.employer_id] && <div className="ag-actions"><Link className="btn btn-sm" to={mapActionHref(response.map_action)}>{response.map_action.kind === 'show_relations' ? 'Відкрити зв’язки цього підприємства' : 'Наблизити підприємство на карті'}</Link></div>}
    {response.as_of && <small className="ag-snapshot">Дані бази станом на {date(response.as_of)}</small>}
  </>
}
