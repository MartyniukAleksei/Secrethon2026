import type { ApiVacancy } from '../api/types'
import { DOMAINS, ROLES } from '../domain/labels'
import { Icon } from '../ui/Icon'
import './VacancyDirection.css'

type Direction = Pick<ApiVacancy, 'direction_domain' | 'direction_role' | 'direction_model' | 'direction_review'>

/** Keep the vacancy's industry separate from the reviews of its connection to the military industry. */
export function VacancyDirection({ vacancy: v, compact = false }: { vacancy: Direction; compact?: boolean }) {
  const classified = Boolean(v.direction_model)
  const domain = DOMAINS[v.direction_domain ?? '']
  const role = ROLES[v.direction_role ?? '']
  const inherited = !classified && Boolean(domain)
  return (
    <span className="vacancy-direction">
      <span className={`badge vacancy-domain${classified && domain ? ' classified' : ''}`}
        title={classified ? 'Автоматична класифікація за текстом цієї вакансії.' : inherited ? 'Галузь підприємства. Окремої класифікації тексту цієї вакансії ще немає.' : 'Галузь цієї вакансії ще не визначено.'}>
        <Icon name="factory" />
        {(inherited || !compact) && `${inherited ? 'Галузь підприємства' : 'Галузь'}: `}{domain ?? 'не визначено'}
      </span>
      {!compact && classified && role && <span className="badge vacancy-role">Вид діяльності: {role}</span>}
      {!compact && classified && v.direction_review && <span className="badge warning vacancy-direction-review"
        title="Модель має низьку впевненість або не визначила одну з категорій. Це не статус перевірки дотичності до ВПК.">Класифікація потребує перевірки</span>}
    </span>
  )
}
