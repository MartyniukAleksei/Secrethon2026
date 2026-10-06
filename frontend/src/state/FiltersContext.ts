import { createContext, useContext } from 'react'
import type { Employer } from '../domain/types'

export type Period = 7 | 30 | 90 | 365 | 0

export const PERIODS: { value: Period; label: string; name: string }[] = [
  { value: 7, label: '7 днів', name: 'за 7 днів' },
  { value: 30, label: '30 днів', name: 'за 30 днів' },
  { value: 90, label: '90 днів', name: 'за 90 днів' },
  { value: 365, label: 'Рік', name: 'за рік' },
  { value: 0, label: 'Весь час', name: 'за весь час' },
]

export type Filters = {
  /** Published within N days of the data snapshot; 0 = any time. Applies to vacancies. */
  period: Period
  region: number | 'all'
  category: string | 'all'
}

export type FiltersState = Filters & {
  set: (patch: Partial<Filters>) => void
  /** Employer matches the region and category filters. */
  matches: (e: Employer) => boolean
  periodName: string
}

export const FiltersContext = createContext<FiltersState | null>(null)

export function useFilters(): FiltersState {
  const ctx = useContext(FiltersContext)
  if (!ctx) throw new Error('useFilters must be used inside <FiltersProvider>')
  return ctx
}
