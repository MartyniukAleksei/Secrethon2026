import { Link } from 'react-router'
import { CountUp } from '../components/CountUp'
import { useData } from '../data/DataContext'
import { fmt, longDate, money } from '../domain/format'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/icons'
import './OverviewPage.css'

const ROUTE_CARDS: { title: string; description: string; action: string; to: string; icon: IconName }[] = [
  { title: 'Карта', description: 'Місця найму, зв’язки підприємств та щільність вакансій на одній карті.', action: 'Відкрити карту', to: '/map', icon: 'map' },
  { title: 'Підприємства', description: 'Профілі роботодавців, вакансії, санкції та пов’язані компанії.', action: 'Переглянути підприємства', to: '/companies', icon: 'factory' },
  { title: 'Вакансії', description: 'Посади, зарплати й вимоги до кандидатів. Пошук за компанією та регіоном.', action: 'Знайти вакансії', to: '/vacancies', icon: 'briefcase' },
  { title: 'Ланцюги постачання', description: 'Хто постачає матеріали й компоненти та які джерела підтверджують зв’язки.', action: 'Дослідити постачання', to: '/map?layers=supplier', icon: 'graph' },
  { title: 'Холдинги', description: 'Материнські й дочірні компанії та їхні зв’язки на карті.', action: 'Переглянути зв’язки', to: '/map?layers=parent', icon: 'grid' },
  { title: 'Джерела та методологія', description: 'Звідки походять дані, як визначається ВПК і зіставляються підприємства.', action: 'Про дані', to: '/methodology', icon: 'doc' },
]

export function OverviewPage() {
  const { stats } = useData()

  return (
    <div className="overview">
      <header className="overview-head">
        <div>
          <h1>Найм у ВПК РФ</h1>
          <p>Роботодавці, вакансії та географія найму.</p>
        </div>
        <div className="overview-date">
          <span>Останній збір</span>
          {stats.as_of ? <time dateTime={stats.as_of}>{longDate(stats.as_of)}</time> : <span>Дата відсутня</span>}
        </div>
      </header>

      <dl className="overview-metrics">
        <div>
          <dt>Активних вакансій ВПК</dt>
          <dd><Link to="/vacancies"><CountUp value={stats.vpk_vacancies} /></Link></dd>
          <p className="overview-metric-note">з них на перевірці: {fmt(stats.on_review_vacancies)}</p>
        </div>
        <div>
          <dt>Профілів роботодавців</dt>
          <dd><Link to="/companies"><CountUp value={stats.vpk_employers} /></Link></dd>
          <p className="overview-metric-note">вакансії всіх підрозділів підприємств ВПК, не лише профільні</p>
        </div>
        <div><dt>Регіонів найму</dt><dd><Link to="/map"><CountUp value={stats.regions} /></Link></dd></div>
        <div><dt>Медіана зарплати / місяць</dt><dd><CountUp value={stats.median_salary} format={money} /></dd></div>
      </dl>

      <section className="overview-classification" aria-labelledby="overview-classification-title">
        <div className="overview-section-head">
          <h2 id="overview-classification-title">Юрособи за підсумковою класифікацією</h2>
        </div>
        <dl className="overview-metrics">
          <div>
            <dt>Підприємств ВПК</dt>
            <dd><CountUp value={stats.vpk_companies} /></dd>
            <p className="overview-metric-note">з них рішення прийнято: {fmt(stats.vpk_companies_decided)}</p>
          </div>
          <div>
            <dt>Іноземних посередників</dt>
            <dd><CountUp value={stats.foreign_intermediary_companies} /></dd>
            <p className="overview-metric-note">з них рішення прийнято: {fmt(stats.foreign_intermediary_decided)}</p>
          </div>
          <div>
            <dt>Кадрових агентств, що наймають у ВПК</dt>
            <dd><CountUp value={stats.agency_employers} /></dd>
            <p className="overview-metric-note">профілі роботодавців; серед юросіб — {fmt(stats.agency_vpk_companies)}</p>
          </div>
          <div>
            <dt>Вакансій ВПК через агентства</dt>
            <dd><Link to="/vacancies?scope=agency"><CountUp value={stats.agency_vacancies} /></Link></dd>
            <p className="overview-metric-note">усього з агентствами: {fmt(stats.vpk_vacancies + stats.agency_vacancies)}</p>
          </div>
        </dl>
      </section>

      <div className="overview-body">
        <section className="overview-routes" aria-labelledby="overview-routes-title">
          <div className="overview-section-head">
            <h2 id="overview-routes-title">Дослідити дані</h2>
          </div>
          <div className="overview-route-grid">
            {ROUTE_CARDS.map((card) => (
              <Link key={card.to} to={card.to} className="panel overview-route-card">
                <div className="overview-route-heading">
                  <span className="overview-route-icon"><Icon name={card.icon} /></span>
                  <h3>{card.title}</h3>
                </div>
                <p>{card.description}</p>
                <span className="btn btn-secondary btn-sm overview-route-action">{card.action}<Icon name="chev" /></span>
              </Link>
            ))}
          </div>
        </section>

      </div>

      <footer className="overview-foot">
        <p>Санкції та зв’язки — база ГУР «Війна і санкції». Зіставлено за ІПН: {fmt(stats.matched_employers)} роботодавців.</p>
        <Link to="/methodology">Джерела й методологія<Icon name="chev" /></Link>
      </footer>
    </div>
  )
}
