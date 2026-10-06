import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useData } from '../data/DataContext'
import { ago, fmt, salaryRange } from '../domain/format'
import type { Employer, Vacancy } from '../domain/types'
import { useVacancyDrawer } from '../features/vacancy/VacancyDrawerContext'
import { CompanyMark } from '../ui/CompanyMark'

/** Compact employer row used in side lists. `value` overrides the right column. */
export function EmployerRow({ employer: e, to, current, value }: { employer: Employer; to?: string; current?: boolean; value?: ReactNode }) {
  return (
    <Link className="co-row" to={to ?? `/companies/${e.id}`} aria-current={current ? 'true' : undefined}>
      <CompanyMark />
      <span>
        <b>{e.name}</b>
        <span className="sm2">{[e.locality, e.region].filter(Boolean).join(', ') || 'Місто не вказано'}</span>
      </span>
      <span className="val">
        {value ?? (
          <>
            <b>{fmt(e.vpk_vacancies)}</b>
            <span>вакансій</span>
          </>
        )}
      </span>
    </Link>
  )
}

/** A vacancy card; opens the vacancy drawer. */
export function VacancyRow({ vacancy: v, showEmployer = true }: { vacancy: Vacancy; showEmployer?: boolean }) {
  const { asOf } = useData()
  const { open } = useVacancyDrawer()
  return (
    <button className="vac-row" type="button" onClick={() => open(v.id)}>
      <b>{v.title}</b>
      <span className="pay">{salaryRange(v) ?? 'ЗП не вказано'}</span>
      <span className="sm2">{[showEmployer ? v.employer_name : null, v.locality].filter(Boolean).join(', ')}</span>
      <span className="sm2 end">{ago(v.published_at, asOf)}</span>
    </button>
  )
}
