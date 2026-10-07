import { money } from '../../domain/format'
import { categoryOf } from '../../domain/labels'
import type { TabProps } from './CompanyPage'

export function SalariesTab({ employer: e }: TabProps) {
  const paid = e.professions.filter((p) => p.median_salary != null)
  const max = Math.max(1, ...paid.map((p) => p.median_salary ?? 0))
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Зарплати за професіями</h3>
          <p>Медіана за місяць, тис. ₽ · по підприємству: {money(e.median_salary)} / місяць</p>
        </div>
      </div>
      {paid.length === 0 ? (
        <p className="empty-row">Серед показаних посад немає даних про місячну зарплату в рублях.</p>
      ) : (
        <div className="bars salary-bars" style={{ padding: '0 10px 10px' }}>
          {paid.map((p) => (
            <div key={p.title} className="bar-row">
              <span title={p.title}>{p.title}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(((p.median_salary ?? 0) / max) * 100).toFixed(0)}%`, background: categoryOf(e.category).color }} />
              </div>
              <b title={`${money(p.median_salary)} на місяць`}>
                {((p.median_salary ?? 0) / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} тис. ₽
              </b>
            </div>
          ))}
        </div>
      )}
      <p className="analytics-note">
        Показано зарплати для найпоширеніших посад (до 15), лише за вакансіями ВПК із місячною зарплатою в рублях.
        Якщо вказано діапазон, для розрахунку береться його середина; якщо одна межа — її значення.
      </p>
    </section>
  )
}
