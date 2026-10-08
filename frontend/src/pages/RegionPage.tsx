import { Link, useParams } from 'react-router'
import { AskButton } from '../components/AskButton'
import { MapSlot } from '../components/MapSlot'
import { EmployerRow } from '../components/rows'
import { useData } from '../data/DataContext'
import { fmt, money } from '../domain/format'
import { isSanctioned } from '../domain/labels'
import { Icon } from '../ui/Icon'
import { NotFoundPage } from './NotFoundPage'
import './RegionPage.css'

export function RegionPage() {
  const { id = '' } = useParams()
  const { regionById, employers } = useData()
  const region = regionById[Number(id)]
  if (!region) return <NotFoundPage />

  const list = employers.filter((e) => e.region_id === region.region_id)
  const salaries = list.map((e) => e.median_salary).filter((s): s is number => s != null).sort((a, b) => a - b)
  const median = salaries.length ? salaries[salaries.length >> 1] : null
  const kpis: [string, string][] = [
    ['Вакансій ВПК', fmt(region.vpk_vacancies)],
    ['Роботодавців', fmt(region.employers)],
    ['Під санкціями', fmt(list.filter(isSanctioned).length)],
    ['Типова зарплата', money(median)],
  ]

  return (
    <>
      <div className="crumbs">
        <Link to="/map">Карта</Link>
        <Icon name="chev" />
        <span>{region.name}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{region.name}</h1>
          <p>Роботодавці ВПК регіону, їхній найм і зарплати.</p>
        </div>
        <AskButton question={`Хто наймає для ВПК у регіоні ${region.name}?`} />
      </div>
      <div className="kpis4">
        {kpis.map(([label, value]) => (
          <div key={label} className="kpi-tile">
            <span className="k-label">{label}</span>
            <span className="k-value">{value}</span>
          </div>
        ))}
      </div>
      <div className="region-body">
        <div className="panel" style={{ minHeight: 420, display: 'flex' }}>
          <MapSlot employers={list} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>Роботодавці</h3>
            <Link className="link-btn" to={`/vacancies`}>Вакансії<Icon name="chev" /></Link>
          </div>
          <div className="co-list region-list">
            {list.map((e) => <EmployerRow key={e.id} employer={e} />)}
          </div>
        </div>
      </div>
    </>
  )
}
