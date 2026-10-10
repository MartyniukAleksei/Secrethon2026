import type { ApiFinance } from '../../api/types'
import { rub } from '../../domain/format'

const METRICS: Record<string, string> = {
  revenue: 'Виручка',
  assets: 'Активи',
  consolidated_revenue: 'Виручка групи',
  net_profit: 'Чистий прибуток',
  investment: 'Інвестиції',
}
const OTHER_SOURCES: Record<string, string> = { vpk_atlas: 'атлас ВПК' }

export const HIDDEN_ACCOUNTS =
  'У державному реєстрі бухзвітності (ГІР БО) звітності немає. Так обмежують доступ організації зведеного реєстру ОПК і стратегічні підприємства (постанова уряду рф № 1102). Серед підприємств ВПК бази так у 69%, серед цивільних — у 10%.'

/** Red mark for a company whose ГИР БО accounts are hidden (none, or none after some year). */
export function HiddenAccountsBadge({ status, lastPeriod }: { status: string | null | undefined; lastPeriod?: number | null }) {
  if (status !== 'not_found' && status !== 'stopped') return null
  const title = status === 'stopped' && lastPeriod ? `Звітність публікувалася до ${lastPeriod} року, потім прихована` : HIDDEN_ACCOUNTS
  return <span className="badge sm hostile" title={title}>звітність прихована</span>
}

/**
 * Revenue and total assets by year from the official filings (ГИР БО, RAS), and whether the
 * filings are hidden. `compact`: the last five years of revenue only.
 */
export function FinanceBlock({ finance, compact }: { finance: ApiFinance; compact?: boolean }) {
  const gir = finance.rows.filter((r) => r.source === 'gir_bo')
  const other = finance.rows.filter((r) => r.source !== 'gir_bo')
  const years = [...new Set(gir.map((r) => r.year))].sort((a, b) => a - b).slice(compact ? -5 : undefined)
  const value = (year: number, metric: string) => gir.find((r) => r.year === year && r.metric === metric)?.amount
  const maxRevenue = Math.max(0, ...years.map((y) => value(y, 'revenue') ?? 0))
  const d = finance.disclosure
  const girUrl = gir.at(-1)?.source_url
  return (
    <div className="rt-finance">
      {d?.status === 'not_found' && (
        <p className="rt-hidden"><HiddenAccountsBadge status="not_found" /> {HIDDEN_ACCOUNTS}</p>
      )}
      {d?.status === 'stopped' && (
        <p className="rt-hidden">
          <HiddenAccountsBadge status="stopped" lastPeriod={d.last_period} /> Звітність публікувалася до {d.last_period} року, потім прихована.
        </p>
      )}
      {years.length > 0 ? (
        <>
          <table className="data rt-fin-table">
            <thead>
              <tr><th>Рік</th><th className="num">Виручка</th>{!compact && <th className="num">Активи</th>}<th aria-hidden /></tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const revenue = value(y, 'revenue')
                const assets = value(y, 'assets')
                return (
                  <tr key={y}>
                    <td>{y}</td>
                    <td className="num">{revenue != null ? rub(revenue) : '—'}</td>
                    {!compact && <td className="num">{assets != null ? rub(assets) : '—'}</td>}
                    <td className="rt-fin-bar">
                      {revenue != null && maxRevenue > 0 && <i style={{ width: `${Math.max(2, (revenue / maxRevenue) * 100)}%` }} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="src rt-note">
            Джерело: {girUrl ? <a href={girUrl} target="_blank" rel="noreferrer noopener">ГІР БО (ФНС)</a> : 'ГІР БО (ФНС)'}, бухзвітність РСБУ юрособи.
          </p>
        </>
      ) : (
        !d || d.status === 'found' ? <p className="src">Даних бухзвітності немає.</p> : null
      )}
      {!compact && other.length > 0 && (
        <ul className="rt-fin-other">
          {other.map((r) => (
            <li key={`${r.year}:${r.metric}:${r.source}`}>
              {METRICS[r.metric] ?? r.metric}, {r.year}: <b>{rub(r.amount)}</b>{' '}
              <a className="src" href={r.source_url} target="_blank" rel="noreferrer noopener">{OTHER_SOURCES[r.source] ?? r.source}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The «Фінанси» panel of a company page. */
export function FinancePanel({ finance }: { finance: ApiFinance }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Фінанси</h3>
          <p>Виручка й активи за річною бухзвітністю з державного реєстру ГІР БО.</p>
        </div>
      </div>
      <div className="rt-pad"><FinanceBlock finance={finance} /></div>
    </section>
  )
}
