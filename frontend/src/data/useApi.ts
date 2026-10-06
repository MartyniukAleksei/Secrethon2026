import { useEffect, useState } from 'react'

export type ApiState<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T }

/**
 * Runs `load` whenever `key` changes and tracks its state. The previous result is kept
 * while a new one loads (`stale`), so lists don't flash empty between pages.
 */
export function useApi<T>(key: string, load: (signal: AbortSignal) => Promise<T>): ApiState<T> & { stale?: T } {
  const [state, setState] = useState<{ key: string; value: ApiState<T> }>({ key, value: { status: 'loading' } })
  const [last, setLast] = useState<T | undefined>(undefined)

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
      .then((data) => {
        setState({ key, value: { status: 'ready', data } })
        setLast(data)
      })
      .catch((error: unknown) => {
        if (!ctrl.signal.aborted) setState({ key, value: { status: 'error', error } })
      })
    return () => ctrl.abort()
    // `load` is recreated every render; `key` captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current: ApiState<T> = state.key === key ? state.value : { status: 'loading' }
  return current.status === 'loading' ? { ...current, stale: last } : current
}
