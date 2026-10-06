import { Link } from 'react-router'
import { LineChart } from '../../charts/LineChart'
import { AskButton } from '../../components/AskButton'
import { fmt, monthDate, plural } from '../../domain/format'
import { categoryOf } from '../../domain/labels'
import { Icon } from '../../ui/Icon'
import type { TabProps } from './CompanyPage'

export function OverviewTab({ employer: e }: TabProps) {
  const gur = e.gur
  const max = e.professions[0]?.vacancies ?? 1
  const places = e.localities.map((l) => l.locality).join(', ')

  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3>Про підприємство</h3></div>
        <div className="prose-block">
          {gur?.description_uk ? <p>{gur.description_uk}</p> : null}
          <p>
            На сайтах пошуку роботи {fmt(e.vpk_vacancies)} {plural(e.vpk_vacancies, 'вакансія', 'вакансії', 'вакансій')} віднесено до ВПК
            {e.confirmed_vacancies > 0 ? `, з них ${fmt(e.confirmed_vacancies)} з підтвердженою дотичністю` : ''}. Напрям: {categoryOf(e.category).name.toLowerCase()}.
            {places ? ` Наймає в: ${places}.` : ''}
          </p>
          {gur?.products_uk && gur.products_uk.length > 0 && <p>Продукція: {gur.products_uk.join(', ')}.</p>}
          {gur?.address_uk && <p>Адреса: {gur.address_uk}</p>}
          {!gur && (
            <p className="src">
              Картки в базі ГУР для цього роботодавця не знайдено: зіставляємо за ІПН, а hh.ru його не публікує.
            </p>
          )}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-head">
          <div>
            <h3>Нові вакансії ВПК за рік</h3>
            <p>За датою публікації оголошення</p>
          </div>
          <AskButton question={`Чому змінюється найм у ${e.name}?`} label="Пояснити" />
        </div>
        <div className="card" style={{ padding: 12 }}>
          <LineChart
            label={`Нові вакансії ${e.name} за місяцями`}
            months={e.monthly.map((p) => monthDate(p.month))}
            series={[{ values: e.monthly.map((p) => p.vacancies), color: 'var(--primary)', area: true }]}
          />
        </div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-head">
          <h3>Кого шукають</h3>
          <Link className="link-btn" to={`/companies/${e.id}/vacancies`}>Усі вакансії<Icon name="chev" /></Link>
        </div>
        <div className="bars" style={{ padding: '0 10px 10px' }}>
          {e.professions.map((p) => (
            <div key={p.title} className="bar-row">
              <span title={p.title}>{p.title}</span>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${((p.vacancies / max) * 100).toFixed(0)}%`, background: 'var(--primary)' }} /></div>
              <b>{p.vacancies}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
