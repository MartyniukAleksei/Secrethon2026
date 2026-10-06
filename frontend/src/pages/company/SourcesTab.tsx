import { longDate } from '../../domain/format'
import { sourceName } from '../../domain/labels'
import type { TabProps } from './CompanyPage'

const ext = (href: string | null | undefined, label: string) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">{label}</a>
  ) : (
    '—'
  )

const VISIBLE_HIRING_LOCATIONS = 3

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
  const extraLocations = hiringLocations.slice(VISIBLE_HIRING_LOCATIONS)
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3>Джерела</h3></div>
        <dl className="facts">
          <div><dt>Вакансії</dt><dd>{sourceName(e.source)}</dd></div>
          <div><dt>Профіль роботодавця</dt><dd>{ext(e.profile_url, 'Відкрити')}</dd></div>
          <div><dt>Картка в базі ГУР</dt><dd>{ext(gur?.gur_url, 'war-sanctions.gur.gov.ua')}</dd></div>
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
          {hiringLocations.slice(0, VISIBLE_HIRING_LOCATIONS).map((place) => (
            <HiringLocation key={place.vacancy_id} place={place} />
          ))}
        </dl>
        {extraLocations.length > 0 && (
          <details key={e.id} className="hiring-more">
            <summary>
              <span className="hiring-more-show">Показати ще місця найму ({extraLocations.length})</span>
              <span className="hiring-more-hide">Згорнути місця найму</span>
            </summary>
            <dl className="facts">
              {extraLocations.map((place) => <HiringLocation key={place.vacancy_id} place={place} />)}
            </dl>
          </details>
        )}
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
