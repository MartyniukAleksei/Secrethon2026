import type { ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { api } from '../../api/client'
import { seedOf } from '../../charts/geometry'
import { Topo } from '../../charts/Topo'
import { MapSlot } from '../../components/MapSlot'
import { EmployerRow } from '../../components/rows'
import { useData } from '../../data/DataContext'
import { useApi } from '../../data/useApi'
import { fmt, longDate, money } from '../../domain/format'
import { categoryOf, sourceName } from '../../domain/labels'
import type { EmployerDetail } from '../../domain/types'
import { useAgent } from '../../features/agent/AgentContext'
import { EmployerBadgeGroups } from '../../ui/EmployerBadgeGroups'
import { CompanyMark } from '../../ui/CompanyMark'
import { Icon } from '../../ui/Icon'
import { NotFoundPage } from '../NotFoundPage'
import { AnalyticsTab } from './AnalyticsTab'
import { OverviewTab } from './OverviewTab'
import { RelationsTab } from './RelationsTab'
import { SourcesTab } from './SourcesTab'
import { VacanciesTab } from './VacanciesTab'
import './CompanyPage.css'

export type TabProps = { employer: EmployerDetail }

const TABS: { id: string; label: string; render: (p: TabProps) => ReactNode }[] = [
  { id: 'overview', label: 'Огляд', render: (p) => <OverviewTab {...p} /> },
  { id: 'vacancies', label: 'Вакансії', render: (p) => <VacanciesTab {...p} /> },
  { id: 'analytics', label: 'Аналітика', render: (p) => <AnalyticsTab {...p} /> },
  { id: 'chain', label: "Зв'язки", render: (p) => <RelationsTab {...p} /> },
  {
    id: 'map',
    label: 'На карті',
    render: ({ employer }) => (
      <div className="panel prof-map">
        <MapSlot employers={[employer]} selectedId={employer.id} />
      </div>
    ),
  },
  { id: 'sources', label: 'Джерела', render: (p) => <SourcesTab {...p} /> },
]

export function CompanyPage() {
  const { id = '', tab = 'overview' } = useParams()
  const employerId = Number(id)
  const current = TABS.find((t) => t.id === tab)
  const state = useApi(`employer:${employerId}`, (signal) => api.employer(employerId, signal))

  if (Number.isInteger(employerId) && tab === 'salaries') {
    return <Navigate to={`/companies/${employerId}/analytics`} replace />
  }
  if (!Number.isInteger(employerId) || !current) return <NotFoundPage />
  if (state.status === 'error') return <NotFoundPage />
  if (state.status === 'loading') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="skeleton" style={{ height: 300, borderRadius: 'var(--r-window)' }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--r-window)' }} />
      </div>
    )
  }
  return <Profile employer={state.data} tab={current} />
}

