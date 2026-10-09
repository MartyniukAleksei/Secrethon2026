import { useCallback, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { focusKeys } from '../domain/labels'
import type { Employer } from '../domain/types'
import { FiltersContext, SHARED_FILTERS, type Filters, type FiltersState } from './FiltersContext'

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams()
  const raw = SHARED_FILTERS.map((k) => params.get(k) ?? '').join('&')

  const set = useCallback((patch: Partial<Filters>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        const value = Array.isArray(v) ? v.join(',') : v ? String(v) : ''
        if (value) next.set(k, value)
        else next.delete(k)
      }
      next.delete('page')
      return next
    }, { replace: true })
  }, [setParams])

  const value = useMemo<FiltersState>(() => {
    const list = (k: string) => (params.get(k) ?? '').split(',').filter(Boolean)
    const f: Filters = { region: list('region'), focus: list('focus'), domain: list('domain'), role: list('role'), days: Number(params.get('days')) || 0 }
    const any = (values: string[], ...of: string[]) => !values.length || of.some((v) => values.includes(v))
    const search = new URLSearchParams(SHARED_FILTERS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : []))).toString()
    return {
      ...f,
      set,
      matches: (e: Employer) =>
        any(f.region, e.region_id == null ? 'none' : String(e.region_id)) &&
        any(f.focus, ...focusKeys(e)) &&
        any(f.domain, e.classification?.direction_domain ?? 'none') &&
        any(f.role, e.classification?.direction_role ?? 'none'),
      active: !!(f.region.length || f.focus.length || f.domain.length || f.role.length),
      search: search ? `?${search}` : '',
      href: (path: string, extra: Record<string, string> = {}) => {
        const q = new URLSearchParams(search)
        Object.entries(extra).forEach(([k, v]) => q.set(k, v))
        return q.size ? `${path}?${q}` : path
      },
    }
    // `raw` stands for the shared parameters: other parameters changing keep the same value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, set])

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
}
