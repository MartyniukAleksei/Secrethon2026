import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Dataset } from '../domain/types'
import { DataContext } from './DataContext'
import { loadDataset } from './load'
import './DataProvider.css'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Dataset }

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
  return <DataContext.Provider value={state.data}>{children}</DataContext.Provider>
}
