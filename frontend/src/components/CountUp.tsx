import { useEffect, useState } from 'react'
import { fmt } from '../domain/format'

const DURATION = 1400

export function CountUp({ value, format = fmt }: {
  value: number | null
  format?: (value: number) => string
}) {
  const [display, setDisplay] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? value : 0)

  useEffect(() => {
    if (value == null) return
    const target = value
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const started = performance.now()

    function tick(now: number) {
      const progress = motion.matches ? 1 : Math.min(Math.max((now - started) / DURATION, 0), 1)
      setDisplay(Math.round(target * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }

    function stopMotion() {
      if (motion.matches) {
        cancelAnimationFrame(frame)
        setDisplay(value)
      }
    }

    frame = requestAnimationFrame(tick)
    motion.addEventListener('change', stopMotion)
    return () => {
      cancelAnimationFrame(frame)
      motion.removeEventListener('change', stopMotion)
    }
  }, [value])

  return (
    <span className="count-up" aria-label={value == null ? '—' : format(value)}>
      <span aria-hidden="true">{value == null ? '—' : format(display ?? 0)}</span>
    </span>
  )
}
