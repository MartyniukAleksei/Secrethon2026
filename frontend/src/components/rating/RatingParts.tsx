import type { ApiCompanyRating, ApiRatingBreakdown, FocusKey, RatingTier, ScoreByFocus } from '../../api/types'
import { dec, pct } from '../../domain/format'
import { RATING_CLASS, RATING_FOCUSES, TIER_HINT, TIERS, VIA, WEAPON_FOCUS } from '../../domain/labels'
import { focusColor } from './rating'
import './Rating.css'

/** Importance, as stated on the rating page and in hints elsewhere. */
export const IMPORTANCE_DEFINITION =
  'Важливість — частка випуску ударних систем рф (БпЛА, ракети, КАБ), яка залежить від підприємства. Рахуємо за специфікаціями ГУР: система збирається з усіх своїх деталей, тому втрата постачальника обмежує випуск його найбільшою часткою серед деталей, які він постачає («вузьке місце»). Враховано підтвердженість зв’язку, масштаб підприємства і неповноту даних. Це оцінка залежності виробництва, а не вразливості для ураження.'

export function FocusDot({ focus }: { focus: string | null | undefined }) {
  return <i className="dot" style={{ background: focusColor(focus) }} aria-hidden />
}

/** Legend of the stacked bars. */
export function FocusLegend({ peer = true, focuses = RATING_FOCUSES }: { peer?: boolean; focuses?: FocusKey[] }) {
  return (
    <div className="rt-legend">
      {focuses.map((f) => <span key={f}><FocusDot focus={f} /> {WEAPON_FOCUS[f]}</span>)}
      {peer && <span><FocusDot focus={null} /> оцінка за аналогами</span>}
    </div>
  )
}

/**
 * Contribution of drones, missiles and KAB as one bar; its width is relative to `scale` (the
 * first row of the list). A peer estimate has no split: one grey bar. `only` keeps one category.
 */
export function FocusStack({ score, byFocus, scale, peer, only }: { score: number; byFocus: ScoreByFocus; scale: number; peer?: boolean; only?: FocusKey }) {
  const w = (v: number) => `${Math.min(100, (v / (scale || 1)) * 100)}%`
  const title = peer
    ? `Оцінка за аналогами: ${dec(score, 4)}`
    : RATING_FOCUSES.filter((f) => byFocus[f]).map((f) => `${WEAPON_FOCUS[f]}: ${dec(byFocus[f]!, 4)}`).join('\n')
  return (
    <div className="rt-stack" title={title} role="img" aria-label={title}>
      {peer ? (
        <span style={{ width: w(score), minWidth: score > 0 ? 2 : 0, background: 'var(--focus-peer)' }} />
      ) : (
        (only ? [only] : RATING_FOCUSES).map((f) => <span key={f} style={{ width: w(byFocus[f] ?? 0), background: focusColor(f) }} />)
      )}
    </div>
  )
}

/** Rank interval of the Monte Carlo runs on a log scale 1..N, with the median as a dot. */
export function RankInterval({ lo, med, hi, n }: { lo: number | null; med: number | null; hi: number | null; n: number }) {
  if (lo == null || hi == null || med == null || n < 2) return null
  const x = (r: number) => (Math.log(Math.max(1, r)) / Math.log(n)) * 100
  const title = `медіана ${med}, 90%: ${lo}–${hi}`
  return (
    <div className="rt-ci" title={title} aria-label={`Інтервал рангу: ${title}`}>
      <i className="track" />
      <i className="rng" style={{ left: `${x(lo)}%`, width: `${Math.max(1, x(hi) - x(lo))}%` }} />
      <i className="med" style={{ left: `${x(med)}%` }} />
    </div>
  )
}

export function TierBadge({ tier }: { tier: RatingTier }) {
  return <span className={`badge sm rt-tier ${tier}`} title={TIER_HINT[tier]}>{TIERS[tier]}</span>
}

/**
 * Shapley split of the score: the score without corrections, then what confirmation of the links
 * and the company's scale add or take away. The steps sum exactly to the score.
 */
