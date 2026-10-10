import { Link, Navigate, useParams } from 'react-router'
import { api, ApiError } from '../api/client'
import type { ApiEnterprise } from '../api/types'
import { seedOf } from '../charts/geometry'
import { Topo } from '../charts/Topo'
import { usePageTitle } from '../app/pageContext'
import { RelationRows } from '../components/RelationRows'
import { FinancePanel, HiddenAccountsBadge } from '../components/rating/Finance'
import { RatingCard } from '../components/rating/RatingCard'
import { SupplyChainPanel } from '../components/rating/SupplyChain'
import { useApi } from '../data/useApi'
import { longDate, pct } from '../domain/format'
import { GUR_SECTIONS, RELIABILITY_SCALE, reliabilityName, VPK_RELATED, vpkCategoryName } from '../domain/labels'
import { CompanyLogo } from '../ui/CompanyMark'
import { Icon } from '../ui/Icon'
import { NotFoundPage } from './NotFoundPage'
import { CompanySites } from './company/CompanySites'
import './company/CompanyPage.css'
import '../ui/EmployerBadgeGroups.css'
import './EnterprisePage.css'

/** Register statuses as DaData writes them. */
const STATUS: Record<string, string> = {
  ACTIVE: 'діє',
  LIQUIDATING: 'ліквідується',
  LIQUIDATED: 'ліквідовано',
  BANKRUPT: 'банкрутство',
  REORGANIZING: 'реорганізується',
}

/** The company's own site; `company.website` is sometimes a news link, which is not shown. */
function homepage(url: string | null): string | null {
  try {
    const u = new URL(url ?? '')
    return u.pathname.length <= 1 && !u.search ? u.hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

/**
 * A legal entity without an employer card: plants known from GUR bills of materials, foreign
 * companies and others with no vacancies. The same blocks as a card, without hiring.
 */
export function EnterprisePage() {
  const { id = '' } = useParams()
  const companyId = Number(id)
  const state = useApi(`enterprise:${companyId}`, (s) => api.enterprise(companyId, s))
  usePageTitle(state.status === 'ready' ? state.data.name : null)
  if (!Number.isInteger(companyId)) return <NotFoundPage />
  if (state.status === 'error') return state.error instanceof ApiError && state.error.status === 404 ? <NotFoundPage /> : (
    <div className="empty"><h4>Не вдалося завантажити</h4><p>Спробуй оновити сторінку.</p></div>
  )
  if (state.status === 'loading') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="skeleton" style={{ height: 240, borderRadius: 'var(--r-window)' }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--r-window)' }} />
      </div>
    )
  }
  const e = state.data
  // The legal entity has an employer card after all: the card is the page.
  if (e.card_url) return <Navigate to={e.card_url} replace />
  return <Enterprise e={e} />
}

