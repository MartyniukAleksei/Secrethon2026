import { Link } from 'react-router'
import { usePageTitle } from '../app/pageContext'

export function NotFoundPage() {
  usePageTitle('Сторінку не знайдено')
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <h4>Сторінку не знайдено</h4>
      <p>Можливо, посилання застаріло. Почни з огляду.</p>
      <Link className="btn btn-secondary btn-sm" to="/">На огляд</Link>
    </div>
  )
}
