import type { ReactNode } from 'react'
import { longDate } from '../domain/format'
import { autoVpk, categoryOf, effectiveVpk, HUMAN_SANCTIONS, HUMAN_SOURCES, HUMAN_VPK, RELIABILITY, sourceName } from '../domain/labels'
import type { Employer } from '../domain/types'
import { CategoryBadge } from './badges'
import { Icon } from './Icon'
import './EmployerBadgeGroups.css'

export function EmployerBadgeGroups({ employer: e }: { employer: Employer }) {
  const hr = e.human_review
  const source = e.source === 'trudvsem' ? 'trudvsem.ru' : sourceName(e.source)
  const autoSanctions = e.sanctions_count > 0 ? `Під санкціями: ${e.sanctions_count}` : e.gur_company_id != null ? 'Не зафіксовано' : 'Немає даних'
  const vpk = effectiveVpk(e)
  // Shown on hover over a reviewed value: who reviewed it and what was collected automatically.
  const reviewed = (auto: string) => hr && `Human review: ${hr.reviewed_by}, ${longDate(hr.reviewed_at)} · Авто: ${auto}`
  const human = (auto: string, children: ReactNode) => (
    <>
      {children}
      <span className="badge human-mark" title={reviewed(auto) ?? undefined}><Icon name="check" />Human</span>
    </>
  )
  return (
    <div className="employer-metadata">
      <dl className="employer-badge-groups">
        <div>
          <dt>Джерело інформації</dt>
          <dd>
            {hr?.sources
              ? human(`${source}${e.gur_company_id != null ? ', ГУР' : ''}`, hr.sources.map((s) => <span key={s} className="badge info">{HUMAN_SOURCES[s]}</span>))
              : <>
                  <span className="badge" title={sourceName(e.source)}>{source}</span>
                  {e.gur_company_id != null && <span className="badge info">ГУР</span>}
                </>}
          </dd>
        </div>
        <div>
          <dt>Надійність джерела</dt>
          <dd>
            {hr?.reliability
              ? human('не оцінено', <span className="badge info">{hr.reliability} · {RELIABILITY[hr.reliability]}</span>)
              : <span className="badge" title="Окремого рейтингу надійності джерела у зібраних даних немає">Не оцінено</span>}
          </dd>
        </div>
        <div>
          <dt>Напрям діяльності</dt>
          <dd>{hr?.category ? human(categoryOf(e.category).name, <CategoryBadge category={hr.category} />) : <CategoryBadge category={e.category} />}</dd>
        </div>
        <div>
          <dt>Санкції</dt>
          <dd>
            {hr?.sanctions
              ? human(autoSanctions, <span className={`badge ${hr.sanctions === 'sanctioned' ? 'hostile' : ''}`}>{HUMAN_SANCTIONS[hr.sanctions]}</span>)
              : <span className={`badge ${e.sanctions_count > 0 ? 'hostile' : ''}`}>{autoSanctions}</span>}
          </dd>
        </div>
      </dl>
      <div className="employer-classification">
        <span>Дотичність до ВПК</span>
        {hr?.vpk
          ? human(HUMAN_VPK[autoVpk(e)], <span className={`badge ${vpk === 'no' ? '' : 'warning'}`}>{HUMAN_VPK[vpk]}</span>)
          : <span className={`badge ${vpk === 'confirmed' ? 'warning' : ''}`} title="За поточною класифікацією вакансій, окремо від надійності джерела">{HUMAN_VPK[vpk]}</span>}
      </div>
    </div>
  )
}