function Enterprise({ e }: { e: ApiEnterprise }) {
  const status = e.liquidated_on ? `ліквідовано ${longDate(e.liquidated_on)}` : e.status ? STATUS[e.status] ?? e.status.toLowerCase() : null
  const gurUrl = e.sections[0]?.url
  return (
    <>
      <div className="crumbs">
        <Link to="/rating">Рейтинг</Link>
        <Icon name="chev" />
        <span>{e.name}</span>
      </div>
      <section className="panel prof-head">
        <div className="prof-band"><Topo seed={seedOf(`enterprise:${e.company_id}`)} /></div>
        <div className="prof-id">
          <div className="logo-tile">
            <CompanyLogo src={e.logo_url} size={72} name={e.name} />
          </div>
          <div className="grow">
            <h1>{e.name}</h1>
            {e.name_full && e.name_full !== e.name && <p className="ent-full">{e.name_full}</p>}
            <p className="place">
              <span className="badge info">Юрособа без вакансій</span>
              {status && <span className={`badge sm ${e.liquidated_on || e.status === 'LIQUIDATED' ? 'hostile' : ''}`}>{status}</span>}
              <HiddenAccountsBadge status={e.finance.disclosure?.status} lastPeriod={e.finance.disclosure?.last_period} />
            </p>
          </div>
        </div>
        <dl className="facts ent-ids">
          <div><dt>ІПН</dt><dd>{e.inn ?? '—'}</dd></div>
          <div><dt>ОДРН</dt><dd>{e.ogrn ?? '—'}</dd></div>
          {e.kpp && <div><dt>КПП</dt><dd>{e.kpp}</dd></div>}
          <div><dt>Країна</dt><dd>{e.country ?? '—'}</dd></div>
          {e.registry?.head && <div><dt>Керівник</dt><dd>{e.registry.head}</dd></div>}
          {homepage(e.website) && <div><dt>Сайт</dt><dd><a href={e.website!} target="_blank" rel="noreferrer noopener">{homepage(e.website)}</a></dd></div>}
        </dl>
        <Classification e={e} />
      </section>

      <div className="ent-body">
        <RatingCard rating={e.rating} companyId={e.company_id} />
        <SupplyChainPanel chain={e.supply_chain} />
        <FinancePanel finance={e.finance} />
        <section className="panel">
          <div className="panel-head"><h3>Про підприємство</h3></div>
          <div className="prose-block">
            {e.description_uk ? <p>{e.description_uk}</p> : <p className="src">Опису на порталі ГУР немає.</p>}
            {e.products_uk?.length ? <p>Продукція: {e.products_uk.join(', ')}</p> : null}
            {e.address && <p>Адреса: {e.address}</p>}
            {gurUrl && e.description_uk && (
              <p className="src"><a href={gurUrl} target="_blank" rel="noreferrer noopener">Джерело опису: War & Sanctions (ГУР)</a></p>
            )}
          </div>
          {e.sanctions.length > 0 && (
            <>
              <h4 className="ent-sub">Санкції</h4>
              <dl className="facts">
                {e.sanctions.map((s) => (
                  <div key={s.jurisdiction}>
                    <dt>{s.jurisdiction_name ?? s.jurisdiction}</dt>
                    <dd>{s.listed_on ? `з ${longDate(s.listed_on)}` : 'дата не вказана'}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {e.classification?.sanctions_new?.length ? (
            <p className="src ent-pad">Знайдено у відкритих джерелах: {e.classification.sanctions_new.join(', ')}</p>
          ) : null}
          <h4 className="ent-sub">Зв’язки з іншими підприємствами</h4>
          <div className="ent-pad"><RelationRows relations={e.relations} /></div>
        </section>
        <CompanySites sites={e.sites} />
        <section className="panel">
          <div className="panel-head"><h3>Джерела</h3></div>
          <dl className="facts">
            {e.sections.length ? e.sections.map((s) => (
              <div key={s.section}>
                <dt>ГУР: {GUR_SECTIONS[s.section] ?? s.section}</dt>
                <dd>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">war-sanctions.gur.gov.ua</a> : '—'}</dd>
              </div>
            )) : <div><dt>Портал ГУР</dt><dd>немає профілю</dd></div>}
            <div><dt>Реквізити й адреси</dt><dd>реєстр ФНС (ЄДРЮО) через DaData</dd></div>
          </dl>
        </section>
      </div>
    </>
  )
}

/** Final ВПК decision for the legal entity, as on a card (same look as EmployerBadgeGroups). */
function Classification({ e }: { e: ApiEnterprise }) {
  const cls = e.classification
  if (!cls) {
    return (
      <div className="employer-metadata ent-cls">
        <div className="employer-classification">
          <span>Дотичність до ВПК</span>
          <span className="badge">Ще не класифіковано</span>
        </div>
      </div>
    )
  }
  return (
    <div className="employer-metadata ent-cls">
      <dl className="employer-badge-groups">
        <div>
          <dt>Джерело інформації</dt>
          <dd>{e.sections.length > 0 ? <span className="badge info">ГУР</span> : <span className="badge">реєстр</span>}</dd>
        </div>
        <div>
          <dt className="has-hint" title={RELIABILITY_SCALE}>Надійність джерела</dt>
          <dd>
            {cls.reliability
              ? <span className="badge info" title={[reliabilityName(cls.reliability), cls.reliability_note].filter(Boolean).join('\n')}>{cls.reliability.trim()}</span>
              : <span className="badge">Не оцінено</span>}
          </dd>
        </div>
        <div>
          <dt>Напрям діяльності</dt>
          <dd>{cls.direction_label ? <span className="badge">{cls.direction_label}</span> : <span className="badge">Не визначено</span>}</dd>
        </div>
        <div>
          <dt>Санкції</dt>
          <dd><span className={`badge ${e.sanctions.length ? 'hostile' : ''}`}>{e.sanctions.length ? 'Під санкціями' : 'Не зафіксовано'}</span></dd>
        </div>
      </dl>
      <div className="employer-classification">
        <span>Дотичність до ВПК</span>
        <span className={`badge ${VPK_RELATED.has(cls.vpk_category) ? 'warning' : ''}`} title="За підсумковою класифікацією підприємства">
          {vpkCategoryName(cls.vpk_category)} · {cls.vpk_probability != null ? pct(cls.vpk_probability) : 'за правилом'}
        </span>
        {cls.vpk_level === 'review' && <span className="badge sm">на перевірці</span>}
      </div>
      {cls.explanation && (
        <details className="classification-why">
          <summary>Чому так</summary>
          <p lang="ru">{cls.explanation}</p>
        </details>
      )}
    </div>
  )
}
