import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { focusKeys } from '../domain/labels'
import type { Employer } from '../domain/types'
import { FiltersContext, PERIODS, type Filters, type FiltersState } from './FiltersContext'

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>({ period: 0, region: 'all', focus: 'all', domain: 'all', role: 'all' })
  const set = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), [])

  const value = useMemo<FiltersState>(
    () => ({
      ...filters,
      set,
      matches: (e: Employer) =>
        (filters.region === 'all' || e.region_id === filters.region) &&
        (filters.focus === 'all' || focusKeys(e).includes(filters.focus)) &&
        (filters.domain === 'all' || e.classification?.direction_domain === filters.domain) &&
        (filters.role === 'all' || e.classification?.direction_role === filters.role),
      periodName: PERIODS.find((p) => p.value === filters.period)?.name ?? '',
    }),
    [filters, set],
  )

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
}
