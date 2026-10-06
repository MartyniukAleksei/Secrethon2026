import { useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { VacancyDrawer } from './VacancyDrawer'
import { VacancyDrawerContext, type VacancyDrawerState } from './VacancyDrawerContext'

export function VacancyDrawerProvider({ children }: { children: ReactNode }) {
  const { key } = useLocation()
  // Remember on which history entry the drawer was opened: navigating anywhere closes it.
  const [opened, setOpened] = useState<{ id: number; at: string } | null>(null)
  const openId = opened && opened.at === key ? opened.id : null

  const value = useMemo<VacancyDrawerState>(
    () => ({ openId, open: (id) => setOpened({ id, at: key }), close: () => setOpened(null) }),
    [openId, key],
  )

  return (
    <VacancyDrawerContext.Provider value={value}>
      {children}
      {openId != null && <VacancyDrawer id={openId} onClose={value.close} />}
    </VacancyDrawerContext.Provider>
  )
}
