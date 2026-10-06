import { useState } from 'react'
import { api } from '../../api/client'
import { VacancyRow } from '../../components/rows'
import { useApi } from '../../data/useApi'
import { fmt, plural } from '../../domain/format'
import type { TabProps } from './CompanyPage'

const PAGE = 30

export function VacanciesTab({ employer }: TabProps) {
  const [page, setPage] = useState(0)
  const state = useApi(`emp-vac:${employer.id}:${page}`, (signal) =>
    api.vacancies({ employer_id: employer.id, limit: PAGE, offset: page * PAGE }, signal),
  )
  const data = state.status === 'ready' ? state.data : state.status === 'loading' ? state.stale : undefined
  const pages = data ? Math.ceil(data.total / PAGE) : 0

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>Вакансії ВПК</h3>
          <p>
            {data ? `${fmt(data.total)} ${plural(data.total, 'оголошення', 'оголошення', 'оголошень')}, нові спершу` : 'Завантаження…'}
          </p>
        </div>
      </div>
      {state.status === 'error' && <p className="empty-row">Не вдалося завантажити вакансії.</p>}
      <div className="vac-rows" style={{ opacity: state.status === 'loading' ? 0.6 : 1 }}>
        {data?.items.map((v) => <VacancyRow key={v.id} vacancy={v} showEmployer={false} />)}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-secondary btn-sm" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
          <span>{page + 1} з {pages}</span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Далі</button>
        </div>
      )}
    </div>
  )
}
