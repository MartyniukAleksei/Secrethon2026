import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ApiEmployerReview } from '../api/types'
import type { Dataset } from '../domain/types'
import { DataContext } from './DataContext'
import { loadDataset } from './load'
import './DataProvider.css'

type Loaded = Omit<Dataset, 'applyHumanReview'>
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Loaded }

function withReview(data: Loaded, review: ApiEmployerReview): Loaded {
  const employers = data.employers.map((e) => (e.id === review.employer_id ? { ...e, human_review: review } : e))
  return { ...data, employers, byId: Object.fromEntries(employers.map((e) => [e.id, e])) }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    loadDataset(ctrl.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) {
          console.error(err)
          setState({ status: 'error' })
        }
      })
    return () => ctrl.abort()
  }, [attempt])

  const applyHumanReview = useCallback((review: ApiEmployerReview) => {
    setState((s) => (s.status === 'ready' ? { status: 'ready', data: withReview(s.data, review) } : s))
  }, [])
  const value = useMemo(
    () => (state.status === 'ready' ? { ...state.data, applyHumanReview } : null),
    [state, applyHumanReview],
  )

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="data-gate" aria-busy="true" aria-label="Завантаження даних">
        <div className="skeleton" style={{ height: 56, borderRadius: 'var(--r-control)' }} />
        <div className="data-gate-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 116 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 380, borderRadius: 'var(--r-window)' }} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="data-gate">
        <div className="empty">
          <h4>Не вдалося завантажити дані</h4>
          <p>Сервер платформи не відповідає. Перевір, що бекенд запущений, і спробуй ще раз.</p>
          <button className="btn btn-secondary btn-sm" type="button" onClick={retry}>
            Спробувати ще раз
          </button>
        </div>
      </div>
    )
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
