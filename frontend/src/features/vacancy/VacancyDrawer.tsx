import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { AskButton } from '../../components/AskButton'
import { useData } from '../../data/DataContext'
import { useApi } from '../../data/useApi'
import { ago, salaryRange } from '../../domain/format'
import { experienceName, sourceName } from '../../domain/labels'
import { CategoryBadge, LevelBadge } from '../../ui/badges'
import { Icon } from '../../ui/Icon'
import './VacancyDrawer.css'

const SECTIONS: [keyof Texts, string][] = [
  ['responsibilities', 'Обов\'язки'],
  ['requirements', 'Вимоги'],
  ['conditions', 'Умови'],
  ['description', 'Опис'],
]
type Texts = { responsibilities: string | null; requirements: string | null; conditions: string | null; description: string | null }

export function VacancyDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { asOf, byId } = useData()
  const closeRef = useRef<HTMLButtonElement>(null)
  const state = useApi(`vacancy:${id}`, (signal) => api.vacancy(id, signal))

  useEffect(() => closeRef.current?.focus(), [id])

  return (
    <div className="drawer-bd" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-label="Вакансія">
        <div className="pop-top">
          <button ref={closeRef} className="btn btn-secondary btn-icon btn-sm" type="button" aria-label="Закрити" onClick={onClose}>
            <Icon name="x" />
          </button>
          {state.status === 'ready' && (
            <span className="kind">
              {sourceName(state.data.source)}, {ago(state.data.published_at, asOf)}
            </span>
          )}
        </div>
        {state.status === 'loading' && <div className="skeleton" style={{ height: 240, marginTop: 16 }} />}
        {state.status === 'error' && <p className="empty-row">Не вдалося завантажити вакансію.</p>}
        {state.status === 'ready' && (() => {
          const v = state.data
          // Only employers with ВПК vacancies have a profile page.
          const employer = v.employer_id != null ? byId[v.employer_id] : undefined
          const exp = experienceName(v.experience)
          // Some sources repeat the description in several fields; show each distinct text once.
          const seen = new Set<string>()
          const texts = SECTIONS.filter(([k]) => {
            const t = v[k]?.trim()
            if (!t || seen.has(t)) return false
            seen.add(t)
            return true
          })
          return (
            <>
              <h2>{v.title}</h2>
              <p className="place" style={{ marginTop: 4 }}>
                <Icon name="pin" />
                {employer ? <Link to={`/companies/${employer.id}`}>{v.employer_name}</Link> : v.employer_name}
                {v.locality ? `, ${v.locality}` : ''}
              </p>
              <p className="pay-big">{salaryRange(v) ?? 'Зарплату не вказано'}</p>
              <div className="badges">
                <LevelBadge level={v.level} />
                {v.category && <CategoryBadge category={v.category} />}
                {exp && <span className="badge">{exp}</span>}
                {v.schedule && v.schedule !== 'OTHER' && <span className="badge">{v.schedule}</span>}
                {v.employment && <span className="badge">{v.employment}</span>}
              </div>
              {v.address && (
                <>
                  <h5>Адреса</h5>
                  <p className="drawer-text">{v.address}</p>
                </>
              )}
              {texts.map(([k, label]) => (
                <div key={k}>
                  <h5>{label}</h5>
                  <p className="drawer-text">{v[k]}</p>
                </div>
              ))}
              {v.skills_raw && (
                <>
                  <h5>Навички</h5>
                  <p className="drawer-text">{v.skills_raw}</p>
                </>
              )}
              <div className="drawer-actions">
                <a className="btn btn-secondary btn-sm" href={v.url} target="_blank" rel="noreferrer noopener">
                  <Icon name="external" />
                  Оригінал оголошення
                </a>
                <AskButton question={`Що ця вакансія «${v.title}» каже про ${v.employer_name ?? 'роботодавця'}?`} />
                {employer && (
                  <Link className="btn btn-primary btn-sm" to={`/companies/${employer.id}`}>
                    Профіль роботодавця
                  </Link>
                )}
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}
