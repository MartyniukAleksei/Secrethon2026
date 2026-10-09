import { Link } from 'react-router'
import { useId, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AgentChart, AnalyticsTable } from './AgentCharts'
import type { AgentArtifact, AgentResponse, AgentSource } from './types'

const date = (value: string) => new Date(value).toLocaleDateString('uk-UA')
const kinds: Record<string, string> = { parent: 'Холдинг', supplier: 'Постачання', bank: 'Банк', related: 'Зв’язок', successor: 'Правонаступник', branch: 'Філія' }
const isInternal = (url: string) => /^\/(?:companies\/\d+|vacancies(?:\/\d+)?)?$/.test(url)
function site(url: string) {
  if (isInternal(url)) return 'База платформи'
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : null } catch { return null }
}

function SourceLink({ source, children }: { source: AgentSource; children?: ReactNode }) {
  if (isInternal(source.url)) return <Link to={source.url}>{children ?? source.title}</Link>
  if (!site(source.url)) return <span>{children ?? source.title}</span>
  return <a href={source.url} target="_blank" rel="noopener noreferrer">{children ?? source.title}</a>
}

function Artifact({ artifact, table = false }: { artifact: AgentArtifact; table?: boolean }) {
  if (artifact.kind === 'relations') return <section className="ag-artifact">
    <h3>{artifact.title}</h3>
    <div className="ag-relations"><div className="ag-relation-center">{artifact.company}</div>
      {artifact.items.map((item, index) => <div className="ag-relation" key={index}>
        <span aria-hidden="true">{item.direction === 'out' ? '→' : '←'}</span>
        <div>{item.employer_id ? <Link to={`/companies/${item.employer_id}`}>{item.name}</Link> : item.name}<small>{kinds[item.kind] ?? item.kind}</small></div>
      </div>)}
    </div>
    {!artifact.items.length && <p>У базі немає записів про зв’язки.</p>}
  </section>
  if (artifact.kind === 'mentions') return <section className="ag-artifact">
    <h3>{artifact.title}</h3>
    <small>Пошук за {artifact.days} днів. Збіг підприємства потребує перевірки; охоплення соцмереж може бути неповним.</small>
    {artifact.items.map(item => <article className="ag-mention" key={item.url}>
      <SourceLink source={{ id: item.source_id, title: item.title, url: item.url }} />
      <small>{item.published_at ? date(item.published_at) : 'Дата публікації невідома'} · {site(item.url)}</small>
      <p>{item.text.length > 280 ? `${item.text.slice(0, 280).replace(/\s+\S*$/, '')}…` : item.text}</p>
      {item.text.length > 280 && <details><summary>Повний витяг із джерела</summary><p>{item.text}</p></details>}
    </article>)}
    {!artifact.items.length && <p>Публічних згадок за цей період не знайдено.</p>}
  </section>
  if (table) return <details className="ag-values"><summary>Точні значення · {artifact.title}</summary><AnalyticsTable artifact={artifact} /></details>
  return <section className="ag-artifact">
    <h3>{artifact.title}</h3>
    <small>{artifact.scope.days ? `За ${artifact.scope.days} днів до дати зрізу` : 'За весь доступний період'}{artifact.scope.as_of && ` · зріз ${date(artifact.scope.as_of)}`}</small>
    <AgentChart artifact={artifact} />
    <small className="ag-chart-note">{artifact.note ?? `Одиниця: ${artifact.unit}. Активні вакансії без дублів.`}</small>
  </section>
}

export function AgentAnswer({ response }: { response: AgentResponse }) {
  const prefix = `agent-source-${useId().replace(/[^\w-]/g, '')}`
  const visibleSources = response.sources
    .filter(source => !(source.url === '/' && source.title === 'Огляд платформи'))
    .map(source => source.url === '/' && source.title === 'Аналітика вакансій платформи' ? { ...source, url: '/vacancies' } : source)
  const sources = new Map(visibleSources.map((source, index) => [source.id, { source, index: index + 1, anchor: `${prefix}-${source.id}` }]))
  const citations = new Map([...sources.values()].map(entry => [`#${entry.anchor}`, entry]))
  const artifacts = new Map(response.artifacts.map(artifact => [artifact.id, artifact]))
  // Older model answers may put an artifact placeholder under a heading. The
  // real artifact already has its own heading below, so omit that empty block.
  const prose = response.text
    .replace(/(?:^|\n)#{1,6}[^\n]+\n+\[(a\d+)\][ \t]*(?=\n|$)/g, (original, id: string) => artifacts.has(id) ? '' : original)
    .replace(/\[(a\d+)\]/g, (original, id: string) => artifacts.get(id)?.title ?? original)
  const text = prose.replace(/\[(s\d+(?:\s*,\s*s\d+)*)\]/g, (original, group: string) => {
    const ids = group.split(/\s*,\s*/)
    if (!ids.every(id => response.sources.some(source => source.id === id))) return original
    return ids.flatMap(id => {
      const entry = sources.get(id)
      return entry ? [`[\\[${entry.index}\\]](#${entry.anchor})`] : []
    }).join(' ')
  })
  return <>
    <div className="ag-answer-text"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      h1: ({ children }) => <h3>{children}</h3>, h2: ({ children }) => <h3>{children}</h3>, h3: ({ children }) => <h3>{children}</h3>,
      img: () => null,
      table: ({ children }) => <div className="ag-table-scroll"><table className="ag-table">{children}</table></div>,
      a: ({ href, children }) => {
        const citation = citations.get(href ?? '')
        if (citation) return <a className="ag-citation" href={href} title={citation.source.title} aria-label={`Джерело ${citation.index}: ${citation.source.title}`}>{children}</a>
        const source = visibleSources.find(source => source.url === href || (href === '/' && source.title === 'Аналітика вакансій платформи'))
        return source ? <SourceLink source={source}>{children}</SourceLink> : <span>{children}</span>
      },
    }}>{text}</Markdown></div>
    {response.artifacts.filter(artifact => !(artifact.kind === 'table' && artifact.companion_id && artifacts.has(artifact.companion_id))).map(artifact => {
      const companion = 'companion_id' in artifact && artifact.companion_id ? artifacts.get(artifact.companion_id) : undefined
      return <div key={artifact.id}><Artifact artifact={artifact} />{companion?.kind === 'table' && <Artifact artifact={companion} table />}</div>
    })}
    {!!visibleSources.length && <section className="ag-evidence" aria-label="Джерела відповіді">
      <h3>Джерела та матеріали</h3><ol>{visibleSources.map(source => {
        const entry = sources.get(source.id)!
        return <li key={source.id} id={entry.anchor} tabIndex={-1}><div><SourceLink source={source} /><span className="ag-source-site">{site(source.url) ?? 'Джерело'}</span>{source.published_at && <time dateTime={source.published_at}>{date(source.published_at)}</time>}</div></li>
      })}</ol>
    </section>}
    {response.as_of && <small className="ag-snapshot">Дані бази станом на {date(response.as_of)}</small>}
  </>
}
