import type { ReactNode } from 'react'
import type { ApiGurCompany } from '../../api/types'
import type { GurAboutData } from './useGurAbout'

const MONTHS = ['січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'вер.', 'жовт.', 'лист.', 'груд.']

/** "2023-05" → "трав. 2023", "2022" stays as is. */
function monthYear(value: string | null) {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})/.exec(value)
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : value
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="about-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function GurAbout({ about, gur }: { about: GurAboutData; gur: ApiGurCompany }) {
  const withRecipient = about.cooperation.some((c) => c.recipient)
  return (
    <div className="gur-about">
      <dl className="about-list">
        <Row label="Коротко"><p className="about-summary">{about.summary}</p></Row>
        {about.owners.length > 0 && (
          <Row label="Належність">
            <ul className="about-owners">
              {about.owners.map((o, i) => (
                <li key={i}>
                  <span>{o.chain.join(' → ')}</span>
                  <span className="badge sm">{o.relation}{o.since ? ` з ${monthYear(o.since)}` : ''}</span>
                </li>
              ))}
            </ul>
          </Row>
        )}
        {about.products.length > 0 && (
          <Row label="Продукція">
            {about.products.map((p, i) => (
              <div className="about-products" key={i}>
                {p.group && <p className="about-group">{p.group}</p>}
                <ul className="activity-tags">
                  {p.items.map((item) => <li className="badge" key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </Row>
        )}
        {about.customers.length > 0 && <Row label="Замовники">{about.customers.join('; ')}</Row>}
        {about.licenses.length > 0 && (
          <Row label="Ліцензії">
            <ul className="about-plain">
              {about.licenses.map((l) => (
                <li key={l.number}>
                  {l.issued && <span className="about-date">{monthYear(l.issued)}</span>} № {l.number} — {l.scope}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {gur.address_uk && <Row label="Адреса">{gur.address_uk}</Row>}
        {about.other_facts.length > 0 && (
          <Row label="Інше">
            <ul className="about-plain">{about.other_facts.map((f) => <li key={f}>{f}</li>)}</ul>
          </Row>
        )}
      </dl>

      {about.cooperation.length > 0 && (
        <div className="about-coop">
          <h4>Участь у кооперації</h4>
          <div className="table-wrap">
            <table className="data about-coop-table">
              <thead>
                <tr><th>Програма</th><th>Роль</th><th>Що постачає</th>{withRecipient && <th>Кому</th>}</tr>
              </thead>
              <tbody>
                {about.cooperation.map((c, i) => (
                  <tr key={i}>
                    <td>{c.program}</td>
                    <td>{c.role}</td>
                    <td>{c.supplies.length > 1 ? <ul>{c.supplies.map((s) => <li key={s}>{s}</li>)}</ul> : c.supplies[0] ?? '—'}</td>
                    {withRecipient && <td>{c.recipient ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <details className="about-full">
        <summary>Повний опис ГУР</summary>
        <p>{gur.description_uk}</p>
      </details>
      <p className="src">
        Поля виділено автоматично з опису ГУР; при розбіжностях правильним є повний опис.
        {gur.gur_url && <> <a href={gur.gur_url} target="_blank" rel="noreferrer noopener">Джерело: War & Sanctions (ГУР)</a></>}
      </p>
    </div>
  )
}
