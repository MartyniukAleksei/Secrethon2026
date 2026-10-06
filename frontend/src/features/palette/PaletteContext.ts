import { createContext, useContext } from 'react'

/** Opens the global search (Ctrl K), optionally prefilled with a query. */
export const PaletteContext = createContext<((query?: string) => void) | null>(null)

export function useOpenPalette(): (query?: string) => void {
  const open = useContext(PaletteContext)
  if (!open) throw new Error('useOpenPalette must be used inside <AppShell>')
  return open
}
