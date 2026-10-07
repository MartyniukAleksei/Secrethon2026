import { categoryOf, LEVELS } from '../domain/labels'
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
