import type { ReactNode } from 'react'
import { longDate, pct, plural } from '../domain/format'
import { autoDirectionName, autoReliabilityName, autoVpkName, effectiveVpk, FOCUS, focusTitle, HUMAN_SANCTIONS, HUMAN_SOURCES, HUMAN_VPK, RELIABILITY, RELIABILITY_SCALE, reliabilityName, sanctionsOf, sourceName, VPK_CATEGORY, VPK_RELATED, vpkCategoryName } from '../domain/labels'
import type { Employer, EmployerDetail } from '../domain/types'
import { CategoryBadge } from './badges'
import { Icon } from './Icon'
import './EmployerBadgeGroups.css'

/** Lists carry the short classification; the company page adds sanctions found and the explanation. */
type Props = { employer: Employer | EmployerDetail }

export function EmployerBadgeGroups({ employer: e }: Props) {
  const hr = e.human_review
  const cls = e.classification
  const details = 'explanation' in (cls ?? {}) ? (cls as NonNullable<EmployerDetail['classification']>) : null
  const agency = e.agency?.category === 'agency_vpk' ? e.agency : null
  const source = e.source === 'trudvsem' ? 'trudvsem.ru' : sourceName(e.source)
  // Every jurisdiction counts once: GUR's and those found in open sources besides.
  const sanctions = sanctionsOf(e)
  const jurisdictions = (n: number) => `${n} ${plural(n, 'юрисдикція', 'юрисдикції', 'юрисдикцій')}`
  const autoSanctions =
    sanctions.total > 0
      ? `Санкції: ${jurisdictions(sanctions.total)}${cls ? ` (${sanctions.gur} за ГУР + ${sanctions.extra} знайдено додатково)` : ''}`
      : e.gur_company_id != null || cls ? 'Не зафіксовано' : 'Немає даних'
  const newSanctionsTitle = details?.sanctions_found
    .filter((s) => !s.in_gur)
    .map((s) => [s.jurisdiction, s.list_name, s.listed_raw && `з ${s.listed_raw}`].filter(Boolean).join(' · '))
    .join('\n')
  const vpk = effectiveVpk(e)
  // Shown on hover over a reviewed value: who reviewed it and what was collected automatically.
  const reviewed = (auto: string) => hr && `Human review: ${hr.reviewed_by}, ${longDate(hr.reviewed_at)} · Авто: ${auto}`
  const human = (auto: string, children: ReactNode) => (
    <>
      {children}
      <span className="badge human-mark" title={reviewed(auto) ?? undefined}><Icon name="check" />Human</span>
    </>
  )
  const onReview = <span className="badge sm">на перевірці</span>
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
          <dt className="has-hint" title={RELIABILITY_SCALE}>Надійність джерела</dt>
          <dd>
            {hr?.reliability
              ? human(autoReliabilityName(e), <span className="badge info">{hr.reliability} · {RELIABILITY[hr.reliability]}</span>)
              : cls?.reliability
                ? <span className="badge info" title={[reliabilityName(cls.reliability), cls.reliability_note].filter(Boolean).join('\n')}>{cls.reliability.trim()}</span>
                : <span className="badge" title="Окремого рейтингу надійності джерела у зібраних даних немає">Не оцінено</span>}
          </dd>
        </div>
        <div>
          <dt>Напрям діяльності</dt>
          <dd>
            {hr?.category
              ? human(autoDirectionName(e), <CategoryBadge category={hr.category} />)
              : cls?.direction_label
                ? <>
                    <span className="badge" title="За підсумковою класифікацією підприємства">{cls.direction_label}</span>
                    {cls.direction_secondary && <span className="badge-note">також: {cls.direction_secondary}</span>}
                  </>
                : <CategoryBadge category={e.category} />}
          </dd>
        </div>
        {e.focus && (
          <div>
            <dt>Фокус</dt>
            <dd>
              {e.focus.length
                ? e.focus.map((f) => <span key={f.focus} className="badge warning" title={focusTitle(f)}>{FOCUS[f.focus]}</span>)
                : <span className="badge" title="Підприємство ВПК без ознак БпЛА, ракет чи КАБ">{FOCUS.other}</span>}
            </dd>
          </div>
        )}
        <div>
          <dt>Санкції</dt>
          <dd>
            {hr?.sanctions
              ? human(autoSanctions, <span className={`badge ${hr.sanctions === 'sanctioned' ? 'hostile' : ''}`}>{HUMAN_SANCTIONS[hr.sanctions]}</span>)
              : <span
                  className={`badge ${sanctions.total > 0 ? 'hostile' : ''}`}
                  title={[sanctions.total > 0 && autoSanctions, sanctions.codes.join(', '), newSanctionsTitle].filter(Boolean).join('\n') || undefined}
                >
                  {sanctions.total > 0 ? 'Під санкціями' : autoSanctions}
                </span>}
          </dd>
        </div>
      </dl>
      <div className="employer-classification">
        <span>Дотичність до ВПК</span>
        {hr?.vpk
          ? human(autoVpkName(e), <span className={`badge ${vpk === 'no' ? '' : 'warning'}`}>{HUMAN_VPK[vpk]}</span>)
          : cls
            ? <>
                <span className={`badge ${VPK_RELATED.has(cls.vpk_category) ? 'warning' : ''}`} title="За підсумковою класифікацією підприємства">
                  {vpkCategoryName(cls.vpk_category)} · {cls.vpk_probability != null ? pct(cls.vpk_probability) : 'за правилом'}
                </span>
                {cls.vpk_level === 'review' && onReview}
              </>
            : agency
              ? <>
                  <span className="badge warning" title={agency.raw_label}>{VPK_CATEGORY.agency_vpk}</span>
                  {agency.level === 'review' && onReview}
                </>
              : <span className={`badge ${vpk === 'confirmed' ? 'warning' : ''}`} title="За поточною класифікацією вакансій, окремо від надійності джерела">{HUMAN_VPK[vpk]}</span>}
      </div>
      {details?.explanation && !hr?.vpk && (
        <details className="classification-why">
          <summary>Чому так</summary>
          <p lang="ru">{withLinks(details.explanation)}</p>
        </details>
      )}
    </div>
  )
}

/** Plain-text explanation with its source URLs made clickable. */
function withLinks(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s)]+)/).map((part, i) =>
    i % 2 ? <a key={i} href={part} target="_blank" rel="noreferrer noopener">{part}</a> : part,
  )
}