export function ShapleyWaterfall({ shapley, score }: { shapley: NonNullable<ApiRatingBreakdown['shapley']>; score: number }) {
  const steps: [string, number][] = [
    ['Без поправок', shapley.base],
    ['Підтвердженість', shapley.confirmation],
    ['Масштаб', shapley.scale],
  ]
  const max = Math.max(shapley.base, shapley.base + shapley.confirmation, score, 1e-9)
  let run = 0
  return (
    <div className="rt-waterfall">
      {steps.map(([label, d], i) => {
        const from = i ? run : 0
        const to = i ? run + d : d
        run = to
        const color = i === 0 ? 'var(--primary)' : d >= 0 ? 'var(--success)' : 'var(--danger)'
        return (
          <div key={label} className="rt-wf-row">
            <span>{label}</span>
            <span className="rt-wf-track">
              <i style={{ left: `${(Math.min(from, to) / max) * 100}%`, width: `${Math.max(0.5, (Math.abs(to - from) / max) * 100)}%`, background: color }} />
            </span>
            <span className="num">{i && d >= 0 ? '+' : ''}{dec(d, 4)}</span>
          </div>
        )
      })}
      <div className="rt-wf-row total">
        <span>Бал</span>
        <span />
        <span className="num">{dec(score, 4)}</span>
      </div>
    </div>
  )
}

/** The systems the score comes from, each with the bottleneck the company holds it through. */
export function SystemsTable({ breakdown, limit = 15 }: { breakdown: ApiRatingBreakdown; limit?: number }) {
  const systems = breakdown.systems ?? []
  const total = breakdown.n_systems ?? systems.length
  return (
    <>
      <div className="table-wrap">
        <table className="data rt-systems">
          <thead>
            <tr><th>Система</th><th>Вузьке місце</th><th className="num" title="Частка випуску системи, що залежить від підприємства">D</th><th className="num">Внесок</th></tr>
          </thead>
          <tbody>
            {systems.slice(0, limit).map((s) => (
              <tr key={`${s.system}:${s.via}:${s.part}`}>
                <td className="rt-wrap"><FocusDot focus={s.focus} /> {s.name}</td>
                <td className="rt-wrap">
                  {VIA[s.via] ?? s.via}
                  {s.via === 'part' && s.part ? `: ${s.part}` : ''}
                  {s.n_suppliers > 0 && <span className="src"> ({s.n_suppliers} {s.n_suppliers === 1 ? 'відомий постачальник' : 'відомих постачальників'})</span>}
                </td>
                <td className="num">{dec(s.D, 2)}</td>
                <td className="num">{dec(s.value, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > Math.min(limit, systems.length) && <p className="src rt-note">Показано {Math.min(limit, systems.length)} з {total} систем.</p>}
    </>
  )
}

/** A peer estimate: probabilities of the company's role (JEV, calibrated) and its factors. */
export function PeerRoles({ peer, score }: { peer: NonNullable<ApiRatingBreakdown['peer']>; score: number }) {
  const roles = Object.entries(peer.roles).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])
  return (
    <div className="rt-peer">
      <p>Оцінка за аналогами: роль за JEV (відкалібрована).</p>
      <table className="data rt-roles">
        <tbody>
          {roles.map(([role, p]) => (
            <tr key={role}><td>{RATING_CLASS[role] ?? role}</td><td className="num">{pct(p)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="src">
        Очікувана залежність {dec(peer.g, 4)} × масштаб {dec(peer.scale, 2)} × P(ВПК) {dec(peer.p, 2)} ≈ {dec(peer.g * peer.scale * peer.p, 4)} (бал {dec(score, 4)})
      </p>
      {peer.category_evidence && <p className="src">Є знайдене підтвердження участі в категорії (без назви системи).</p>}
    </div>
  )
}

/** «Чому такий бал»: systems or the peer estimate, and the Shapley waterfall. */
export function RatingBreakdown({ rating, limit }: { rating: ApiCompanyRating; limit?: number }) {
  const b = rating.breakdown
  return (
    <div className="rt-breakdown">
      <div>
        {b.systems?.length ? (
          <>
            <h4>Внесок систем{b.class && <span className="badge sm">{RATING_CLASS[b.class] ?? b.class}</span>}</h4>
            <SystemsTable breakdown={b} limit={limit} />
          </>
        ) : b.peer ? (
          <PeerRoles peer={b.peer} score={rating.score} />
        ) : (
          <p className="src">Розкладу балу немає.</p>
        )}
      </div>
      {b.shapley && !b.peer && (
        <div>
          <h4>Поправки (Шеплі)</h4>
          <ShapleyWaterfall shapley={b.shapley} score={rating.score} />
        </div>
      )}
    </div>
  )
}
