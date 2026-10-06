import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ToastContext } from './ToastContext'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const [shown, setShown] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const say = useCallback((text: string) => {
    setMessage(text)
    setShown(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShown(false), 2200)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <ToastContext.Provider value={say}>
      {children}
      <div className={`toast${shown ? ' show' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  )
}
