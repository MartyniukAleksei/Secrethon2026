import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../data/DataContext'
import { fmt, longDate, money } from '../domain/format'
import { categoryOf, sourceName } from '../domain/labels'
import { Icon } from '../ui/Icon'
import './OverviewPage.css'

const ROW_LIMIT = 10

export function OverviewPage() {
  const { stats, employers } = useData()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'vacancies' | 'recent'>('vacancies')
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('uk-UA')
    return employers
      .filter((e) => !q || [e.name, e.locality, e.region, e.inn]
        .some((value) => value?.toLocaleLowerCase('uk-UA').includes(q)))
      .sort((a, b) => (sort === 'recent' ? b.new_30d - a.new_30d : b.vpk_vacancies - a.vpk_vacancies)
        || b.vpk_vacancies - a.vpk_vacancies || a.id - b.id)
  }, [employers, query, sort])
  const topRegions = [...stats.regions_list].sort((a, b) => b.vpk_vacancies - a.vpk_vacancies).slice(0, 6)
  const maxRegion = topRegions[0]?.vpk_vacancies || 1
  const likely = stats.by_level.find((l) => l.level === 'likely')?.vacancies ?? 0
  const review = stats.by_level.find((l) => l.level === 'review')?.vacancies ?? 0
  const other = stats.by_level.filter((l) => l.level === 'no' || l.level === 'out_of_scope')
    .reduce((sum, l) => sum + l.vacancies, 0)
  const levels = [
    { label: 'Підтверджені ВПК', count: stats.confirmed_vacancies, color: 'var(--primary)', to: '/vacancies?level=confirmed' },
    { label: 'Ймовірні ВПК', count: likely, color: 'var(--n-400)', to: '/vacancies?level=likely' },
    { label: 'На перевірку', count: review, color: 'var(--warning)', to: null },
    { label: 'Не ВПК / поза сферою', count: other, color: 'var(--fill-2)', to: null },
  ]

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
        <div><dt>Активних вакансій ВПК</dt><dd><Link to="/vacancies">{fmt(stats.vpk_vacancies)}</Link></dd></div>
        <div><dt>Профілів роботодавців</dt><dd><Link to="/companies">{fmt(stats.vpk_employers)}</Link></dd></div>
        <div><dt>Регіонів найму</dt><dd><Link to="/map">{fmt(stats.regions)}</Link></dd></div>
        <div><dt>Медіана зарплати / місяць</dt><dd>{money(stats.median_salary)}</dd></div>
      </dl>

      <div className="overview-body">
        <section className="overview-employers" aria-labelledby="overview-employers-title">
          <div className="overview-section-head">
            <h2 id="overview-employers-title">Роботодавці</h2>
            <Link to="/companies">Усі підприємства<Icon name="chev" /></Link>
          </div>
          <div className="overview-tools">
            <label className="overview-search">
              <Icon name="search" />
              <span className="sr">Пошук роботодавців за назвою, містом, регіоном або ІПН</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Назва, місто або ІПН" />
            </label>
            <div className="overview-sort" role="group" aria-label="Сортування роботодавців">
              <button type="button" aria-pressed={sort === 'vacancies'} onClick={() => setSort('vacancies')}>За вакансіями</button>
              <button type="button" aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>За новими</button>
            </div>
          </div>
          <div className="overview-table-wrap">
            <table className="overview-table">
              <caption className="sr">Роботодавці з найбільшою кількістю {sort === 'recent' ? 'нових вакансій ВПК за 30 днів' : 'активних вакансій ВПК'}</caption>
              <thead><tr>
                <th scope="col">Роботодавець</th>
                <th scope="col" className="overview-city">Місто</th>
                <th scope="col" className="overview-num" aria-sort={sort === 'vacancies' ? 'descending' : 'none'}>Вакансії ВПК</th>
                <th scope="col" className="overview-num" aria-sort={sort === 'recent' ? 'descending' : 'none'}>Нові / 30 днів</th>
                <th scope="col" className="overview-num overview-sanctions">Санкції</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, ROW_LIMIT).map((e) => (
                  <tr key={e.id}>
                    <td className="overview-company">
                      <Link to={`/companies/${e.id}`} title={e.name}>{e.name}</Link>
                      <span>{categoryOf(e.category).name}</span>
                    </td>
                    <td className="overview-city">{e.locality ?? '—'}</td>
                    <td className="overview-num overview-vacancy-count">{fmt(e.vpk_vacancies)}</td>
                    <td className="overview-num">{e.new_30d ? fmt(e.new_30d) : '—'}</td>
                    <td className="overview-num overview-sanctions">
                      {e.sanctions_count > 0 ? <span className="overview-sanction-count" title="Кількість санкцій за карткою ГУР">{fmt(e.sanctions_count)}</span> : '—'}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="overview-empty">
                  {query.trim() ? 'За цим запитом роботодавців не знайдено.' : 'У базі ще немає роботодавців із вакансіями ВПК.'}
                  {query.trim() && <button type="button" onClick={() => setQuery('')}>Очистити пошук</button>}
                </td></tr>}
              </tbody>
            </table>
          </div>
          <div className="overview-table-foot" aria-live="polite">
            <span>Показано {Math.min(rows.length, ROW_LIMIT)} з {fmt(rows.length)}</span>
            <Link to="/vacancies">Переглянути вакансії<Icon name="chev" /></Link>
          </div>
        </section>

        <aside className="overview-aside">
          <section aria-labelledby="overview-regions-title">
            <div className="overview-section-head">
              <h2 id="overview-regions-title">Регіони найму</h2>
              <Link to="/map">Карта<Icon name="chev" /></Link>
            </div>
            <p className="overview-section-note">За кількістю вакансій ВПК</p>
            <ol className="overview-regions">
              {topRegions.map((r) => (
                <li key={r.region_id}><Link to={`/regions/${r.region_id}`}>
                  <span>{r.name}</span><b>{fmt(r.vpk_vacancies)}</b>
                  <i aria-hidden="true" style={{ width: `${r.vpk_vacancies / maxRegion * 100}%` }} />
                </Link></li>
              ))}
            </ol>
            {!topRegions.length && <p className="overview-section-note">Регіони ще не визначені.</p>}
          </section>

          <section className="overview-coverage" aria-labelledby="overview-coverage-title">
            <div className="overview-section-head">
              <h2 id="overview-coverage-title">Обсяг збору</h2>
              <Link to="/methodology">Про дані<Icon name="chev" /></Link>
            </div>
            <p className="overview-total"><b>{fmt(stats.vacancies)}</b><span>активних оголошень із класифікацією</span></p>
            <dl className="overview-sources">
              {stats.by_source.map((s) => <div key={s.source}><dt>{sourceName(s.source)}</dt><dd>{fmt(s.vacancies)}</dd></div>)}
            </dl>
            <div className="overview-level-bar" aria-hidden="true">
              {levels.filter((l) => l.count > 0).map((l) => <span key={l.label} style={{ flex: l.count, background: l.color }} />)}
            </div>
            <dl className="overview-levels">
              {levels.map((l) => <div key={l.label}>
                <dt><i style={{ background: l.color }} aria-hidden="true" />{l.to ? <Link to={l.to}>{l.label}</Link> : l.label}</dt>
                <dd>{fmt(l.count)}</dd>
              </div>)}
            </dl>
            <p className="overview-section-note">У списках — підтверджені та ймовірні вакансії ВПК.</p>
          </section>
        </aside>
      </div>

      <footer className="overview-foot">
        <p>Санкції та зв’язки — база ГУР «Війна і санкції». Зіставлено за ІПН: {fmt(stats.matched_employers)} роботодавців.</p>
        <Link to="/methodology">Джерела й методологія<Icon name="chev" /></Link>
      </footer>
    </div>
  )
}
