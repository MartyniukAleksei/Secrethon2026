import { Link } from 'react-router'
import { longDate } from '../../domain/format'
import { GUR_SECTIONS, sourceName } from '../../domain/labels'
import type { TabProps } from './CompanyPage'

const ext = (href: string | null | undefined, label: string) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">{label}</a>
  ) : (
    '—'
  )

function HiringLocation({ place }: { place: TabProps['employer']['hiring_locations'][number] }) {
  return (
    <div className="facts-address facts-location">
      <dt>Місце найму</dt>
      <dd>
        <span>{place.address ?? place.locality ?? `Координати: ${place.lat}, ${place.lng}`}</span>
        <span className="location-source">{ext(place.vacancy_url, sourceName(place.source))}</span>
      </dd>
    </div>
  )
}

export function SourcesTab({ employer: e }: TabProps) {
  const gur = e.gur
  const companyAddress = gur?.address_uk?.trim()
  const hiringLocations = e.hiring_locations ?? []
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3>Джерела</h3></div>
        <dl className="facts">
          <div><dt>Вакансії</dt><dd>{sourceName(e.source)}</dd></div>
          <div><dt>Профіль роботодавця</dt><dd>{ext(e.profile_url, 'Відкрити')}</dd></div>
          {e.sections.length > 0 ? e.sections.map((s) => (
            <div key={s.section}><dt>ГУР: {GUR_SECTIONS[s.section] ?? s.section}</dt><dd>{ext(s.url, 'war-sanctions.gur.gov.ua')}</dd></div>
          )) : <div><dt>Картка в базі ГУР</dt><dd>{ext(gur?.gur_url, 'war-sanctions.gur.gov.ua')}</dd></div>}
          {e.supply_chain && e.supply_chain.claims.length > 0 && (
            <div>
              <dt>Цитати про постачання систем озброєння</dt>
              <dd><Link to={`/companies/${e.id}/supply`}>{e.supply_chain.claims.length}</Link></dd>
            </div>
          )}
          {companyAddress && (
            <div className="facts-address facts-location">
              <dt>Місце підприємства</dt>
              <dd>
                <span>{companyAddress}</span>
                <span className="location-source">{gur?.gur_url ? ext(gur.gur_url, 'War & Sanctions (ГУР)') : 'War & Sanctions (ГУР)'}</span>
              </dd>
            </div>
          )}
          <div><dt>Сайт підприємства</dt><dd>{ext(gur?.website, gur?.website?.replace(/^https?:\/\//, '').slice(0, 40) ?? '')}</dd></div>
        </dl>
        <details key={e.id} className="hiring-more">
          <summary>Місце найму ({hiringLocations.length})</summary>
          {hiringLocations.length > 0 ? (
            <dl className="facts">
              {hiringLocations.map((place) => <HiringLocation key={place.vacancy_id} place={place} />)}
            </dl>
          ) : <p className="empty-row">Місця найму не зібрано.</p>}
        </details>
      </div>
      {gur && gur.sanctions.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-head">
            <div>
              <h3>Санкції</h3>
              <p>{gur.name_full_uk}</p>
            </div>
          </div>
          <dl className="facts">
            {gur.sanctions.map((s) => (
              <div key={s.jurisdiction}>
                <dt>{s.jurisdiction_name ?? s.jurisdiction}</dt>
                <dd>{s.listed_on ? `з ${longDate(s.listed_on)}` : 'дата не вказана'}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  )
}
