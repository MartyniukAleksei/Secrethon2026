import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { ApiVacancyReview, ReviewConfidence } from '../api/types'
import { longDate } from '../domain/format'
import { Icon } from '../ui/Icon'
import './VacancyReviews.css'

const CONFIDENCE: Record<ReviewConfidence, string> = {
  high: 'Висока ймовірність', medium: 'Середня ймовірність', low: 'Низька ймовірність',
}

export function ReviewBadge({ source, review }: { source: 'human' | 'llm'; review?: ApiVacancyReview }) {
  const label = source === 'human' ? 'Human review' : 'LLM review'
  return (
    <span className={`badge review-badge ${review ? (review.confidence === 'high' ? 'info' : review.confidence === 'medium' ? 'warning' : '') : ''}`}
      title={review ? `${review.reviewed_by} · ${longDate(review.reviewed_at)}${review.comment ? ` · ${review.comment}` : ''}` : `${label} ще не виконано`}>
      {source === 'human' ? <Icon name="check" /> : <Icon name="spark" />}
      {label}: {review ? CONFIDENCE[review.confidence].toLowerCase() : 'не перевірено'}
    </span>
  )
}

export function VacancyReviews({ vacancyId, reviews, onSaved }: { vacancyId: number; reviews: ApiVacancyReview[]; onSaved: (review: ApiVacancyReview) => void }) {
  const human = reviews.find((r) => r.source === 'human')
  const llm = reviews.find((r) => r.source === 'llm')
  const [reviewer, setReviewer] = useState(human?.reviewed_by ?? '')
  const [confidence, setConfidence] = useState<ReviewConfidence>(human?.confidence ?? 'medium')
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'saving') return
    setStatus('saving')
    try {
      const review = await api.saveReview(vacancyId, { source: 'human', confidence, reviewed_by: reviewer.trim(), comment: comment.trim() || null })
      onSaved(review)
      setComment('')
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="panel vacancy-reviews">
      <div className="panel-head"><div><h3>Перевірка вакансії</h3><p>Ймовірність дотичності до ВПК</p></div></div>
      <div className="review-status-list">
        {(['human', 'llm'] as const).map((source) => {
          const review = source === 'human' ? human : llm
          return <div key={source}>
            <ReviewBadge source={source} review={review} />
            {review ? <p>{source === 'human' ? 'Перевірив' : 'Модель'}: {review.reviewed_by}<br />{longDate(review.reviewed_at)}{review.comment && <><br />{review.comment}</>}</p> : <p>{source === 'human' ? 'Ручну оцінку ще не збережено.' : 'Оцінка з’явиться після перевірки моделлю.'}</p>}
          </div>
        })}
      </div>
      <details className="review-editor">
        <summary>{human ? 'Додати нову ручну перевірку' : 'Перевірити вручну'}</summary>
        <form onSubmit={save}>
          <label>Хто перевірив<input className="input" value={reviewer} onChange={(e) => { setReviewer(e.target.value); setStatus('idle') }} required minLength={2} maxLength={120} placeholder="Ім’я або позивний" /></label>
          <label>Ймовірність дотичності до ВПК<div className="select"><select className="input" aria-label="Ймовірність дотичності до ВПК" value={confidence} onChange={(e) => { setConfidence(e.target.value as ReviewConfidence); setStatus('idle') }}>{Object.entries(CONFIDENCE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></label>
          <label>Пояснення<textarea value={comment} onChange={(e) => { setComment(e.target.value); setStatus('idle') }} maxLength={2000} rows={3} placeholder="Які ознаки підтверджують оцінку" /></label>
          <button className="btn btn-primary btn-sm" type="submit" disabled={status === 'saving'}>{status === 'saving' ? 'Зберігаємо…' : 'Зберегти Human review'}</button>
          <p className="review-save-status" role="status">{status === 'saved' ? 'Перевірку збережено для всіх користувачів.' : status === 'error' ? 'Не вдалося зберегти перевірку. Спробуй ще раз.' : ''}</p>
        </form>
      </details>
      {reviews.length > 0 && <details className="review-history"><summary>Історія перевірок ({reviews.length})</summary><ol>{reviews.map((r) => <li key={r.review_id}><ReviewBadge source={r.source} review={r} /><p>{r.reviewed_by} · {longDate(r.reviewed_at)}{r.comment && <><br />{r.comment}</>}</p></li>)}</ol></details>}
    </section>
  )
}
