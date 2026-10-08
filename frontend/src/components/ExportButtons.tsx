import { Link } from 'react-router'
import { Icon } from '../ui/Icon'

export type ExportOption = { label: string; href: string } | { label: string; onClick: () => void }

/** "Export the current view" buttons; the label links to the open data page. */
export function ExportButtons({ options }: { options: ExportOption[] }) {
  return (
    <div className="row" role="group" aria-label="Експорт поточної вибірки">
      <Link className="btn btn-ghost btn-sm" to="/open-data" title="Усі датасети та API">
        <Icon name="download" />
        Експорт
      </Link>
      {options.map((o) =>
        'href' in o ? (
          <a key={o.label} className="btn btn-secondary btn-sm" href={o.href} download>
            {o.label}
          </a>
        ) : (
          <button key={o.label} className="btn btn-secondary btn-sm" type="button" onClick={o.onClick}>
            {o.label}
          </button>
        ),
      )}
    </div>
  )
}
