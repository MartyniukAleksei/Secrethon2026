import { Link } from 'react-router'
import type { ApiRelation } from '../api/types'
import { relationName } from '../domain/labels'
import { CompanyMark } from '../ui/CompanyMark'

/** Companies related to this one in the GUR database. Links to their employer profile when we have one. */
export function RelationRows({ relations }: { relations: ApiRelation[] }) {
  if (!relations.length) return <p className="empty-row">Зв'язків у базі ГУР не знайдено</p>
  return (
    <div className="chain-list">
      {relations.map((r) => {
        const body = (
          <>
            <CompanyMark size={34} />
            <span>
              <b>{r.name}</b>
              <span className="sm2">
                {relationName(r)}
                {r.inn ? `, ІПН ${r.inn}` : ''}
              </span>
            </span>
            {r.sanctions_count > 0 ? <span className="conf low">санкцій: {r.sanctions_count}</span> : <span />}
          </>
        )
        const key = `${r.kind}-${r.direction}-${r.company_id}`
        return r.employer_id != null ? (
          <Link key={key} className="chain-row" to={`/companies/${r.employer_id}`}>{body}</Link>
        ) : (
          <div key={key} className="chain-row static">{body}</div>
        )
      })}
    </div>
  )
}
