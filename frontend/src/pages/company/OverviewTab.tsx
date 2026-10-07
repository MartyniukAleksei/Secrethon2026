import { categoryOf } from '../../domain/labels'
import type { TabProps } from './CompanyPage'

export function OverviewTab({ employer: e }: TabProps) {
  const gur = e.gur
  const category = categoryOf(e.category)
  const tags = [...new Set([
    ...(category.key ? [category.name] : []),
    ...(gur?.activity_tags ?? []),
    ...(gur?.products_uk ?? []),
  ].map((tag) => tag.trim()).filter(Boolean))]

  return (
    <div className="prof-overview">
      <section className="panel">
        <div className="panel-head"><h3>Напрями діяльності</h3></div>
        {tags.length > 0 ? (
          <ul className="activity-tags" aria-label="Напрями діяльності та продукція">
            {tags.map((tag) => <li className="badge" key={tag}>{tag}</li>)}
          </ul>
        ) : <p className="empty-row">Дані про напрями діяльності поки відсутні.</p>}
        {tags.length > 0 && (
          <p className="analytics-note">Напрям — за класифікацією вакансій; продукція та зв’язки з БпЛА й озброєнням — за даними ГУР.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Про підприємство</h3></div>
        <div className="prose-block">
          {gur?.description_uk?.trim() ? <p>{gur.description_uk}</p> : (
            <p className="src">Опис підприємства поки відсутній у профілі.</p>
          )}
          {gur?.address_uk && <p>Місце підприємства: {gur.address_uk}</p>}
          {gur?.description_uk && gur.gur_url && (
            <p className="src"><a href={gur.gur_url} target="_blank" rel="noreferrer noopener">Джерело опису: War & Sanctions (ГУР)</a></p>
          )}
        </div>
      </section>
    </div>
  )
}
