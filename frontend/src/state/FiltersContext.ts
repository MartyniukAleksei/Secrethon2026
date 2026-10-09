import { createContext, useContext } from 'react'
import type { Employer } from '../domain/types'

/**
 * Filters shared by the map, the companies and the vacancies: kept in the URL under the same
 * parameter names on every page, carried by the top navigation and read by the agent.
 * Each is a list of values (`region=64,77`); empty means any.
 */
export const SHARED_FILTERS = ['region', 'focus', 'domain', 'role', 'days'] as const
export type SharedFilter = (typeof SHARED_FILTERS)[number]

export type Filters = {
  /** Region ids as strings; `none` = no region. */
  region: string[]
  /** Customer focus of the legal entity: drone, missile, kab or `other` (ВПК without a tag). */
  focus: string[]
  /** Industry (`direction_domain`) and role (`direction_role`) of the legal entity. */
  domain: string[]
  role: string[]
  /** Published within N days of the data snapshot; 0 = any time. Applies to vacancies. */
  days: number
}

export type FiltersState = Filters & {
  set: (patch: Partial<Filters>) => void
  /** Employer matches the region, focus, industry and role filters. */
  matches: (e: Employer) => boolean
  /** Any of the region, focus, industry or role filters is on. */
  active: boolean
  /** The shared filters as a query string, for links to the other sections. */
  search: string
  /** A link that keeps the shared filters, e.g. `href('/map', { co: '5' })`. */
  href: (path: string, extra?: Record<string, string>) => string
}

export const FiltersContext = createContext<FiltersState | null>(null)

export function useFilters(): FiltersState {
  const ctx = useContext(FiltersContext)
  if (!ctx) throw new Error('useFilters must be used inside <FiltersProvider>')
  return ctx
}
