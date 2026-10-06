import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <h4>Сторінку не знайдено</h4>
      <p>Можливо, посилання застаріло. Почни з огляду.</p>
      <Link className="btn btn-secondary btn-sm" to="/">На огляд</Link>
    </div>
  )
}
