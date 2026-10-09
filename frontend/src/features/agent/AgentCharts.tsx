import { Link } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { Sparkline } from '../../charts/Sparkline'
import { DOMAINS, categoryOf } from '../../domain/labels'
import type { AgentColumn, AgentRow, DataArtifact } from './types'

const num = (value: number | null | undefined, decimals = 0) => value == null ? 'Немає даних' : value.toLocaleString('uk-UA', { maximumFractionDigits: decimals })
const domain = (value: string) => DOMAINS[value] ?? (value === 'none' ? 'Галузь не визначено' : value)
const colors = ['var(--sector-uav)', 'var(--sector-ammo)', 'var(--sector-armor)', 'var(--sector-missiles)', 'var(--sector-aviation)', 'var(--sector-electronics)', 'var(--sector-other)']
const label = (row: AgentRow, artifact: DataArtifact) => artifact.columns?.find(c => c.key === 'label')?.format === 'domain' ? domain(row.label) : row.label
const H = 260, R = 32, T = 20, B = 42
const tick = (value: number) => value >= 1000 ? `${num(value / 1000, 1)} тис.` : num(value)

function Grid({ max, width, left, money = false, guides = true }: { max: number; width: number; left: number; money?: boolean; guides?: boolean }) {
  return <g className="grid">{[0, .25, .5, .75, 1].map(f => <g key={f}>
    {guides && <line x1={left} x2={width - R} y1={H - B - f * (H - T - B)} y2={H - B - f * (H - T - B)} />}
    <text x={left - 10} y={H - B - f * (H - T - B) + 4} textAnchor="end">{money ? `${num(max * f)} ₽` : tick(max * f)}</text>
  </g>)}</g>
}

export function AnalyticsTable({ artifact }: { artifact: DataArtifact }) {
  const columns: AgentColumn[] = artifact.columns ?? [
    { key: 'label', label: 'Назва', format: 'company' }, { key: 'value', label: artifact.unit, format: 'number' },
    ...(artifact.unit === 'RUB/місяць' ? [{ key: 'salary_samples', label: 'Вибірка зарплат', format: 'number' } as AgentColumn] : []),
  ]
  const cell = (row: AgentRow, column: AgentColumn) => {
    const value = row[column.key]
    if (column.format === 'spark') return Array.isArray(value) ? <span role="img" aria-label={`Публікації за 6 місяців: ${value.join(', ')}`} title={value.join(' → ')}><Sparkline values={value} width={90} height={24} area={false} /></span> : 'Немає даних'
    if (column.format === 'domain') return domain(String(value ?? 'none'))
    if (column.format === 'company') return row.source_id && typeof row.id === 'number' ? <Link to={`/companies/${row.id}`}>{String(value)}</Link> : String(value ?? 'Немає даних')
    if (column.format === 'text') return String(value ?? 'Немає даних')
    return typeof value === 'number' ? `${num(value, column.format === 'percent' ? 1 : 0)}${column.format === 'percent' ? '%' : ''}` : 'Немає даних'
  }
  return <div className="ag-table-scroll" role="region" aria-label={`Таблиця: ${artifact.title}`} tabIndex={0}>
    {columns.length > 3 && <p className="ag-table-hint">Прокрутіть таблицю вправо, щоб побачити всі показники →</p>}
    <table className={`ag-table${columns.length > 3 ? ' ag-table-wide' : ''}`}><caption className="sr">{artifact.title}</caption>
      <thead><tr>{columns.map(c => <th key={c.key} scope="col" className={c.key === 'label' ? 'ag-name' : undefined}>{c.label}</th>)}</tr></thead>
      <tbody>{artifact.rows.map((row, i) => <tr key={i}>{columns.map(c => <td key={c.key} className={c.key === 'label' ? 'ag-name' : ['number', 'money', 'percent'].includes(c.format) ? 'ag-num' : undefined}>{cell(row, c)}</td>)}</tr>)}</tbody>
    </table>
  </div>
}

export function AgentChart({ artifact }: { artifact: DataArtifact }) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const resize = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    resize.observe(element)
    return () => resize.disconnect()
  }, [])
  return <div className="ag-chart" ref={container}><ChartContent artifact={artifact} width={width} /></div>
}

