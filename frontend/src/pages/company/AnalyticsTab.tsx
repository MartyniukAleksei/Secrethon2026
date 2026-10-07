import { Link } from 'react-router'
import { LineChart } from '../../charts/LineChart'
import { AskButton } from '../../components/AskButton'
import { fmt, monthDate } from '../../domain/format'
import { Icon } from '../../ui/Icon'
import type { TabProps } from './CompanyPage'
import { SalariesTab } from './SalariesTab'

export function AnalyticsTab({ employer: e }: TabProps) {
  const max = Math.max(1, ...e.professions.map((p) => p.vacancies))

  return (
    <div className="prof-analytics">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Нові вакансії ВПК за рік</h3>
            <p>Кількість оголошень за місяцем публікації · останні 12 місяців</p>
          </div>
          <AskButton question={`Як змінюється кількість публікацій вакансій у ${e.name}?`} label="Пояснити" />
        </div>
        <div className="card" style={{ padding: 12 }}>
          <LineChart
            label={`Кількість активних вакансій ВПК ${e.name} за місяцем публікації`}
            months={e.monthly.map((p) => monthDate(p.month))}
            series={[{ values: e.monthly.map((p) => p.vacancies), color: 'var(--primary)', area: true }]}
          />
        </div>
        <p className="analytics-note">
          Графік побудовано за датами публікації вакансій ВПК, які залишаються активними в базі на дату збору.
          Закриті та незібрані оголошення не враховані, останній місяць може бути неповним.
          Це кількість оголошень, а не найнятих працівників чи відкритих вакансій у кожному місяці.
        </p>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Кого шукають</h3>
            <p>Кількість активних вакансій ВПК · до 15 найпоширеніших назв посад</p>
          </div>
          <Link className="link-btn" to={`/companies/${e.id}/vacancies`}>Усі вакансії<Icon name="chev" /></Link>
        </div>
        {e.professions.length === 0 ? (
          <p className="empty-row">Даних про відкриті вакансії немає.</p>
        ) : (
          <div className="bars" style={{ padding: '0 10px 10px' }}>
            {e.professions.map((p) => (
              <div key={p.title} className="bar-row">
                <span title={p.title}>{p.title}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${((p.vacancies / max) * 100).toFixed(0)}%`, background: 'var(--primary)' }} /></div>
                <b>{fmt(p.vacancies)}</b>
              </div>
            ))}
          </div>
        )}
      </section>
      <SalariesTab employer={e} />
    </div>
  )
}
