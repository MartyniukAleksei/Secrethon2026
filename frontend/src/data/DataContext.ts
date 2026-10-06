import { createContext, useContext } from 'react'
import type { Dataset } from '../domain/types'

export const DataContext = createContext<Dataset | null>(null)

/** The loaded data set. Only usable below <DataProvider>, which renders children once loaded. */
export function useData(): Dataset {
  const data = useContext(DataContext)
  if (!data) throw new Error('useData must be used inside <DataProvider>')
  return data
}
