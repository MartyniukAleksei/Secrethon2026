import { useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { api } from '../../api/client'
import { seedOf } from '../../charts/geometry'
import { Topo } from '../../charts/Topo'
import { EmployerHumanReview } from '../../components/EmployerHumanReview'
import { MapSlot } from '../../components/MapSlot'
import { EmployerRow } from '../../components/rows'
import { useData } from '../../data/DataContext'
import { useApi } from '../../data/useApi'
import { fmt, longDate, money } from '../../domain/format'
import { categoryOf, DOMAINS, effectiveCategory, ROLES, sanctionsOf, shownVacancies, sourceName } from '../../domain/labels'
import type { ApiCompanyContact, ApiMatchConflict } from '../../api/types'
import type { EmployerDetail } from '../../domain/types'
import { useAgent } from '../../features/agent/AgentContext'
import { EmployerBadgeGroups } from '../../ui/EmployerBadgeGroups'
import { CompanyLogo } from '../../ui/CompanyMark'
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
  // One card per enterprise: another profile of the group opens its card.
  if (state.data.id !== employerId) return <Navigate to={`/companies/${state.data.id}/${current.id}`} replace />
  return <Profile employer={state.data} tab={current} />
}

function Profile({ employer: loaded, tab }: { employer: EmployerDetail; tab: (typeof TABS)[number] }) {
  const { employers, asOf, applyHumanReview } = useData()
  // A saved human review updates the card in place, without reloading the profile.
  const [e, setEmployer] = useState(loaded)
  const { ask } = useAgent()
  const gur = e.gur
  const contacts = (kind: ApiCompanyContact['kind']) => e.contacts.filter((c) => c.kind === kind)
  const contactAddress = contacts('address')[0]
  const address = gur?.address_uk?.trim() || e.registry?.address?.trim() || contactAddress?.value
  // EGRUL writes the head as 'ПОСАДА: Прізвище Ім'я'.
  const [headRole, headName] = splitHead(e.registry?.head)
  const contactHead = contacts('head')[0]
  // A website found and opened by the search agent beats company.website, which is sometimes a news link.
  const website = contacts('website')[0]?.value ?? gur?.website
  // A probable (name-only) match must not pass the company's registry numbers off as the employer's.
  const gurIds = gur?.match === 'name' ? null : gur
  const ogrn = e.ogrn ?? gurIds?.ogrn
  const kpp = e.kpp ?? gurIds?.kpp
  const category = effectiveCategory(e)
  const similar = employers.filter((x) => x.id !== e.id && effectiveCategory(x) === category && x.region_id === e.region_id).slice(0, 5)
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
            <CompanyLogo src={gur?.logo_url} size={72} />
          </div>
          <div className="grow">
            <h1>{e.name}</h1>
            {e.is_branch && (
              <p className="place">
                <span className="badge info">Філія</span>
                {e.parent_card_id != null && <Link to={`/companies/${e.parent_card_id}`}>Головна компанія</Link>}
              </p>
            )}
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
          <div className="card"><dt>{shownVacancies(e).label}</dt><dd>{fmt(shownVacancies(e).value)}</dd></div>
          <div className="card"><dt>З них підтверджено</dt><dd>{fmt(e.confirmed_vacancies)}</dd></div>
          <div className="card"><dt>Медіана зарплати</dt><dd>{money(e.median_salary)}</dd></div>
          <div className="card"><dt>Нових за 30 днів</dt><dd>{fmt(e.new_30d)}</dd></div>
          <div className="card"><dt>Санкції, юрисдикцій</dt><dd title={sanctionsOf(e).codes.join(', ') || undefined}>{fmt(sanctionsOf(e).total)}</dd></div>
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
          <EmployerHumanReview
            employer={e}
            reviews={e.human_reviews}
            onSaved={(review) => {
              setEmployer((prev) => ({ ...prev, human_review: review, human_reviews: [review, ...prev.human_reviews] }))
              applyHumanReview(review)
            }}
          />
          <div className="panel">
            <div className="panel-head"><h3>Коротко</h3></div>
            <dl className="facts">
              <div><dt>Напрям</dt><dd>{(!e.human_review?.category && e.classification?.direction_label) || categoryOf(category).name}</dd></div>
              {(e.classification?.direction_domain || e.classification?.direction_role) && (
                <div>
                  <dt>Галузь · роль</dt>
                  <dd>{[DOMAINS[e.classification.direction_domain ?? ''], ROLES[e.classification.direction_role ?? '']].filter(Boolean).join(' · ')}</dd>
                </div>
              )}
              <div><dt>Регіон</dt><dd>{e.region ?? '—'}</dd></div>
              {address && (
                <div className="facts-address">
                  <dt>Місце підприємства</dt>
                  <dd>{address}{address === contactAddress?.value && <SourceLink url={contactAddress.url} />}</dd>
                </div>
              )}
              <div>
                <dt>ІПН</dt>
                <dd>
                  {e.inn ?? gurIds?.inn ?? contacts('inn')[0]?.value ?? '—'}
                  {e.match_conflicts.length > 0 && (
                    <span className="badge warning" title={e.match_conflicts.map(conflictTitle).join('\n\n')}>зв’язок з юрособою під питанням</span>
                  )}
                </dd>
              </div>
              {ogrn && <div><dt>ОДРН</dt><dd>{ogrn}</dd></div>}
              {kpp && <div><dt>КПП</dt><dd>{kpp}</dd></div>}
              <ContactFact label="Телефон" items={contacts('phone')} />
              <ContactFact label="Email" items={contacts('email')} href={(v) => `mailto:${v}`} />
              <div className="facts-address">
                <dt>Контактна особа</dt>
                {headName ? (
                  <dd>{headName}<span className="fact-detail">Керівник{headRole ? ` · ${headRole.toLowerCase()}` : ''} · за реєстром</span></dd>
                ) : contactHead ? (
                  <dd>
                    {contactHead.value}
                    <span className="fact-detail">Керівник{contactHead.detail ? ` · ${contactHead.detail}` : ''}{contactHead.url && <> · <SourceLink url={contactHead.url} /></>}</span>
                  </dd>
                ) : <dd className="fact-missing">Відсутньо</dd>}
              </div>
              {website && <div className="facts-address"><dt>Вебресурс</dt><dd><a href={website} target="_blank" rel="noreferrer noopener">{hostOf(website)}<Icon name="external" /></a></dd></div>}

              <div><dt>Остання вакансія</dt><dd>{e.last_published_at ? longDate(e.last_published_at) : '—'}</dd></div>
              <div><dt>Дані на</dt><dd>{longDate(asOf)}</dd></div>
            </dl>
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Джерела вакансій</h3></div>
            <ul className="card-sources">
              {e.sources.map((s) => (
                <li key={s.employer_profile_id}>
                  <span className="badge">{sourceName(s.source)}</span>
                  {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.name}<Icon name="external" /></a> : <span>{s.name}</span>}
                  <span className="fact-detail">{fmt(s.vacancies)} вакансій</span>
                </li>
              ))}
            </ul>
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

