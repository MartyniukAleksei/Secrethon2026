import { fmt, money } from '../../domain/format'
import { categoryOf } from '../../domain/labels'
import type { TabProps } from './CompanyPage'

export function SalariesTab({ employer: e }: TabProps) {
  const paid = e.professions.filter((p) => p.median_salary != null)
  const max = Math.max(1, ...paid.map((p) => p.median_salary ?? 0))
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>Зарплати за професіями</h3>
          <p>Медіана по підприємству: {money(e.median_salary)}</p>
        </div>
      </div>
      {paid.length === 0 ? (
        <p className="empty-row">У вакансіях цього роботодавця зарплату не вказано.</p>
      ) : (
        <div className="bars" style={{ padding: '0 10px 10px' }}>
          {paid.map((p) => (
            <div key={p.title} className="bar-row">
              <span title={p.title}>{p.title}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(((p.median_salary ?? 0) / max) * 100).toFixed(0)}%`, background: categoryOf(e.category).color }} />
              </div>
              <b>{fmt((p.median_salary ?? 0) / 1000)}</b>
            </div>
          ))}
        </div>
      )}
      <p className="src" style={{ padding: '0 10px 8px' }}>Тисяч ₽ на місяць, медіана; лише вакансії з місячною зарплатою в рублях.</p>
    </div>
  )
}
