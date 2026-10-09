import type { ApiCompanySite } from '../../api/types'
import { siteIcon, SELECTED_COLOR } from '../../components/mapMarkers'

const KIND = { head_office: 'Юридична адреса (головний офіс)', branch: 'Філія або представництво' }
// DaData qc_geo: how precisely the address was put on the map.
const PRECISION = ['', 'найближчий будинок', 'з точністю до вулиці', 'з точністю до населеного пункту']

/** Head office and branches of the company by the register, under its map. */
export function CompanySites({ sites }: { sites: ApiCompanySite[] }) {
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head">
        <div>
          <h3>Адреси підприємства</h3>
          <p>З державного реєстру (ФНС через DaData): юридична адреса і зареєстровані філії. Місця найму з вакансій — зелені кружки на карті.</p>
        </div>
      </div>
      {sites.length === 0 ? (
        <p className="empty-row">Адрес у реєстрі не знайдено: роботодавця не зіставлено з юрособою або її немає в реєстрі РФ.</p>
      ) : (
        <dl className="facts">
          {sites.map((s) => (
            <div key={`${s.kind}:${s.name}:${s.address}`} className="facts-address facts-location">
              <dt>
                <img className="map-legend-pin" src={siteIcon(SELECTED_COLOR, s.kind)} alt="" /> {KIND[s.kind]}
              </dt>
              <dd>
                {s.kind === 'branch' && s.name && <strong>{s.name}</strong>}
                <span>{s.address}</span>
                {!s.on_map ? <span className="location-source">{s.lat == null ? 'не на карті: координат немає' : 'не на карті: місце відоме лише до міста'}</span>
                  : s.geo_qc ? <span className="location-source">{PRECISION[s.geo_qc]}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
