import { useRef, useState } from 'react'
import { approveResearch, createResearch, saveResearchToDatabase, type Research } from './research'
import type { AgentPageContext, AgentResponse } from './types'
import { useData } from '../../data/DataContext'

const citationIds = (text: string) => [...text.matchAll(/\[(s\d+(?:\s*,\s*s\d+)*)\]/g)].flatMap(match => match[1].split(/\s*,\s*/))

export function ResearchDraft({ response, question, context, parentId, onRemember }: {
  response: AgentResponse; question: string; context: AgentPageContext; parentId?: string
  onRemember?: (record: Research) => void
}) {
  const { employers } = useData()
  const [review, setReview] = useState(false)
  const [title, setTitle] = useState(question.slice(0, 120))
  const [acknowledged, setAcknowledged] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveChat, setSaveChat] = useState(!!onRemember)
  const [saveDatabase, setSaveDatabase] = useState(false)
  const [verification, setVerification] = useState<Record<string, string>>(() => Object.fromEntries(
    response.sources.filter(s => s.verification === 'user_verified').map(s => [s.id, 'user_verified'])
  ))
  const [conclusion, setConclusion] = useState(response.sections?.find(s => s.kind === 'analysis')?.text ?? '')
  const [excluded, setExcluded] = useState<string[]>([])
  const pendingRecord = useRef<{ signature: string; record: Research } | null>(null)
  const companyIds = [...new Set(response.sources.flatMap(s => {
    const match = /^\/companies\/(\d+)$/.exec(s.url)
    return match ? [Number(match[1])] : []
  }))]
  const [company, setCompany] = useState(String(response.map_action?.employer_id ?? (companyIds.length === 1 ? companyIds[0] : context.company_id) ?? ''))
  const selectedSources = response.sources.filter(s => !excluded.includes(s.id)).map(s => ({ ...s,
    origin: s.origin ?? 'database', verification: s.origin === 'public_web' ? verification[s.id] : 'database_record',
  }))
  const uncheckedWeb = selectedSources.some(s => s.origin === 'public_web' && !s.verification)
  const invalidCompany = !!company.trim() && (!Number.isSafeInteger(Number(company)) || Number(company) <= 0)
  const sections = response.sections?.map(s => s.kind === 'analysis' ? { ...s, text: conclusion, source_ids: [...new Set(citationIds(conclusion))] } : s).filter(s => s.text.trim())
  if (conclusion.trim() && !response.sections?.some(s => s.kind === 'analysis')) sections?.push({ kind: 'analysis', text: conclusion, source_ids: citationIds(conclusion) })
  const text = sections?.length ? sections.map(s => s.text).join('\n\n') : response.text + (conclusion.trim() ? '\n\n' + conclusion : '')
  const cited = citationIds(text).concat(sections?.flatMap(s => s.source_ids) ?? [])
  const broken = cited.some(id => !selectedSources.some(s => s.id === id))
  const removable = (id: string) => !cited.includes(id) && !response.artifacts.some(a => a.kind === 'mentions' ? false : a.kind === 'relations' ? a.items.some(i => i.source_id === id) : a.rows.some(r => r.source_id === id))
  const canSave = acknowledged && title.trim() && !broken && !uncheckedWeb && !invalidCompany && (saveChat || saveDatabase) && !saving

  async function approve() {
    if (!canSave) return
    setSaving(true); setError('')
    try {
      const artifacts = response.artifacts.map(a => a.kind === 'mentions' ? { ...a, items: a.items.filter(i => !excluded.includes(i.source_id)) } : a)
      const value = { title: title.trim(), question, context, parent_id: parentId,
        employer_id: company.trim() ? Number(company) : null,
        response: { ...response, text, sections, sources: selectedSources, artifacts } }
      const signature = JSON.stringify(value)
      if (pendingRecord.current?.signature !== signature) pendingRecord.current = { signature,
        record: createResearch(value) }
      let record = pendingRecord.current.record
      if (saveDatabase) record = await saveResearchToDatabase(record)
      else record = approveResearch(value)
      if (saveChat) onRemember?.(record)
      setSaved([saveChat ? 'Додано до контексту чату' : '', saveDatabase ? 'збережено в БД' : 'збережено на цьому пристрої'].filter(Boolean).join(' · '))
      setReview(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не вдалося зберегти дослідження.') }
    finally { setSaving(false) }
  }

  return <div className="ag-research-draft">
    {saved ? <p className="ag-saved-status" role="status">{saved}.</p> : <button className="btn btn-sm" type="button" onClick={() => setReview(v => !v)}>{review ? 'Згорнути перегляд' : 'Переглянути перед збереженням'}</button>}
    {review && <fieldset className="ag-review" disabled={saving} aria-label="Ручний апрув дослідження">
      <b>Перевір дослідження</b>
      <small>Схвали цю версію та обери, куди її зберегти.</small>
      <label>Назва<input className="input" maxLength={120} value={title} onChange={e => { setTitle(e.target.value); setAcknowledged(false) }} /></label>
      <label>Висновок / примітка<textarea rows={4} maxLength={8000} value={conclusion} onChange={e => { setConclusion(e.target.value); setAcknowledged(false) }} /></label>
      <label>Підприємство для збереження<select className="input" value={company} onChange={e => { setCompany(e.target.value); setAcknowledged(false) }}>
        <option value="">Загальне дослідження</option>
        {employers.map(employer => <option key={employer.id} value={employer.id}>{employer.name}</option>)}
      </select></label>
      <small>Період: {context.days || 'увесь доступний'}. Зріз: {response.as_of ? new Date(response.as_of).toLocaleDateString('uk-UA') : 'не вказано'}.</small>
      <details><summary>Контекст і використані дані</summary><pre>{JSON.stringify({ context, totals: response.scope_totals }, null, 2)}</pre></details>
      <b>Джерела для збереження</b>
      {response.sources.map(s => <div key={s.id}>
        <label className="ag-source-check">
          <input type="checkbox" checked={!excluded.includes(s.id)} disabled={!removable(s.id)} onChange={() => { setExcluded(ids => ids.includes(s.id) ? ids.filter(i => i !== s.id) : [...ids, s.id]); setAcknowledged(false) }} />
          <span>[{s.id}] {s.title}<small>{s.origin === 'public_web' ? 'Відкрите джерело' : 'Запис платформи'}{!removable(s.id) && ' · використано у відповіді'}</small></span>
        </label>
        {s.origin === 'public_web' && !excluded.includes(s.id) && <label>Чи перевірив ти це джерело?
          <a href={s.url} target="_blank" rel="noopener noreferrer">Відкрити джерело</a>
          <select className="input" aria-label={`Перевірка джерела ${s.id}`} value={verification[s.id] ?? ''} onChange={e => { setVerification(v => ({ ...v, [s.id]: e.target.value })); setAcknowledged(false) }}>
            <option value="">Обери статус</option>
            <option value="unverified">Ні, зберегти як неперевірене</option>
            <option value="user_verified">Так, я перевірив джерело та твердження</option>
          </select>
        </label>}
      </div>)}
      <small>Схвалення збереження не підтверджує вебінформацію. Обраний статус збережеться з джерелом.</small>
      {onRemember && <label className="ag-source-check"><input type="checkbox" checked={saveChat} onChange={e => { setSaveChat(e.target.checked); setAcknowledged(false) }} /><span>Додати до контексту цього чату</span></label>}
      <label className="ag-source-check"><input type="checkbox" checked={saveDatabase} onChange={e => { setSaveDatabase(e.target.checked); setAcknowledged(false) }} /><span>Зберегти в БД для наступних досліджень</span></label>
      <label className="ag-source-check"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /><span>Я переглянув відповідь і джерела та схвалюю збереження цієї версії.</span></label>
      {uncheckedWeb && <p>Обери статус перевірки кожного вебджерела.</p>}
      {invalidCompany && <p role="alert">Вкажи коректний ID підприємства або залиш поле порожнім.</p>}
      {broken && <p role="alert">У висновку є посилання на відсутнє джерело. Виправ його перед збереженням.</p>}
      {error && <p role="alert">{error}</p>}
      <button className="btn btn-primary btn-sm" type="button" disabled={!canSave} onClick={() => void approve()}>{saving ? 'Збереження…' : 'Схвалити й зберегти'}</button>
      <button className="btn btn-sm" type="button" onClick={() => setReview(false)}>Скасувати</button>
    </fieldset>}
  </div>
}
