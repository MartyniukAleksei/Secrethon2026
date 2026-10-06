import type { CSSProperties } from 'react'
import type { IconName } from './icons'

type Props = { name: IconName; className?: string; size?: number; style?: CSSProperties }

export function Icon({ name, className, size, style }: Props) {
  return (
    <svg className={className} width={size} height={size} style={style} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}
