import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api/client'
import { seedOf } from '../charts/geometry'
import { Topo } from '../charts/Topo'
import { AskButton } from '../components/AskButton'
import { ReviewBadge, VacancyReviews } from '../components/VacancyReviews'
import { VacancyDirection } from '../components/VacancyDirection'
import { useData } from '../data/DataContext'
import { useApi } from '../data/useApi'
import { usePageTitle } from '../app/pageContext'
import { longDate, salaryRange } from '../domain/format'
import { experienceName, FINAL_BASIS, sourceName } from '../domain/labels'
import type { VacancyDetail } from '../domain/types'
import { CategoryBadge, VacancyBadges } from '../ui/badges'
import { CompanyMark } from '../ui/CompanyMark'
import { Icon } from '../ui/Icon'
import { NotFoundPage } from './NotFoundPage'
import './company/CompanyPage.css'
import './VacancyPage.css'

const SECTIONS = [
  ['responsibilities', "Обов’язки"],
  ['requirements', 'Вимоги'],
  ['conditions', 'Умови'],
  ['description', 'Опис вакансії'],
  ['skills_raw', 'Навички'],
] as const

export function VacancyPage() {
  const { id = '' } = useParams()
  const vacancyId = Number(id)
  const state = useApi(`vacancy:${vacancyId}`, (signal) => api.vacancy(vacancyId, signal))
  if (!Number.isSafeInteger(vacancyId) || vacancyId < 1) return <NotFoundPage />
  if (state.status === 'error') return <NotFoundPage />
  if (state.status === 'loading') {
    return <div className="vacancy-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /></div>
  }
  return <VacancyProfile key={vacancyId} vacancy={state.data} />
}

function VacancyProfile({ vacancy: v }: { vacancy: VacancyDetail }) {
  const [reviews, setReviews] = useState(v.reviews ?? [])
  usePageTitle(`${v.title}, Вакансія`)
  const { byId, asOf } = useData()
  const employer = v.employer_id != null ? byId[v.employer_id] : undefined
  const seen = new Set<string>()
  const texts = SECTIONS.filter(([key]) => {
    const text = v[key]?.trim()
    if (!text || seen.has(text)) return false
    seen.add(text)
    return true
  })
  const experience = experienceName(v.experience)

  return (
    <>
      <div className="crumbs">
        <Link to="/vacancies">Вакансії</Link><Icon name="chev" />
        {employer && <><Link to={`/companies/${employer.id}/vacancies`}>{employer.name}</Link><Icon name="chev" /></>}
        <span>{v.title}</span>
      </div>
      <section className="panel prof-head vacancy-head">
        <div className="prof-band"><Topo seed={seedOf(`vacancy-${v.id}`)} /></div>
        <div className="prof-id">
          <div className="logo-tile"><CompanyMark size={64} /></div>
          <div className="grow">
            <h1>{v.title}</h1>
            <p className="place">
              <Icon name="briefcase" />
              {employer ? <Link to={`/companies/${employer.id}`}>{v.employer_name ?? employer.name}</Link> : (v.employer_name ?? 'Роботодавця не вказано')}
            </p>
            <p className="place"><Icon name="pin" />{[v.locality, v.region].filter(Boolean).join(', ') || 'Місце найму не вказано'}</p>
          </div>
          <div className="prof-actions">
            <a className="btn btn-secondary" href={v.url} target="_blank" rel="noreferrer noopener"><Icon name="external" />Оригінал оголошення</a>
            <AskButton question={`Що вакансія «${v.title}» каже про ${v.employer_name ?? 'роботодавця'}?`} />
          </div>
        </div>
        <div className="badges prof-badges">
          <VacancyDirection vacancy={v} />
          <ReviewBadge source="human" review={reviews.find((r) => r.source === 'human')} />
          <ReviewBadge source="llm" review={reviews.find((r) => r.source === 'llm')} />
          {v.shown
            ? <VacancyBadges vacancy={v} />
            : <span className="badge">Не входить до вибірки ВПК</span>}
          {v.category && <CategoryBadge category={v.category} />}
        </div>
        <dl className="vacancy-stats">
          <div className="card"><dt>Зарплата</dt><dd>{salaryRange(v) ?? 'Не вказано'}</dd></div>
          <div className="card"><dt>Досвід</dt><dd>{experience ?? 'Не вказано'}</dd></div>
          <div className="card"><dt>Опубліковано</dt><dd>{v.published_at ? longDate(v.published_at) : 'Дата не вказана'}</dd></div>
        </dl>
      </section>
      <div className="prof-body">
        <div className="vacancy-content">
          {texts.length > 0 ? texts.map(([key, label]) => (
            <section className="panel" key={key}>
              <div className="panel-head"><h3>{label}</h3></div>
              <p className="prose-block vacancy-text">{v[key]}</p>
            </section>
          )) : <section className="panel"><p className="empty-row">Докладний опис не збережено. Переглянь оригінал оголошення.</p></section>}
        </div>
        <aside className="prof-rail">
          <VacancyReviews vacancyId={v.id} reviews={reviews} onSaved={(review) => setReviews((previous) => [review, ...previous])} />
          <section className="panel">
            <div className="panel-head"><h3>Коротко</h3></div>
            <dl className="facts">
              <div><dt>Номер вакансії</dt><dd>{v.id}</dd></div>
              {v.address && <div className="facts-address"><dt>Місце найму</dt><dd>{v.address}</dd></div>}
              {v.employment && <div><dt>Зайнятість</dt><dd>{v.employment}</dd></div>}
              {v.schedule && v.schedule !== 'OTHER' && <div><dt>Графік</dt><dd>{v.schedule}</dd></div>}
              {v.education && <div className="facts-address"><dt>Освіта</dt><dd>{v.education}</dd></div>}
              <div><dt>Джерело</dt><dd><a href={v.url} target="_blank" rel="noreferrer noopener">{sourceName(v.source)}</a></dd></div>
              <div><dt>Дані на</dt><dd>{longDate(asOf)}</dd></div>
            </dl>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>Чому ця вакансія тут</h3></div>
            <div className="vacancy-classification">
              {v.shown ? <VacancyBadges vacancy={v} /> : <span className="badge">Не входить до вибірки ВПК</span>}
              {v.shown
                ? FINAL_BASIS[v.final_basis] && <p>{FINAL_BASIS[v.final_basis]}</p>
                : <p>Роботодавця не віднесено до ВПК (або підстав у тексті замало), тому вакансію не показано в списках і не враховано в лічильниках.</p>}
              {v.evidence.length > 0 && (
                <ul className="vacancy-evidence">
                  {v.evidence.map((e) => <li key={e.signal + (e.snippet ?? '')}><b>{e.signal}</b>{e.snippet ? `: ${e.snippet}` : ''}</li>)}
                </ul>
              )}
              <p className="src">{v.classifier_name}{v.classifier_version ? ` · ${v.classifier_version}` : ''}</p>
              <p className="src">Це оцінка з поточного збору даних, окрема від Human review та LLM review.</p>
            </div>
          </section>
          {employer && <section className="panel vacancy-employer">
            <div className="panel-head"><h3>Підприємство</h3></div>
            <p>{employer.name}</p>
            <Link className="btn btn-secondary btn-sm" to={`/companies/${employer.id}`}>Відкрити профіль<Icon name="chev" /></Link>
          </section>}
        </aside>
      </div>
    </>
  )
}
