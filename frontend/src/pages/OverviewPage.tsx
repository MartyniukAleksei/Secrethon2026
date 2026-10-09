import { Link } from 'react-router'
import { CountUp } from '../components/CountUp'
import { useData } from '../data/DataContext'
import { fmt, longDate, money, plural } from '../domain/format'
import { Icon } from '../ui/Icon'
import type { ApiFunnel, ApiStats } from '../api/types'
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

      <p className={`overview-run${stats.final_run_at ? '' : ' warn'}`}>
        {stats.final_run_at
          ? <>Дані станом на {longDate(stats.final_run_at)} (підсумкова класифікація вакансій)</>
          : <>Попередні дані: підсумкова класифікація вакансій ще не готова</>}
      </p>
      <dl className="overview-metrics">
        <div>
          <dt>Активних вакансій ВПК</dt>
          <dd><Link to="/vacancies"><CountUp value={stats.vpk_vacancies} /></Link></dd>
          <p className="overview-metric-note">з них на перевірці: {fmt(stats.on_review_vacancies)}</p>
        </div>
        <div>
          <dt>Підприємств (карток)</dt>
          <dd><Link to="/companies"><CountUp value={stats.vpk_employers} /></Link></dd>
          <p className="overview-metric-note">вакансії всіх підрозділів підприємств ВПК, не лише профільні</p>
        </div>
        <div><dt>Регіонів найму</dt><dd><Link to="/map"><CountUp value={stats.regions} /></Link></dd></div>
        <div>
          <dt>Медіана зарплати / місяць</dt>
          <dd><CountUp value={stats.median_salary} format={money} /></dd>
          <p className="overview-metric-note">
            медіана місячної зарплати, ₽, за {fmt(stats.salary_samples)} {plural(stats.salary_samples, 'вакансією', 'вакансіями', 'вакансіями')} з зарплатою
          </p>
        </div>
      </dl>
      <p className="overview-dedup"><Dedup stats={stats} /></p>

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

      <Funnel funnel={stats.funnel} />

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

/** Job-site profiles → enterprise cards → legal entities behind the ВПК vacancies. */
export function Dedup({ stats }: { stats: ApiStats }) {
  const share = stats.vpk_profiles ? Math.round((1 - stats.vpk_employers / stats.vpk_profiles) * 100) : 0
  return (
    <>
      {fmt(stats.vpk_profiles)} {plural(stats.vpk_profiles, 'профіль', 'профілі', 'профілів')} на сайтах вакансій →{' '}
      {fmt(stats.vpk_employers)} {plural(stats.vpk_employers, 'картка', 'картки', 'карток')} підприємств (дублі {share}%) →{' '}
      {fmt(stats.vpk_legal_entities)} {plural(stats.vpk_legal_entities, 'юрособа', 'юрособи', 'юросіб')}
    </>
  )
}

type Step = { label: string; value: number; to?: string; tone?: 'muted' | 'accent' }

/** How many were found, screened out and why, and how many are confirmed; every step links to its list. */
function Funnel({ funnel: f }: { funnel: ApiFunnel }) {
  const vacancies: Step[] = [
    { label: 'Вакансій зібрано', value: f.collected },
    { label: 'Після вилучення дублів', value: f.unique_vacancies },
    { label: 'Відсіяно: цивільні, цивільні під санкціями, іноземні', value: f.excluded, to: '/methodology#funnel', tone: 'muted' },
    { label: 'Відсіяно: без ознак ВПК', value: f.no_signal, to: '/methodology#funnel', tone: 'muted' },
    { label: 'Через кадрові агентства', value: f.agency, to: '/vacancies?scope=agency' },
    { label: 'ВПК на перевірці', value: f.likely, to: '/vacancies?level=likely' },
    { label: 'ВПК підтверджено', value: f.confirmed, to: '/vacancies?level=confirmed', tone: 'accent' },
  ]
  const companies: Step[] = [
    { label: 'Карток підприємств', value: f.cards, to: '/companies' },
    { label: 'Юросіб', value: f.legal_entities, to: '/companies' },
    { label: 'Рішення ВПК прийнято', value: f.decided, to: '/companies', tone: 'accent' },
    { label: 'Є в базі ГУР', value: f.on_gur, to: '/companies' },
  ]
  return (
    <section className="overview-funnel" aria-labelledby="overview-funnel-title">
      <div className="overview-section-head">
        <h2 id="overview-funnel-title">Від зібраного до підтвердженого</h2>
      </div>
      <div className="overview-funnel-grid">
        <Bars steps={vacancies} />
        <Bars steps={companies} />
      </div>
    </section>
  )
}

function Bars({ steps }: { steps: Step[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1)
  return (
    <div className="panel bars">
      {steps.map((s) => (
        <div key={s.label} className="bar-row">
          <span title={s.label}>{s.to ? <Link to={s.to}>{s.label}</Link> : s.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${Math.max((s.value / max) * 100, 0.5)}%`,
                background: s.tone === 'muted' ? 'var(--label-3)' : s.tone === 'accent' ? 'var(--warning)' : 'var(--accent-foreground)',
              }}
            />
          </div>
          <b>{fmt(s.value)}</b>
        </div>
      ))}
    </div>
  )
}
