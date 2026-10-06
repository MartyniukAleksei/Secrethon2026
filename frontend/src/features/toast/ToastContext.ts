import { createContext, useContext } from 'react'

export const ToastContext = createContext<((message: string) => void) | null>(null)

/** Returns `say(message)`, which shows a short status toast. */
export function useToast(): (message: string) => void {
  const say = useContext(ToastContext)
  if (!say) throw new Error('useToast must be used inside <ToastProvider>')
  return say
}
