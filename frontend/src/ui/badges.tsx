import type { ApiVacancy } from '../api/types'
import { categoryOf, LEVELS, vacancyBadges } from '../domain/labels'
import type { Category, Level } from '../domain/types'

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

/** Final-label badges of a vacancy; an ordinary vacancy of a ВПК enterprise gets a plain note. */
export function VacancyBadges({ vacancy }: { vacancy: Pick<ApiVacancy, 'final_category' | 'final_basis' | 'level' | 'has_markers'> }) {
  const badges = vacancyBadges(vacancy)
  if (!badges.length) return <span style={{ color: 'var(--label-2)' }}>Підприємство ВПК</span>
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {badges.map((b) => <span key={b.name} className={`badge ${b.badge}`}>{b.name}</span>)}
    </span>
  )
}
