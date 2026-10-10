import type { AgentPageContext, AgentResponse } from './types'

const KEY = 'secrethon.approved-research.v1'
export type Research = { schema_version: 1; id: string; parent_id?: string; employer_id?: number | null; title: string; question: string; context: AgentPageContext; response: AgentResponse; approved_at: string; storage?: 'database' }

export function researchContext(record: Research): string {
  const value = { title: record.title.slice(0, 120), company_id: record.employer_id ?? record.context.company_id,
    approved_at: record.approved_at.slice(0, 100), text: record.response.text.slice(0, 7000),
    sources: record.response.sources.map(s => ({ id: s.id, title: s.title.slice(0, 120), url: s.url, origin: s.origin, verification: s.verification })) }
  while (JSON.stringify(value).length > 12000 && value.sources.length) value.sources.pop()
  while (JSON.stringify(value).length > 12000 && value.text.length) value.text = value.text.slice(0, -500)
  return JSON.stringify(value)
}

async function researchRequest(url: string, init?: RequestInit): Promise<Research | Research[]> {
  const result = await fetch(url, init)
  if (!result.ok) {
    const error = await result.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Не вдалося зберегти або завантажити дослідження з БД.')
  }
  return result.json()
}

export async function saveResearchToDatabase(record: Research): Promise<Research> {
  const saved = await researchRequest('/api/agent/research', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, title: record.title, question: record.question,
      context: record.context, response: record.response, parent_id: record.parent_id,
      employer_id: record.employer_id ?? record.context.company_id, approved: true }),
  }) as Research
  window.dispatchEvent(new Event('research-updated'))
  return { ...saved, storage: 'database' }
}

export async function readDatabaseResearch(): Promise<Research[]> {
  return (await researchRequest('/api/agent/research') as Research[]).map(record => ({ ...record, storage: 'database' }))
}

export function readResearch(): Research[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(data)) return []
    return data.filter((r): r is Research => r?.schema_version === 1 && typeof r.id === 'string' && typeof r.title === 'string' &&
      typeof r.approved_at === 'string' && typeof r.response?.text === 'string' && Array.isArray(r.response.sources) && Array.isArray(r.response.artifacts))
  } catch { return [] }
}

export function createResearch(value: Omit<Research, 'schema_version' | 'id' | 'approved_at'>): Research {
  return { ...value, schema_version: 1, id: crypto.randomUUID(), approved_at: new Date().toISOString() }
}

export function approveResearch(value: Omit<Research, 'schema_version' | 'id' | 'approved_at'>): Research {
  const records = readResearch()
  if (records.length >= 30) throw new Error('Збережено 30 досліджень. Експортуй і видали непотрібне перед збереженням нового.')
  const record = createResearch(value)
  try { localStorage.setItem(KEY, JSON.stringify([record, ...records])) }
  catch { throw new Error('Бракує місця або браузер заборонив збереження. Дослідження ще не збережено.') }
  window.dispatchEvent(new Event('research-updated'))
  return record
}

export function deleteResearch(id: string) {
  localStorage.setItem(KEY, JSON.stringify(readResearch().filter(r => r.id !== id)))
  window.dispatchEvent(new Event('research-updated'))
}

export function exportResearch(record: Research) {
  const labels = { database: 'За даними платформи', public_web: 'З відкритих джерел', analysis: 'Висновок агента' }
  const sections = record.response.sections?.length ? record.response.sections.map(s => `## ${labels[s.kind]}\n\n${s.text}`).join('\n\n') : record.response.text
  const artifacts = record.response.artifacts.map(a => {
    if (a.kind === 'table') return `## ${a.title}\n\n| Назва | ${a.unit} |\n|---|---|\n` + a.rows.map(r => `| ${r.label.replaceAll('|', '\\|')} | ${r.value ?? 'Немає даних'} |`).join('\n')
    if (a.kind === 'relations') return `## ${a.title}\n\n` + a.items.map(r => `- ${r.name}: ${r.kind}, напрям ${r.direction}`).join('\n')
    if (a.kind === 'mentions') return `## ${a.title}\n\n` + a.items.map(r => `- [${r.title}](${r.url}): ${r.text}`).join('\n')
    return ''
  }).filter(Boolean).join('\n\n')
  const sources = record.response.sources.map(s => `- [${s.id}] ${s.title}: ${s.url.startsWith('/') ? location.origin + s.url : s.url}\n  Походження: ${s.origin === 'public_web' ? 'вебпошук, потребує перевірки' : 'запис платформи'}; отримано: ${s.retrieved_at ?? 'невідомо'}; опубліковано: ${s.published_at ?? 'невідомо'}${s.excerpt ? `\n  Фрагмент: ${s.excerpt}` : ''}`).join('\n')
  const content = `# ${record.title}\n\nПитання: ${record.question}\n\nСхвалено: ${record.approved_at}\n\nЗріз бази: ${record.response.as_of ?? 'не вказано'}\n\n${sections}\n\n${artifacts}\n\n## Джерела\n\n${sources}\n\n## Контекст\n\n\`\`\`json\n${JSON.stringify(record.context, null, 2)}\n\`\`\`\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `research-${record.id}.md`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