/** Small link to the page a contact was found on. */
function SourceLink({ url }: { url: string | null | undefined }) {
  if (!url) return null
  return <a className="fact-source" href={url} target="_blank" rel="noreferrer noopener" title={url}>джерело</a>
}

/** Up to three verified corporate contacts of one kind, each with its department and source. */
function ContactFact({ label, items, href }: { label: string; items: ApiCompanyContact[]; href?: (value: string) => string }) {
  if (items.length === 0) return <div><dt>{label}</dt><dd className="fact-missing">Відсутньо</dd></div>
  return (
    <div className="facts-address">
      <dt>{label}</dt>
      <dd className="fact-list">
        {items.slice(0, 3).map((c) => (
          <span key={c.value}>
            {href ? <a href={href(c.value)}>{c.value}</a> : c.value}
            {(c.detail || c.url) && <span className="fact-detail">{[c.detail, c.url && <SourceLink key="src" url={c.url} />].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))}</span>}
          </span>
        ))}
      </dd>
    </div>
  )
}

function splitHead(head: string | null | undefined): [string | null, string | null] {
  const text = head?.trim()
  if (!text) return [null, null]
  const i = text.indexOf(':')
  return i > 0 ? [text.slice(0, i).trim(), text.slice(i + 1).trim()] : [null, text]
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Both sides of a questionable link, for a person to check. */
function conflictTitle(c: ApiMatchConflict): string {
  const ev = c.evidence ?? {}
  if (c.kind === 'different_inn') {
    return [`${(ev.profile ?? []).join(' · ')} → ІПН ${ev.inn ?? '—'}`, `${(ev.other ?? []).join(' · ')} → ІПН ${ev.other_inn ?? '—'}`].join('\n')
  }
  return `Профіль без юрособи названо як ВПК-юрособу з іншого регіону.\nРегіони профілю: ${(ev.profile_regions ?? []).join(', ')}; юрособи: ${(ev.company_regions ?? []).join(', ')}`
}
