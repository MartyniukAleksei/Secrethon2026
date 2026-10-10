import { Link } from 'react-router'
import type { ApiCompanyRating } from '../../api/types'
import { dec, fmt, pct } from '../../domain/format'
import { RATING_CLASS, RATING_FOCUSES, VIA } from '../../domain/labels'
import { FocusDot, FocusLegend, FocusStack, IMPORTANCE_DEFINITION, TierBadge } from './RatingParts'

/** «Місце в рейтингу» on a company page: rank, interval, evidence, the main systems. */
export function RatingCard({ rating, companyId }: { rating: ApiCompanyRating | null; companyId: number }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3 title={IMPORTANCE_DEFINITION} className="rt-hint">Місце в рейтингу важливості</h3>
        {rating && <TierBadge tier={rating.tier} />}
      </div>
      {!rating ? (
        <p className="empty-row">Не входить до рейтингу: не класифіковано як ВПК і немає зв’язків постачання.</p>
      ) : (
        <div className="rt-card">
          <div className="rt-card-rank">
            <strong>#{fmt(rating.rank)}</strong>
            <span>з {fmt(rating.ranked)}</span>
            {rating.rank_lo != null && rating.rank_hi != null && (
              <small title="Ранг у 90% прогонів Монте-Карло зі зміненими параметрами моделі">90%: {fmt(rating.rank_lo)}–{fmt(rating.rank_hi)}</small>
            )}
          </div>
          <div className="rt-card-body">
            <div className="rt-card-score">
              <span className="src">Бал {dec(rating.score, 4)}</span>
              <FocusStack score={rating.score} byFocus={rating.score_by_focus} scale={rating.score} peer={rating.tier === 'peer'} />
              {rating.tier !== 'peer' && <FocusLegend peer={false} focuses={RATING_FOCUSES.filter((f) => rating.score_by_focus[f])} />}
            </div>
            <TopReasons rating={rating} />
            <Link className="link-btn rt-how" to={`/rating?company=${companyId}`}>Як порахували →</Link>
          </div>
        </div>
      )}
    </section>
  )
}

function TopReasons({ rating }: { rating: ApiCompanyRating }) {
  const b = rating.breakdown
  if (b.systems?.length) {
    return (
      <ul className="rt-top-systems">
        {b.systems.slice(0, 3).map((s) => (
          <li key={`${s.system}:${s.via}`}>
            <FocusDot focus={s.focus} /> <b>{s.name}</b>
            <span className="src"> — {VIA[s.via] ?? s.via}{s.via === 'part' && s.part ? `: ${s.part}` : ''}</span>
          </li>
        ))}
      </ul>
    )
  }
  const roles = Object.entries(b.peer?.roles ?? {}).sort((x, y) => y[1] - x[1])
  if (!roles.length) return null
  const [role, p] = roles[0]
  return <p className="src">Оцінка за аналогами: найімовірніша роль — {RATING_CLASS[role] ?? role} ({pct(p)}).</p>
}
