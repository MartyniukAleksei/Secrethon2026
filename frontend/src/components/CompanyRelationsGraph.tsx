import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { ApiRelation } from '../api/types'
import { fmt } from '../domain/format'
import { relationName } from '../domain/labels'
import type { EmployerDetail } from '../domain/types'
import { Icon } from '../ui/Icon'
import './CompanyRelationsGraph.css'

const WIDTH = 980
const NODE_WIDTH = 260
const NODE_HEIGHT = 94
const PAGE_SIZE = 12
const FILTERS = [
  ['all', 'Усі'], ['parent', 'Холдинг'], ['supplier', 'Постачання'],
  ['bank', 'Банки'], ['successor', 'Правонаступники'], ['related', 'Інші'],
] as const

/** An edge's real direction, from the company whose profile lists it. */
function flowsIntoCompany(relation: ApiRelation) {
  return relation.kind === 'successor' ? relation.direction === 'in' : relation.direction === 'out'
}

export function CompanyRelationsGraph({ employer: e }: { employer: EmployerDetail }) {
  const [kind, setKind] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(0.85)
  const [viewportWidth, setViewportWidth] = useState(WIDTH)
  const viewport = useRef<HTMLDivElement>(null)
  const arrowId = useId()
  const relations = (e.gur?.relations ?? []).filter((r) => r.company_id !== e.gur?.company_id)
  const filtered = relations.filter((r) => kind === 'all' || r.kind === kind)
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const left = visible.filter((r) => flowsIntoCompany(r))
  const right = visible.filter((r) => !flowsIntoCompany(r))
  const narrow = viewportWidth < 540
  const graphWidth = narrow ? 340 : WIDTH
  const height = narrow ? (visible.length + 1) * 114 + 40 : Math.max(320, Math.max(left.length, right.length) * 114 + 40)
  const centerX = narrow ? 40 : 360
  const centerY = narrow ? left.length * 114 + 20 : height / 2 - NODE_HEIGHT / 2
  const columns = [left, right].flatMap((items, column) => items.map((r, index) => ({
    relation: r,
    x: narrow ? 40 : column === 0 ? 20 : 700,
    y: narrow ? (column === 0 ? 20 : centerY + 114) + index * 114 : (height - items.length * 114 + 20) / 2 + index * 114,
    incoming: column === 0,
  })))

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    setViewportWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (viewport.current) {
      viewport.current.scrollTop = Math.max(0, (centerY + NODE_HEIGHT / 2) * zoom - viewport.current.clientHeight / 2)
      viewport.current.scrollLeft = Math.max(0, graphWidth * zoom / 2 - viewport.current.clientWidth / 2)
    }
  }, [centerY, graphWidth, zoom, page, kind])

  const pages = Math.ceil(filtered.length / PAGE_SIZE)
  return (
    <section className="panel relation-graph-panel">
      <div className="panel-head">
        <div><h3>Граф зв’язків</h3><p>Прямі зв’язки підприємства за даними ГУР</p></div>
        <div className="row graph-controls">
          <button className="btn btn-secondary btn-icon btn-sm" type="button" aria-label="Зменшити граф" disabled={zoom <= 0.35} onClick={() => setZoom((z) => Math.max(0.35, z - 0.15))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="btn btn-secondary btn-icon btn-sm" type="button" aria-label="Збільшити граф" disabled={zoom >= 1.5} onClick={() => setZoom((z) => Math.min(1.5, z + 0.15))}>+</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setZoom(Math.max(0.35, Math.min(1, (viewport.current?.clientWidth ?? graphWidth) / graphWidth)))}>Вмістити</button>
        </div>
      </div>
      <div className="row relation-graph-filters" aria-label="Тип зв’язків на графі">
        {FILTERS.filter(([key]) => key === 'all' || relations.some((r) => r.kind === key)).map(([key, label]) => (
          <button className="chip" key={key} type="button" aria-pressed={kind === key} onClick={() => { setKind(key); setPage(0) }}>{label}</button>
        ))}
      </div>
      <div className="relation-graph-viewport" ref={viewport} tabIndex={0} aria-label="Граф зв’язків, можна прокручувати">
        <div style={{ width: graphWidth * zoom, height: height * zoom, margin: '0 auto' }}>
          <div className="relation-graph-surface" style={{ width: graphWidth, height, transform: `scale(${zoom})` }}>
            <svg width={graphWidth} height={height} aria-hidden="true">
              <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--label-3)" /></marker></defs>
              {columns.map(({ relation: r, x, y, incoming }) => {
                const startX = narrow ? (incoming ? x + NODE_WIDTH : centerX) : incoming ? x + NODE_WIDTH : centerX + NODE_WIDTH
                const endX = narrow ? (incoming ? centerX + NODE_WIDTH : x) : incoming ? centerX : x
                const startY = incoming ? y + NODE_HEIGHT / 2 : centerY + NODE_HEIGHT / 2
                const endY = incoming ? centerY + NODE_HEIGHT / 2 : y + NODE_HEIGHT / 2
                const middleX = narrow ? (incoming ? graphWidth - 10 : 10) : (startX + endX) / 2
                return <path key={`${r.kind}-${r.direction}-${r.company_id}`} d={`M${startX},${startY} C${middleX},${startY} ${middleX},${endY} ${endX},${endY}`} fill="none" stroke="var(--label-3)" strokeWidth="1.5" strokeDasharray={r.kind === 'related' ? '5 5' : undefined} markerEnd={r.kind === 'related' ? undefined : `url(#${arrowId})`} />
              })}
            </svg>
            <div className="relation-graph-node current" style={{ left: centerX, top: centerY }}>
              <span>Поточне підприємство</span><b title={e.name}>{e.name}</b>{e.inn && <small>ІПН {e.inn}</small>}
            </div>
            {columns.map(({ relation: r, x, y }) => {
              const key = `${r.kind}-${r.direction}-${r.company_id}`
              const body = <><span>{relationName(r)}</span><b title={r.name}>{r.name}</b><small>{r.inn ? `ІПН ${r.inn}` : 'ІПН не вказано'}{r.sanctions_count > 0 ? ` · санкцій: ${r.sanctions_count}` : ''}</small></>
              return r.employer_id != null ? (
                <Link key={key} className="relation-graph-node" to={`/companies/${r.employer_id}`} style={{ left: x, top: y }}>{body}<Icon name="chev" /></Link>
              ) : <div key={key} className="relation-graph-node" style={{ left: x, top: y }}>{body}</div>
            })}
          </div>
        </div>
      </div>
      <div className="relation-graph-footer">
        <p className="src">Стрілки: материнська → дочірня, постачальник → замовник, банк → клієнт, попередник → правонаступник. Інші зв’язки — без напрямку.</p>
        {pages > 1 && <div className="pager">
          <button className="btn btn-secondary btn-sm" type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Назад</button>
          <span>{page + 1} / {pages} · {fmt(filtered.length)} зв’язків</span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Далі</button>
        </div>}
      </div>
    </section>
  )
}
