import { useCallback, useEffect, useState } from 'react'

const KEY = 'ds-theme'

function initial(): boolean {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return saved === 'dark'
  } catch {
    /* storage may be blocked */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Dark theme flag, applied as the .dark class on <html> and remembered per browser. */
export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(initial)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem(KEY, dark ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  }, [dark])

  return [dark, useCallback(() => setDark((d) => !d), [])]
}
