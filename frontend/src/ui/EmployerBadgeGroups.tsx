import { sourceName } from '../domain/labels'
import type { Employer } from '../domain/types'
import { CategoryBadge } from './badges'
import './EmployerBadgeGroups.css'

export function EmployerBadgeGroups({ employer: e }: { employer: Employer }) {
  const source = e.source === 'trudvsem' ? 'trudvsem.ru' : sourceName(e.source)
  return (
    <div className="employer-metadata">
      <dl className="employer-badge-groups">
        <div>
          <dt>Джерело інформації</dt>
          <dd>
            <span className="badge" title={sourceName(e.source)}>{source}</span>
            {e.gur_company_id != null && <span className="badge info">ГУР</span>}
          </dd>
        </div>
        <div>
          <dt>Надійність джерела</dt>
          <dd><span className="badge" title="Окремого рейтингу надійності джерела у зібраних даних немає">Не оцінено</span></dd>
        </div>
        <div>
          <dt>Напрям діяльності</dt>
          <dd><CategoryBadge category={e.category} /></dd>
        </div>
        <div>
          <dt>Санкції</dt>
          <dd>{e.sanctions_count > 0 ? <span className="badge hostile">Під санкціями: {e.sanctions_count}</span> : <span className="badge">{e.gur_company_id != null ? 'Не зафіксовано' : 'Немає даних'}</span>}</dd>
        </div>
      </dl>
      <div className="employer-classification">
        <span>Дотичність до ВПК</span>
        <span className={`badge ${e.confirmed_vacancies > 0 ? 'warning' : ''}`} title="За поточною класифікацією вакансій, окремо від надійності джерела">
          {e.confirmed_vacancies > 0 ? 'ВПК підтверджено' : 'ВПК ймовірно'}
        </span>
      </div>
    </div>
  )
}
