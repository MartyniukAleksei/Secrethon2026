import { useState, type ReactNode } from 'react'
import { fmt } from '../domain/format'
import { matcher } from '../domain/search'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/icons'
import './FilterSidebar.css'

export type FacetOption = { value: string; label: string; count?: number }

/** A titled card of filter groups, as on Abitly: an icon, a heading and collapsible groups. */
export function FilterSection({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <section className="panel fs-section">
      <h3 className="fs-section-title"><span className="fs-section-icon"><Icon name={icon} /></span>{title}</h3>
      {children}
    </section>
  )
}

/** The sidebar header: how many filters are on and a reset. */
export function FilterHeader({ active, onReset }: { active: number; onReset: () => void }) {
  return (
    <div className="panel fs-header">
      <span className="fs-section-icon"><Icon name="list" /></span>
      <h2>Фільтри{active > 0 && <span className="fs-active">{active}</span>}</h2>
      {active > 0 && <button type="button" className="link-btn fs-reset" onClick={onReset}>Скинути</button>}
    </div>
  )
}

function Group({ title, open, setOpen, children, badge }: { title: string; open: boolean; setOpen: (v: boolean) => void; children: ReactNode; badge?: number }) {
  return (
    <div className="fs-group">
      <button type="button" className="fs-group-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        {!!badge && <span className="fs-active">{badge}</span>}
        <Icon name="chev" className="fs-chev" />
      </button>
      {open && <div className="fs-group-body">{children}</div>}
    </div>
  )
}

/**
 * Checkbox list with counts: any checked value matches. Values with nothing to show are hidden
 * unless checked; long lists show the first few and a «Показати ще».
 */
export function CheckGroup({ title, options, selected, onChange, searchable = false, limit = 5, defaultOpen = true, placeholder }: {
  title: string
  options: FacetOption[]
  selected: string[]
  onChange: (values: string[]) => void
  searchable?: boolean
  limit?: number
  defaultOpen?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(defaultOpen || selected.length > 0)
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const m = matcher(query)
  const visible = options.filter((o) => (o.count !== 0 || selected.includes(o.value)) && m(o.label))
  // Checked values stay on top so they never hide behind «Показати ще».
  const ordered = [...visible.filter((o) => selected.includes(o.value)), ...visible.filter((o) => !selected.includes(o.value))]
  const shown = all || query ? ordered : ordered.slice(0, Math.max(limit, selected.length))
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])

  return (
    <Group title={title} open={open} setOpen={setOpen} badge={selected.length}>
      {searchable && (
        <label className="search fs-search">
          <span className="sr">Пошук: {title}</span>
          <Icon name="search" />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder ?? 'Назва'} />
        </label>
      )}
      {!shown.length && <p className="fs-empty">Нічого не знайдено</p>}
      {shown.map((o) => (
        <label key={o.value} className="fs-option">
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
          <span className="fs-option-label">{o.label}</span>
          {o.count != null && <span className="fs-count">{fmt(o.count)}</span>}
        </label>
      ))}
      {!query && ordered.length > shown.length && (
        <button type="button" className="fs-more" onClick={() => setAll(true)}>Показати ще {fmt(ordered.length - shown.length)}</button>
      )}
      {!query && all && ordered.length > limit && (
        <button type="button" className="fs-more" onClick={() => setAll(false)}>Згорнути</button>
      )}
    </Group>
  )
}

/** One choice of a few (a radio list), e.g. the publication period. */
export function RadioGroup<T extends string>({ title, options, value, onChange, defaultOpen = true }: {
  title: string
  options: { value: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Group title={title} open={open} setOpen={setOpen}>
      {options.map((o) => (
        <label key={o.value} className="fs-option">
          <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="fs-option-label">{o.label}</span>
          {o.count != null && <span className="fs-count">{fmt(o.count)}</span>}
        </label>
      ))}
    </Group>
  )
}

/** A from–to range of numbers; an empty end is open. */
export function RangeGroup({ title, from, to, onChange, unit, defaultOpen = true }: {
  title: string
  from?: number
  to?: number
  onChange: (from: number | undefined, to: number | undefined) => void
  unit?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen || from != null || to != null)
  const parse = (raw: string) => (raw.trim() === '' || !Number.isFinite(Number(raw)) ? undefined : Math.max(0, Number(raw)))
  return (
    <Group title={title} open={open} setOpen={setOpen} badge={(from != null ? 1 : 0) + (to != null ? 1 : 0)}>
      <div className="fs-range">
        <label>
          <span className="sr">{title}: від</span>
          <input className="input" type="number" min={0} inputMode="numeric" placeholder="від" value={from ?? ''} onChange={(e) => onChange(parse(e.target.value), to)} />
        </label>
        <span aria-hidden="true">—</span>
        <label>
          <span className="sr">{title}: до</span>
          <input className="input" type="number" min={0} inputMode="numeric" placeholder="до" value={to ?? ''} onChange={(e) => onChange(from, parse(e.target.value))} />
        </label>
        {unit && <span className="fs-unit">{unit}</span>}
      </div>
      {from != null && to != null && from > to && <p className="fs-warn" role="alert">«Від» більше за «до»: нічого не знайдеться.</p>}
    </Group>
  )
}

/** A yes/no switch in a group, e.g. «Лише з зарплатою». */
export function ToggleRow({ label, checked, onChange, count }: { label: string; checked: boolean; onChange: (v: boolean) => void; count?: number }) {
  return (
    <label className="fs-option fs-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="fs-option-label">{label}</span>
      {count != null && <span className="fs-count">{fmt(count)}</span>}
    </label>
  )
}

export type ActiveChip = { key: string; label: string; onRemove: () => void }

/** The filters that are on, as removable chips above the results. */
export function ActiveChips({ chips, onReset }: { chips: ActiveChip[]; onReset: () => void }) {
  if (!chips.length) return null
  return (
    <div className="fs-chips">
      {chips.map((c) => (
        <button key={c.key} className="chip" type="button" aria-pressed="true" onClick={c.onRemove} aria-label={`Прибрати фільтр «${c.label}»`}>
          {c.label}
          <Icon name="x" style={{ display: 'block' }} />
        </button>
      ))}
      <button type="button" className="link-btn fs-reset" onClick={onReset}>Скинути всі</button>
    </div>
  )
}
