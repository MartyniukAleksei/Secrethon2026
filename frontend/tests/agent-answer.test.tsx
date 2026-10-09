import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { AgentAnswer } from '../src/features/agent/AgentAnswer'
import { AgentChart } from '../src/features/agent/AgentCharts'
import type { AgentResponse, DataArtifact } from '../src/features/agent/types'

const sources = [{ id: 's1', title: 'Картка підприємства', url: '/companies/1' }, { id: 's8', title: 'Офіційний реєстр', url: 'https://www.example.com/registry' }]
const base: AgentResponse = { text: '', sources, artifacts: [], as_of: '2026-10-05T12:00:00Z', tools_used: [] }
const artifact: DataArtifact = { id: 'a1', kind: 'bar', title: 'Найм', unit: 'вакансій', rows: [{ id: 1, label: 'Підприємство', value: 4, median_salary: 75000, vacancies: 4, salary_samples: 2, recent_30d: 3, share: 100, lower: 60000, upper: 80000, trend: [0, 0, 1, 1, 0, 2], domain: 'uav' }], scope: { days: 0, as_of: base.as_of, active_only: true, category: null, region_id: null } }
const render = (response: AgentResponse) => renderToStaticMarkup(<MemoryRouter><AgentAnswer response={response} /></MemoryRouter>)