function ChartContent({ artifact, width: W }: { artifact: DataArtifact; width: number }) {
  const { rows, kind } = artifact
  const money = kind === 'scatter' || (kind === 'line' && artifact.unit === 'RUB/місяць')
  const maxMoney = Math.max(1, ...rows.map(r => (kind === 'scatter' ? r.median_salary : r.value) ?? 0)) * (kind === 'scatter' ? 1.15 : 1.1)
  const L = money ? Math.max(96, num(maxMoney).length * 7 + 30) : 64
  if (!rows.length) return <p className="ag-empty">{kind === 'signals' && artifact.stats?.vacancies ? 'За заданими правилами статистичних сигналів не виявлено.' : 'За вибраними умовами даних немає.'}</p>
  if (kind === 'table') return <AnalyticsTable artifact={artifact} />
  if (kind === 'line') {
    const points = rows.filter(r => r.id != null && r.value != null)
    const max = Math.max(1, ...points.map(r => r.value!)) * 1.1
    const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((W - L - R) / 60))))
    const x = (i: number) => L + (points.length === 1 ? .5 : i / (points.length - 1)) * (W - L - R)
    const y = (value: number) => H - B - value / max * (H - T - B)
    return <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={artifact.title}><Grid max={max} width={W} left={L} money={money} />
      <path d={points.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r.value!)}`).join(' ')} fill="none" stroke="var(--accent-foreground)" strokeWidth={2.5} strokeLinejoin="round" />
      {points.map((row, i) => <g key={i}><circle cx={x(i)} cy={y(row.value!)} r={4} fill="var(--accent-foreground)"><title>{`${row.label}: ${num(row.value)} ${artifact.unit}`}</title></circle>{i % labelEvery === 0 && <text x={x(i)} y={H - B + 20} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{String(row.id).slice(5, 7)}.{String(row.id).slice(2, 4)}</text>}</g>)}
    </svg>
  }
  if (kind === 'bar') {
    const max = Math.max(1, ...rows.map(r => r.value ?? 0))
    return <div className="ag-bars">{rows.map((row, i) => <div key={i} className="ag-bar-row" title={`${label(row, artifact)}: ${num(row.value)} ${artifact.unit}`}>
      <span>{artifact.columns ? label(row, artifact) : categoryOf(row.label).name === 'Напрям не визначено' ? row.label : categoryOf(row.label).name}</span>
      <strong>{row.share != null ? `${num(row.share, 1)}%` : `${num(row.value)}${artifact.unit === 'RUB/місяць' ? ' ₽' : ''}`}</strong><div className="ag-bar-track"><div style={{ width: `${100 * (row.value ?? 0) / max}%`, background: colors[i % colors.length] }} /></div>
    </div>)}</div>
  }
  if (kind === 'kpi') return <div className="ag-kpis">{rows.map(row => <div className="ag-kpi" key={row.id}><span>{row.label}</span><strong>{num(row.value)}</strong><small>{row.unit}{row.id === 'salary' && ` · ${num(row.salary_samples)} вакансій із зарплатою`}</small></div>)}</div>
  if (kind === 'signals') return <ul className="ag-signals">{rows.map(row => <li key={row.id}><b>{row.source_id && typeof row.id === 'number' ? <Link to={`/companies/${row.id}`}>{row.label}</Link> : row.label}</b>
    {!!row.outlier_salaries && <p>{num(row.outlier_salaries)} вакансій із зарплатою вище Q3 + 1,5×IQR.</p>}
    {(row.share ?? 0) >= 50 && (row.value ?? 0) >= 5 && <p>Концентрація найму: {num(row.share, 1)}% вибірки ({num(row.value)} вакансій).</p>}
  </li>)}</ul>
  if (kind === 'donut') {
    const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0)
    const circumference = 2 * Math.PI * 52
    const offsets = rows.map((_, i) => rows.slice(0, i).reduce((sum, row) => sum + (row.value ?? 0), 0) / (total || 1) * circumference)
    return <div className="ag-donut"><svg viewBox="0 0 150 150" role="img" aria-label={artifact.title}>
      {rows.map((row, i) => {
        const length = total ? (row.value ?? 0) / total * circumference : 0
        return <circle key={i} cx={75} cy={75} r={52} fill="none" stroke={colors[i % colors.length]} strokeWidth={20} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offsets[i]} transform="rotate(-90 75 75)"><title>{`${domain(row.label)}: ${num(row.value)} · ${num(row.share, 1)}%`}</title></circle>
      })}
      <text x={75} y={74} textAnchor="middle" className="ag-donut-total">{num(total)}</text><text x={75} y={94} textAnchor="middle">вакансій</text>
    </svg><ul className="ag-legend">{rows.map((row, i) => <li key={i}><i style={{ background: colors[i % colors.length] }} /><span>{domain(row.label)}</span><b>{num(row.share, 1)}%</b></li>)}</ul></div>
  }
  if (kind === 'heatmap') {
    const regions = [...new Set(rows.map(r => r.label))]
    const domains = [...new Set(rows.map(r => r.domain ?? 'none'))]
    const max = Math.max(1, ...rows.map(r => r.value ?? 0))
    return <div className="ag-table-scroll" role="region" aria-label={artifact.title} tabIndex={0}><table className="ag-table ag-heatmap"><caption className="sr">{artifact.title}</caption><thead><tr><th scope="col">Регіон</th>{domains.map(d => <th scope="col" key={d}>{domain(d)}</th>)}</tr></thead><tbody>{regions.map(region => <tr key={region}><th scope="row">{region}</th>{domains.map(d => {
      const value = rows.find(r => r.label === region && (r.domain ?? 'none') === d)?.value ?? 0
      return <td key={d} title={`${region} · ${domain(d)}: ${num(value)} вакансій`}><span style={{ background: `color-mix(in srgb, var(--primary) ${Math.round(value / max * 75 + 8)}%, var(--surface-raised))`, color: value / max > .6 ? 'var(--primary-foreground)' : 'var(--label-1)' }}>{num(value)}</span></td>
    })}</tr>)}</tbody></table></div>
  }
  if (kind === 'stacked') {
    const months = [...new Set(rows.map(r => r.label))].sort()
    const domains = [...new Set(rows.map(r => r.domain ?? 'none'))]
    const totals = months.map(m => rows.filter(r => r.label === m).reduce((s, r) => s + (r.value ?? 0), 0))
    const max = Math.max(1, ...totals), bw = (W - L - R) / months.length
    const labelEvery = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor((W - L - R) / 55))))
    return <><svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={artifact.title}><Grid max={max} width={W} left={L} />{months.map((m, i) => {
      let sum = 0
      return <g key={m}>{domains.map((d, j) => {
        const value = rows.find(r => r.label === m && r.domain === d)?.value ?? 0
        const height = value / max * (H - T - B); sum += height
        return <rect key={d} x={L + i * bw + bw * .15} y={H - B - sum} width={bw * .7} height={height} rx={2} fill={colors[j % colors.length]}><title>{`${m} · ${domain(d)}: ${num(value)}`}</title></rect>
      })}{i % labelEvery === 0 && <text x={L + (i + .5) * bw} y={H - B + 18} textAnchor="middle">{m.slice(5, 7)}.{m.slice(2, 4)}</text>}</g>
    })}</svg><ul className="ag-legend ag-legend-inline">{domains.map((d, i) => <li key={d}><i style={{ background: colors[i % colors.length] }} />{domain(d)}</li>)}</ul></>
  }
  if (kind === 'scatter') {
    const points = rows.filter(r => r.median_salary != null)
    if (!points.length) return <p className="ag-empty">Немає відомих зарплат для точкової діаграми. Обсяги найму доступні в таблиці.</p>
    const maxX = Math.max(1, ...points.map(r => r.value ?? 0)) * 1.15
    const maxY = Math.max(1, ...points.map(r => r.median_salary ?? 0)) * 1.15
    const maxSize = Math.max(1, ...points.map(r => r.recent_30d ?? 0))
    const tickCount = Math.max(2, Math.min(4, Math.floor((W - L - R) / 65)))
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i / tickCount)
    return <svg className="chart-svg" viewBox={`0 0 ${W} ${H + 15}`} role="img" aria-label={artifact.title}><Grid max={maxY} width={W} left={L} money />{ticks.map(f => <text key={f} x={L + f * (W - L - R)} y={H - B + 18} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{tick(maxX * f)}</text>)}<text x={(W + L) / 2} y={H + 5} textAnchor="middle">Активних вакансій</text>{points.map((row, i) => <circle key={i} cx={L + (row.value ?? 0) / maxX * (W - L - R)} cy={H - B - row.median_salary! / maxY * (H - T - B)} r={5 + Math.sqrt((row.recent_30d ?? 0) / maxSize) * 12} fill={colors[i % colors.length]} fillOpacity={.75} stroke="var(--surface)" strokeWidth={2}><title>{`${row.label}: ${num(row.value)} вакансій; медіана ${num(row.median_salary)} ₽; ${num(row.salary_samples)} зарплат; ${num(row.recent_30d)} публікацій за 30 днів`}</title></circle>)}</svg>
  }
  // Histogram: continuous salary axis, including empty bins between observed values.
  const lower = Math.min(...rows.map(r => r.lower ?? 0)), upper = Math.max(...rows.map(r => r.upper ?? 1))
  const max = Math.max(1, ...rows.map(r => r.value ?? 0)), span = Math.max(1, upper - lower)
  const x = (v: number) => L + (v - lower) / span * (W - L - R)
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((W - L - R) / 75))))
  const q = artifact.stats?.quartiles
  return <><svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={artifact.title}><Grid max={max} width={W} left={L} guides={false} />
    {rows.map((row, i) => <g key={i}><rect x={x(row.lower ?? 0) + 1} y={H - B - (row.value ?? 0) / max * (H - T - B)} width={Math.max(1, x(row.upper ?? 1) - x(row.lower ?? 0) - 2)} height={(row.value ?? 0) / max * (H - T - B)} rx={3} fill="var(--primary)" opacity={.75}><title>{`${row.label} ₽: ${num(row.value)} вакансій`}</title></rect>{i % labelEvery === 0 && <text x={x(row.lower ?? 0)} y={H - B + 18} textAnchor="start">{tick(row.lower ?? 0)}</text>}</g>)}
    <text x={(W + L) / 2} y={H - 3} textAnchor="middle">Місячна зарплата, ₽</text>
  </svg><small>Медіана: {num(q?.[1])} ₽ · Вибірка: {num(artifact.stats?.salary_samples)}</small></>
}
