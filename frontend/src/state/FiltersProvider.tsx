import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Employer } from '../domain/types'
import { FiltersContext, PERIODS, type Filters, type FiltersState } from './FiltersContext'

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>({ period: 0, region: 'all', category: 'all' })
  const set = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), [])

  const value = useMemo<FiltersState>(
    () => ({
      ...filters,
      set,
      matches: (e: Employer) =>
        (filters.region === 'all' || e.region_id === filters.region) &&
        (filters.category === 'all' || e.category === filters.category),
      periodName: PERIODS.find((p) => p.value === filters.period)?.name ?? '',
    }),
    [filters, set],
  )

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
}