test('structured Markdown and grouped citations point to the final named sources', () => {
  const html = render({ ...base, text: '## Санкції та найм\n\n**4 вакансії** [s1, s8].\n\n- Підтверджені дані\n- Обмеження вибірки' })
  assert.match(html, /<h3>Санкції та найм<\/h3>/)
  assert.match(html, /<strong>4 вакансії<\/strong>/)
  assert.match(html, /<ul>/)
  const links = [...html.matchAll(/class="ag-citation" href="#([^"]+)"/g)]
  assert.equal(links.length, 2)
  links.forEach(link => assert.ok(html.includes(`id="${link[1]}"`)))
  assert.match(html, /\[1\]<\/a>/)
  assert.match(html, /\[2\]<\/a>/)
  assert.match(html, /ag-source-site">example.com/)
  assert.match(html, /href="\/companies\/1"/)
  assert.ok(html.indexOf('Джерела та матеріали') > html.indexOf('<ul>'))
})

test('source anchors are unique across answers in the same conversation', () => {
  const html = renderToStaticMarkup(<MemoryRouter><AgentAnswer response={{ ...base, text: '[s1]' }} /><AgentAnswer response={{ ...base, text: '[s1]' }} /></MemoryRouter>)
  const ids = [...html.matchAll(/<li[^>]* id="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length)
})

test('origin sections retain Markdown, companion tables and final numbered evidence', () => {
  const html = render({ ...base,
    sections: [
      { kind: 'database', text: '**4 вакансії** [s1].', source_ids: ['s1'] },
      { kind: 'public_web', text: 'Матеріал [s8].', source_ids: ['s8'] },
      { kind: 'analysis', text: '## Обмеження\n\nВисновок із даних.', source_ids: [] },
    ],
    sources: [{ ...sources[0], origin: 'database' }, { ...sources[1], origin: 'public_web', excerpt: 'Підтверджувальний фрагмент' }],
    artifacts: [{ ...artifact, companion_id: 'a2' }, { ...artifact, id: 'a2', kind: 'table', companion_id: 'a1' }],
  })
  assert.match(html, /ag-origin-database/)
  assert.match(html, /ag-origin-public_web/)
  assert.match(html, /ag-origin-analysis/)
  assert.match(html, /<strong>4 вакансії<\/strong>/)
  assert.match(html, /<h3>Обмеження<\/h3>/)
  assert.equal((html.match(/<table/g) ?? []).length, 1)
  assert.ok(html.indexOf('Джерела та матеріали') > html.indexOf('ag-origin-analysis'))
  assert.match(html, /Підтверджувальний фрагмент/)
})

test('overview sources and their citations are omitted while remaining citations are renumbered', () => {
  const html = render({ ...base, sources: [{ id: 's0', title: 'Огляд платформи', url: '/' }, ...sources], text: 'Підсумок [s0]. Дані підприємства [s0, s1, s8].' })
  assert.doesNotMatch(html, /Огляд платформи|href="\/"|\[s0\]/)
  assert.match(html, /href="\/companies\/1"/)
  assert.match(html, /href="https:\/\/www.example.com\/registry"/)
  assert.equal((html.match(/class="ag-citation"/g) ?? []).length, 2)
  assert.match(html, /\[1\]<\/a>/)
  assert.match(html, /\[2\]<\/a>/)
  const overviewOnly = render({ ...base, sources: [{ id: 's1', title: 'Огляд платформи', url: '/' }], text: 'Підсумок [s1].' })
  assert.doesNotMatch(overviewOnly, /Джерела та матеріали|\[s1\]/)
})

test('analytics sources open vacancies, including responses from an older backend', () => {
  for (const url of ['/', '/vacancies']) {
    const html = render({ ...base, sources: [{ id: 's1', title: 'Аналітика вакансій платформи', url }], text: 'Дані [s1].' })
    assert.match(html, /href="\/vacancies"/)
    assert.doesNotMatch(html, /href="\/"/)
    assert.match(html, /ag-source-site">База платформи/)
  }
})

test('salary histogram keeps the median and sample size without a percentile caption', () => {
  const html = renderToStaticMarkup(<AgentChart artifact={{ ...artifact, kind: 'histogram', stats: { quartiles: [60000, 75000, 90000], salary_samples: 2, vacancies: 4, employers: 1, regions: 1, confirmed: 4, likely: 0 } }} />)
  assert.match(html, /Медіана: 75\s000 ₽ · Вибірка: 2/)
  assert.doesNotMatch(html, /перцентиль|60\s000–90\s000/)
})

test('model HTML, images and unverified URLs cannot become active content', () => {
  const html = render({ ...base, text: '<script>alert(1)</script>\n\n<img src="https://evil.test/pixel">\n\n![pixel](https://evil.test/pixel) [unsafe](javascript:alert) [invented](https://evil.test/) [s999]' })
  assert.doesNotMatch(html, /<script|<img|href="(?:javascript:|https:\/\/evil)/)
  assert.match(html, /\[s999\]/)
})

test('charts share a collapsed exact-value table without duplicating the chart', () => {
  const chart = { ...artifact, companion_id: 'a2' }
  const table = { ...artifact, id: 'a2', kind: 'table' as const, companion_id: 'a1' }
  const html = render({ ...base, artifacts: [table, chart] })
  assert.equal((html.match(/class="ag-bars"/g) ?? []).length, 1)
  assert.equal((html.match(/<details/g) ?? []).length, 1)
  assert.match(html, /<table/)
})

test('legacy artifact placeholders do not add empty duplicate sections to the answer', () => {
  const html = render({ ...base, text: 'Висновок.\n\n## Графік найму\n\n[a1]\n\n## Обмеження\n\nПоточний зріз.', artifacts: [artifact] })
  assert.doesNotMatch(html, /\[a1\]|Графік найму/)
  assert.match(html, /Обмеження/)
  assert.match(html, /class="ag-bars"/)
})

test('long web excerpts remain available in a collapsed disclosure', () => {
  const html = render({ ...base, artifacts: [{ id: 'm1', kind: 'mentions', title: 'Публічні згадки', days: 7, items: [{ source_id: 's8', title: 'Новина', url: sources[1].url, text: 'Витяг із джерела. '.repeat(100), published_at: null }] }] })
  assert.match(html, /<details><summary>Повний витяг із джерела<\/summary>/)
  assert.doesNotMatch(html, /<details open/)
})

test('all design-system views render, including a one-segment donut and missing salaries', () => {
  const kinds: DataArtifact['kind'][] = ['table', 'bar', 'line', 'donut', 'stacked', 'heatmap', 'scatter', 'histogram', 'kpi', 'signals']
  for (const kind of kinds) {
    const rows = kind === 'line' || kind === 'stacked' ? [{ ...artifact.rows[0], id: '2026-10-01', label: '2026-10-01' }] : artifact.rows
    const html = renderToStaticMarkup(<MemoryRouter><AgentChart artifact={{ ...artifact, kind, rows }} /></MemoryRouter>)
    assert.ok(html.length > 40, kind)
    assert.doesNotMatch(html, /NaN|Infinity|Invalid Date/, kind)
  }
  const html = renderToStaticMarkup(<AgentChart artifact={{ ...artifact, kind: 'scatter', rows: [{ ...artifact.rows[0], median_salary: null }] }} />)
  assert.match(html, /Немає відомих зарплат/)
})
