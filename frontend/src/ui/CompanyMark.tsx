import { useState } from 'react'
import { Icon } from './Icon'

/** Hostile-object diamond (NATO APP-6). */
export function CompanyMark({ size = 40 }: { size?: number }) {
  return (
    <span className="dia" style={{ width: size, height: size }}>
      <Icon name="factory" />
    </span>
  )
}

/** Company logo from its GUR card; the hostile mark when there is none or it fails to load. */
export function CompanyLogo({ src, size = 40, name }: { src?: string | null; size?: number; name?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <CompanyMark size={size} />
  return (
    <img className="company-logo" src={src} alt={name ? `Логотип: ${name}` : 'Логотип підприємства'} width={size} height={size} loading="lazy"
      referrerPolicy="no-referrer" onError={() => setFailed(src)} />
  )
}

export function CompanyTile({ size = 40, logo, name }: { size?: number; logo?: string | null; name?: string }) {
  return (
    <span className="tile" style={{ width: size, height: size, borderRadius: size * 0.29 }}>
      <CompanyLogo src={logo} size={size * 0.85} name={name} />
    </span>
  )
}
