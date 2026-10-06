import { categoryOf, LEVELS } from '../domain/labels'
import type { Category, Employer, Level } from '../domain/types'

export function CategoryBadge({ category }: { category: Category }) {
  const c = categoryOf(category)
  return (
    <span className="badge">
      <i className="dot" style={{ background: c.color }} />
      {c.name}
    </span>
  )
}

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`badge ${LEVELS[level].badge}`}>{LEVELS[level].name}</span>
}

/** Sanctions and the confidence of the ВПК link for an employer. */
export function EmployerFlags({ employer: e }: { employer: Employer }) {
  return (
    <>
      {e.sanctions_count > 0 && <span className="badge hostile">Під санкціями: {e.sanctions_count}</span>}
      {e.confirmed_vacancies > 0 ? <span className="badge warning">ВПК підтверджено</span> : <span className="badge">ВПК ймовірно</span>}
      {e.gur_company_id != null && <span className="badge info">Є в базі ГУР</span>}
    </>
  )
}