function Profile({ employer: e, tab }: { employer: EmployerDetail; tab: (typeof TABS)[number] }) {
  const { employers, asOf } = useData()
  const { ask } = useAgent()
  const gur = e.gur
  const address = gur?.address_uk?.trim()
  const ogrn = e.ogrn ?? gur?.ogrn
  const kpp = e.kpp ?? gur?.kpp
  const similar = employers.filter((x) => x.id !== e.id && x.category === e.category && x.region_id === e.region_id).slice(0, 5)
  const quick = [`Кого наймає ${e.name}?`, `Хто пов'язаний з ${e.name}?`, `Які зарплати в ${e.name}?`]

  return (
    <>
      <div className="crumbs">
        <Link to="/companies">Підприємства</Link>
        <Icon name="chev" />
        <span>{e.name}</span>
      </div>
      <section className="panel prof-head">
        <div className="prof-band"><Topo seed={seedOf(String(e.id))} /></div>
        <div className="prof-id">
          <div className="logo-tile">
            {gur?.logo_url ? <img className="logo-img" src={gur.logo_url} alt="" referrerPolicy="no-referrer" /> : <CompanyMark size={64} />}
          </div>
          <div className="grow">
            <h1>{e.name}</h1>
            <p className="place">
              <Icon name="pin" />
              {e.locality ?? 'Місто не вказано'}
              {e.region_id != null && e.region && (
                <>
                  , <Link to={`/regions/${e.region_id}`}>{e.region}</Link>
                </>
              )}
            </p>
          </div>
          <div className="prof-actions">
            <Link className="btn btn-secondary" to={`/map?co=${e.id}`}><Icon name="map" />На карті</Link>
            <button className="btn btn-primary" type="button" onClick={() => ask(`Розкажи коротко про ${e.name}`)}>
              <Icon name="spark" />Запитати агента
            </button>
          </div>
        </div>
        <div className="prof-employer-badges">
          <EmployerBadgeGroups employer={e} />
        </div>
        <dl className="prof-stats">
          <div className="card"><dt>Вакансій ВПК</dt><dd>{fmt(e.vpk_vacancies)}</dd></div>
          <div className="card"><dt>З них підтверджено</dt><dd>{fmt(e.confirmed_vacancies)}</dd></div>
          <div className="card"><dt>Медіана зарплати</dt><dd>{money(e.median_salary)}</dd></div>
          <div className="card"><dt>Нових за 30 днів</dt><dd>{fmt(e.new_30d)}</dd></div>
          <div className="card"><dt>Санкцій</dt><dd>{fmt(e.sanctions_count)}</dd></div>
        </dl>
      </section>

      <div className="prof-body">
        <div>
          <div className="prof-tabs">
            <div className="tabs" role="tablist" aria-label="Розділи профілю">
              {TABS.map((t) => (
                <Link key={t.id} className="tab" role="tab" to={`/companies/${e.id}/${t.id}`} aria-selected={t.id === tab.id}>
                  {t.label}
                  {t.id === 'chain' && gur && gur.relations.length > 0 ? ` ${gur.relations.length}` : ''}
                </Link>
              ))}
            </div>
          </div>
          {tab.render({ employer: e })}
        </div>
        <aside className="prof-rail">
          <div className="panel">
            <div className="panel-head"><h3>Коротко</h3></div>
            <dl className="facts">
              <div><dt>Напрям</dt><dd>{categoryOf(e.category).name}</dd></div>
              <div><dt>Регіон</dt><dd>{e.region ?? '—'}</dd></div>
              {address && <div className="facts-address"><dt>Місце підприємства</dt><dd>{address}</dd></div>}
              <div><dt>ІПН</dt><dd>{e.inn ?? gur?.inn ?? '—'}</dd></div>
              {ogrn && <div><dt>ОДРН</dt><dd>{ogrn}</dd></div>}
              {kpp && <div><dt>КПП</dt><dd>{kpp}</dd></div>}
              <div><dt>Телефон</dt><dd className="fact-missing">Відсутньо</dd></div>
              <div><dt>Email</dt><dd className="fact-missing">Відсутньо</dd></div>
              <div><dt>Контактна особа</dt><dd className="fact-missing">Відсутньо</dd></div>
              {gur?.website && <div className="facts-address"><dt>Вебресурс</dt><dd><a href={gur.website} target="_blank" rel="noreferrer noopener">Відкрити<Icon name="external" /></a></dd></div>}
              {e.profile_url && <div><dt>Профіль роботодавця</dt><dd><a href={e.profile_url} target="_blank" rel="noreferrer noopener">Відкрити<Icon name="external" /></a></dd></div>}
              <div><dt>Джерело</dt><dd>{sourceName(e.source)}</dd></div>
              <div><dt>Остання вакансія</dt><dd>{e.last_published_at ? longDate(e.last_published_at) : '—'}</dd></div>
              <div><dt>Дані на</dt><dd>{longDate(asOf)}</dd></div>
            </dl>
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Запитати агента</h3></div>
            <div className="ask-list">
              {quick.map((q) => (
                <button key={q} className="ask-q" type="button" onClick={() => ask(q)}>
                  <Icon name="spark" />{q}
                </button>
              ))}
            </div>
          </div>
          {similar.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h3>Схожі в регіоні</h3></div>
              <div className="co-list">
                {similar.map((s) => <EmployerRow key={s.id} employer={s} />)}
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
