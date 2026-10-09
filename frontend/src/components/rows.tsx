import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useData } from '../data/DataContext'
import { ago, fmt, salaryRange } from '../domain/format'
import type { Employer, Vacancy } from '../domain/types'
import { CompanyLogo } from '../ui/CompanyMark'

/** Compact employer row used in side lists. `value` overrides the right column. */
export function EmployerRow({ employer: e, to, current, value }: { employer: Employer; to?: string; current?: boolean; value?: ReactNode }) {
  return (
    <Link className="co-row" to={to ?? `/companies/${e.id}`} aria-current={current ? 'true' : undefined}>
      <CompanyLogo src={e.logo_url} name={e.name} />
      <span>
        <b>{e.name}</b>
        <span className="sm2">{[e.locality, e.region].filter(Boolean).join(', ') || 'Місто не вказано'}</span>
      </span>
      <span className="val">
        {value ?? (
          <>
            <b>{fmt(e.vpk_vacancies + e.agency_vacancies)}</b>
            <span>вакансій</span>
          </>
        )}
      </span>
    </Link>
  )
}

/** A vacancy card linking to its full profile. */
export function VacancyRow({ vacancy: v, showEmployer = true }: { vacancy: Vacancy; showEmployer?: boolean }) {
  const { asOf } = useData()
  return (
    <Link className="vac-row" to={`/vacancies/${v.id}`}>
      <b>{v.title}</b>
      <span className="pay">{salaryRange(v) ?? 'ЗП не вказано'}</span>
      <span className="sm2">{[showEmployer ? v.employer_name : null, v.locality].filter(Boolean).join(', ')}</span>
      <span className="sm2 end">{ago(v.published_at, asOf)}</span>
    </Link>
  )
}
