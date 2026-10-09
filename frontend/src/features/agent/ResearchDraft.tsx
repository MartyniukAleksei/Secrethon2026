import { useState } from 'react'
import { approveResearch } from './research'
import type { AgentPageContext, AgentResponse } from './types'

export function ResearchDraft({ response, question, context, parentId }: { response: AgentResponse; question: string; context: AgentPageContext; parentId?: string }) {
  const [review, setReview] = useState(false)
  const [title, setTitle] = useState(question.slice(0, 120))
  const [acknowledged, setAcknowledged] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const initial = response.sections?.find(s => s.kind === 'analysis')?.text ?? ''
  const [conclusion, setConclusion] = useState(initial)
  const [excluded, setExcluded] = useState<string[]>([])
  const selectedSources = response.sources.filter(s => !excluded.includes(s.id))
  const sections = response.sections?.map(s => s.kind === 'analysis' ? { ...s, text: conclusion, source_ids: [...new Set([...conclusion.matchAll(/\[(s\d+)\]/g)].map(m => m[1]))] } : s).filter(s => s.text.trim())
  if (conclusion.trim() && !response.sections?.some(s => s.kind === 'analysis')) sections?.push({ kind: 'analysis', text: conclusion, source_ids: [...conclusion.matchAll(/\[(s\d+)\]/g)].map(m => m[1]) })
  const text = sections?.length ? sections.map(s => s.text).join('\n\n') : response.text + (conclusion.trim() ? '\n\n' + conclusion : '')
  const cited = [...text.matchAll(/\[(s\d+)\]/g)].map(m => m[1]).concat(sections?.flatMap(s => s.source_ids) ?? [])
  const broken = cited.some(id => !selectedSources.some(s => s.id === id))
  const removable = (id: string) => !cited.includes(id) && !response.artifacts.some(a => a.kind === 'mentions' ? false : a.kind === 'relations' ? a.items.some(i => i.source_id === id) : a.rows.some(r => r.source_id === id))

  function approve() {
    if (!acknowledged || !title.trim() || broken) return
    try {
      const sources = selectedSources
      const artifacts = response.artifacts.map(a => a.kind === 'mentions' ? { ...a, items: a.items.filter(i => !excluded.includes(i.source_id)) } : a)
      approveResearch({ title: title.trim(), question, context, parent_id: parentId,
        response: { ...response, text, sections, sources, artifacts } })
      setSaved(true); setReview(false); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Не вдалося зберегти дослідження.') }
  }

  return <div className="ag-research-draft">
    {saved ? <p className="ag-saved-status">Схвалено й збережено на цьому пристрої. Відкрити можна у «Дослідженнях».</p> : <button className="btn btn-sm" type="button" onClick={() => setReview(v => !v)}>{review ? 'Згорнути перегляд' : 'Переглянути перед збереженням'}</button>}
    {review && <div className="ag-review" role="region" aria-label="Ручний апрув дослідження">
      <b>Перевір дослідження</b>
      <small>Відповідь вище — чернетка. Збережеться її переглянута версія разом із даними й джерелами.</small>
      <label>Назва<input className="input" maxLength={120} value={title} onChange={e => { setTitle(e.target.value); setAcknowledged(false) }} /></label>
      <label>Висновок / примітка<textarea rows={4} maxLength={8000} value={conclusion} onChange={e => { setConclusion(e.target.value); setAcknowledged(false) }} /></label>
      <small>Підприємство: {context.company_id ?? (context.map_scope?.mode === 'selection' ? context.map_scope.employer_ids.join(', ') : 'область / фільтри')}. Період: {context.days || 'увесь доступний'}. Зріз: {response.as_of ? new Date(response.as_of).toLocaleDateString('uk-UA') : 'не вказано'}.</small>
      <details><summary>Контекст і використані дані</summary><pre>{JSON.stringify({ context, totals: response.scope_totals }, null, 2)}</pre></details>
      <b>Джерела для збереження</b>
      {response.sources.map(s => <label className="ag-source-check" key={s.id}>
        <input type="checkbox" checked={!excluded.includes(s.id)} disabled={!removable(s.id)} onChange={() => { setExcluded(ids => ids.includes(s.id) ? ids.filter(i => i !== s.id) : [...ids, s.id]); setAcknowledged(false) }} />
        <span>[{s.id}] {s.title}<small>{s.origin === 'public_web' ? 'Відкрите джерело · збіг потребує перевірки' : 'Запис платформи'}{!removable(s.id) && ' · використано у відповіді'}{s.retrieved_at && ` · отримано ${new Date(s.retrieved_at).toLocaleDateString('uk-UA')}`}</small></span>
      </label>)}
      <small>Використані докази зберігаються разом із твердженнями. Апрув збереження не підтверджує автоматично вебматеріали.</small>
      <label className="ag-source-check"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /><span>Я переглянув відповідь і джерела та схвалюю збереження цієї версії.</span></label>
      {broken && <p role="alert">У висновку є посилання на відсутнє джерело. Виправ його перед збереженням.</p>}
      {error && <p role="alert">{error}</p>}
      <button className="btn btn-primary btn-sm" type="button" disabled={!acknowledged || !title.trim() || broken} onClick={approve}>Схвалити й зберегти</button>
      <button className="btn btn-sm" type="button" onClick={() => setReview(false)}>Скасувати</button>
    </div>}
  </div>
}
