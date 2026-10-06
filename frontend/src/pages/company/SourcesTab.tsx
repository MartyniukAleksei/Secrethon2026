import { longDate } from '../../domain/format'
import { sourceName } from '../../domain/labels'
import type { TabProps } from './CompanyPage'

const ext = (href: string | null | undefined, label: string) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">{label}</a>
  ) : (
    '—'
  )

export function SourcesTab({ employer: e }: TabProps) {
  const gur = e.gur
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3>Джерела</h3></div>
        <dl className="facts">
          <div><dt>Вакансії</dt><dd>{sourceName(e.source)}</dd></div>
          <div><dt>Профіль роботодавця</dt><dd>{ext(e.profile_url, 'Відкрити')}</dd></div>
          <div><dt>Картка в базі ГУР</dt><dd>{ext(gur?.gur_url, 'war-sanctions.gur.gov.ua')}</dd></div>
          <div><dt>Сайт підприємства</dt><dd>{ext(gur?.website, gur?.website?.replace(/^https?:\/\//, '').slice(0, 40) ?? '')}</dd></div>
        </dl>
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
