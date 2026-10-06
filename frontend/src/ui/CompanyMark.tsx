import { Icon } from './Icon'

/** Hostile-object diamond (NATO APP-6). */
export function CompanyMark({ size = 40 }: { size?: number }) {
  return (
    <span className="dia" style={{ width: size, height: size }}>
      <Icon name="factory" />
    </span>
  )
}

export function CompanyTile({ size = 40 }: { size?: number }) {
  return (
    <span className="tile" style={{ width: size, height: size, borderRadius: size * 0.29 }}>
      <CompanyMark size={size * 0.85} />
    </span>
  )
}
