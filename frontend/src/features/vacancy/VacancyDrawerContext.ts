import { createContext, useContext } from 'react'

export type VacancyDrawerState = {
  openId: number | null
  open: (id: number) => void
  close: () => void
}

export const VacancyDrawerContext = createContext<VacancyDrawerState | null>(null)

export function useVacancyDrawer(): VacancyDrawerState {
  const ctx = useContext(VacancyDrawerContext)
  if (!ctx) throw new Error('useVacancyDrawer must be used inside <VacancyDrawerProvider>')
  return ctx
}
