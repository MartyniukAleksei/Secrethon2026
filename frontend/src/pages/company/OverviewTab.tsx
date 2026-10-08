import type { ReactNode } from 'react'
import type { ApiProfileSource } from '../../api/types'
import { longDate } from '../../domain/format'
import { categoryOf, effectiveCategory } from '../../domain/labels'
import type { TabProps } from './CompanyPage'
import { GurAbout } from './GurAbout'
import { useGurAbout } from './useGurAbout'

const SOURCE_TYPES: Record<ApiProfileSource['source_type'], string> = {
  official_site: 'сайт компанії',
  registry: 'реєстр',
  sanctions_document: 'санкційний документ',
  news: 'ЗМІ',
  aggregator: 'агрегатор даних',
  other: 'інше джерело',
}

const uniq = (items: string[]) => [...new Set(items.map((tag) => tag.trim()).filter(Boolean))]

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Turns [n] into superscript links to verified sources; numbers without a verified source are dropped. */
function withCitations(text: string, sources: ApiProfileSource[]): ReactNode[] {
  const byN = new Map(sources.map((s) => [s.n, s]))
  return text.split(/(\[\d+\])/).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part)
    if (!m) return part
    const source = byN.get(Number(m[1]))
    if (!source) return null
    return (
      <sup key={i}>
        <a href={source.url} target="_blank" rel="noreferrer noopener" title={source.quote}>[{source.n}]</a>
      </sup>
    )
  })
}

export function OverviewTab({ employer: e }: TabProps) {
  const gur = e.gur
  const profile = e.profile
  const category = categoryOf(effectiveCategory(e))
  // The company's own direction wins over the vacancy category, unless a human set the category.
  const direction = !e.human_review?.category ? e.classification?.direction_label : undefined
  const baseTags = uniq([
    ...(direction ? [direction] : category.key ? [category.name] : []),
    ...(gur?.activity_tags ?? []),
    ...(gur?.products_uk ?? []),
  ])
  const tags = uniq([...baseTags, ...(profile?.activity_tags ?? []), ...(profile?.products_ru ?? [])])
  const fromOpenSources = tags.length > baseTags.length
  const gurDescription = gur?.description_uk?.trim()
  const profileDescription = !gurDescription ? profile?.description_ru?.trim() : undefined
  const gurAbout = useGurAbout(gurDescription ? gur?.company_id : undefined)
  const probableMatch = (e.company_link === 'candidate' || gur?.match === 'name') && (
    <span className="badge warning sm" title="Юрособу знайдено за назвою чи сайтом, а не за ІПН">зв’язок з юрособою ймовірний</span>
  )

  return (
    <div className="prof-overview">
      <section className="panel">
        <div className="panel-head"><h3>Напрями діяльності</h3>{probableMatch}</div>
        {tags.length > 0 ? (
          <ul className="activity-tags" aria-label="Напрями діяльності та продукція">
            {tags.map((tag) => <li className="badge" key={tag}>{tag}</li>)}
          </ul>
        ) : <p className="empty-row">Дані про напрями діяльності поки відсутні.</p>}
        {tags.length > 0 && (
          <p className="analytics-note">
            Напрям — {direction ? 'за підсумковою класифікацією підприємства' : 'за класифікацією вакансій'}; продукція та зв’язки з БпЛА й озброєнням — за даними ГУР
            {fromOpenSources ? '; частина напрямів — за відкритими джерелами' : ''}.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Про підприємство</h3>{probableMatch}</div>
        {gurAbout && gur ? <GurAbout about={gurAbout} gur={gur} /> : (
          <div className="prose-block">
            {gurDescription ? <p>{gurDescription}</p> : profileDescription && profile ? (
              <p lang="ru">{withCitations(profileDescription, profile.sources)}</p>
            ) : (
              <p className="src">Опис підприємства поки відсутній у профілі.</p>
            )}
            {gur?.address_uk && <p>Місце підприємства: {gur.address_uk}</p>}
            {gurDescription && gur?.gur_url && (
              <p className="src"><a href={gur.gur_url} target="_blank" rel="noreferrer noopener">Джерело опису: War & Sanctions (ГУР)</a></p>
            )}
            {profileDescription && profile && (
              <>
                {profile.sources.length > 0 && (
                  <div className="profile-sources">
                    <p>Джерела:</p>
                    <ol>
                      {profile.sources.map((s) => (
                        <li key={s.n} value={s.n}>
                          <a href={s.url} target="_blank" rel="noreferrer noopener" title={s.quote}>{domainOf(s.url)}</a>
                          {' '}<span className="src">— {SOURCE_TYPES[s.source_type] ?? s.source_type}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <p className="src">
                  Опис зібрано автоматично з відкритих джерел, мовою оригіналу ({longDate(profile.updated_at)}).
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
