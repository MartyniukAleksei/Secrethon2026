import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client'
import type { ApiEmployerReview, ApiEmployerReviewInput, HumanSanctions, HumanSource, HumanVpk, Reliability } from '../api/types'
import { longDate } from '../domain/format'
import { autoVpk, CATEGORIES, categoryOf, HUMAN_SANCTIONS, HUMAN_SOURCES, HUMAN_VPK, RELIABILITY, sourceName } from '../domain/labels'
import type { Employer } from '../domain/types'
import { Icon } from '../ui/Icon'
import './VacancyReviews.css'
import './EmployerHumanReview.css'

type Draft = Omit<ApiEmployerReviewInput, 'reviewed_by' | 'comment'>
const EMPTY: Draft = { sources: null, reliability: null, category: null, sanctions: null, vpk: null }

/** What a review changed, in the card's wording. */
function summary(r: ApiEmployerReview): string[] {
  return [
    r.sources && `Джерела: ${r.sources.map((s) => HUMAN_SOURCES[s]).join(', ')}`,
    r.reliability && `Надійність: ${r.reliability} · ${RELIABILITY[r.reliability]}`,
    r.category && `Напрям: ${categoryOf(r.category).name}`,
    r.sanctions && `Санкції: ${HUMAN_SANCTIONS[r.sanctions]}`,
    r.vpk && `ВПК: ${HUMAN_VPK[r.vpk]}`,
  ].filter((x): x is string => !!x)
}

function Choice<T extends string>({ label, auto, value, options, onChange }: { label: string; auto: string; value: T | null; options: Record<T, ReactNode>; onChange: (v: T | null) => void }) {
  return (
    <label>{label}
      <div className="select">
        <select className="input" value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as T | null)}>
          <option value="">Авто: {auto}</option>
          {(Object.entries(options) as [T, ReactNode][]).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </div>
    </label>
  )
}

export function EmployerHumanReview({ employer: e, reviews, onSaved }: { employer: Employer; reviews: ApiEmployerReview[]; onSaved: (review: ApiEmployerReview) => void }) {
  const current = e.human_review
  // A new revision is a full snapshot, so the form starts from the one in effect.
  const [draft, setDraft] = useState<Draft>(current ? { sources: current.sources, reliability: current.reliability, category: current.category, sanctions: current.sanctions, vpk: current.vpk } : EMPTY)
  const [reviewer, setReviewer] = useState(current?.reviewed_by ?? '')
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const empty = Object.values(draft).every((v) => v == null)

  const change = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setStatus('idle')
  }
  const toggleSource = (s: HumanSource) => {
    const set = new Set(draft.sources ?? [])
    if (set.has(s)) set.delete(s)
    else set.add(s)
    change({ sources: set.size ? (Object.keys(HUMAN_SOURCES) as HumanSource[]).filter((k) => set.has(k)) : null })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'saving' || empty) return
    setStatus('saving')
    try {
      const review = await api.saveEmployerReview(e.id, { ...draft, reviewed_by: reviewer.trim(), comment: comment.trim() || null })
      onSaved(review)
      setComment('')
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  const autoSources = `${e.source === 'trudvsem' ? 'trudvsem.ru' : sourceName(e.source)}${e.gur_company_id != null ? ', ГУР' : ''}`
  const autoSanctions = e.sanctions_count > 0 ? `під санкціями (${e.sanctions_count})` : e.gur_company_id != null ? 'не зафіксовано' : 'немає даних'

  return (
    <section className="panel employer-human-review">
      <div className="panel-head"><div><h3>Human review</h3><p>Ручна перевірка автоматично зібраних даних</p></div></div>
      <div className="review-status-list">
        {current
          ? <div>
              <span className="badge info review-badge"><Icon name="check" />Перевірено вручну</span>
              <p>{current.reviewed_by} · {longDate(current.reviewed_at)}<br />{summary(current).join('\n')}{current.comment && <><br />{current.comment}</>}</p>
            </div>
          : <p>Усі значення на картці зібрані й розмічені автоматично.</p>}
      </div>
      <details className="review-editor">
        <summary>{current ? 'Додати нову ревізію' : 'Перевірити вручну'}</summary>
        <form onSubmit={save}>
          <fieldset className="human-sources">
            <legend>Джерело інформації <span>(авто: {autoSources})</span></legend>
            {(Object.entries(HUMAN_SOURCES) as [HumanSource, string][]).map(([key, name]) => (
              <label key={key} className="check"><input type="checkbox" checked={draft.sources?.includes(key) ?? false} onChange={() => toggleSource(key)} /> {name}</label>
            ))}
          </fieldset>
          <Choice<Reliability> label="Надійність джерела" auto="не оцінено" value={draft.reliability} onChange={(reliability) => change({ reliability })}
            options={Object.fromEntries(Object.entries(RELIABILITY).map(([k, v]) => [k, `${k} · ${v}`])) as Record<Reliability, string>} />
          <Choice label="Напрям діяльності" auto={categoryOf(e.category).name.toLowerCase()} value={draft.category} onChange={(category) => change({ category })}
            options={Object.fromEntries(CATEGORIES.map((c) => [c.key, c.name]))} />
          <Choice<HumanSanctions> label="Санкції" auto={autoSanctions} value={draft.sanctions} onChange={(sanctions) => change({ sanctions })} options={HUMAN_SANCTIONS} />
          <Choice<HumanVpk> label="Дотичність до ВПК" auto={HUMAN_VPK[autoVpk(e)].toLowerCase()} value={draft.vpk} onChange={(vpk) => change({ vpk })} options={HUMAN_VPK} />
          <label>Хто перевірив<input className="input" value={reviewer} onChange={(ev) => { setReviewer(ev.target.value); setStatus('idle') }} required minLength={2} maxLength={120} placeholder="Ім’я або позивний" /></label>
          <label>Пояснення<textarea value={comment} onChange={(ev) => { setComment(ev.target.value); setStatus('idle') }} maxLength={2000} rows={3} placeholder="Чим підтверджено: реєстр, сайт, санкційний список…" /></label>
          <button className="btn btn-primary btn-sm" type="submit" disabled={status === 'saving' || empty}>{status === 'saving' ? 'Зберігаємо…' : 'Зберегти Human review'}</button>
          <p className="review-save-status" role="status">
            {status === 'saved' ? 'Перевірку збережено для всіх користувачів.' : status === 'error' ? 'Не вдалося зберегти перевірку. Спробуй ще раз.' : empty ? 'Обери хоча б одне значення — решта лишиться автоматичною.' : ''}
          </p>
        </form>
      </details>
      {reviews.length > 0 && (
        <details className="review-history">
          <summary>Історія перевірок ({reviews.length})</summary>
          <ol>{reviews.map((r) => <li key={r.review_id}><p><b>{r.reviewed_by}</b> · {longDate(r.reviewed_at)}<br />{summary(r).join('\n')}{r.comment && <><br />{r.comment}</>}</p></li>)}</ol>
        </details>
      )}
    </section>
  )
}
