import type { ReactNode } from 'react'
import type { ApiSupplyChain } from '../../api/types'
import { SUPPLY_ROLE, SUPPLY_SOURCE, WEAPON_FOCUS, WEAPON_FOCUS_FOR } from '../../domain/labels'
import { FocusDot } from './RatingParts'

type Line = { key: string; body: ReactNode }
type Group = { key: string; system: string; focus: string | null; url: string | null; lines: Line[] }

const NO_SYSTEM = '__none__'

const ext = (url: string | null | undefined, label: string) =>
  url ? <a className="rt-src" href={url} target="_blank" rel="noreferrer noopener">{label}</a> : null

/** Rows of the supply chain grouped by weapon system; claims that name no system go last. */
function groups(chain: ApiSupplyChain): Group[] {
  const map = new Map<string, Group>()
  const group = (slug: string | null, system: string | null, focus: string | null, url: string | null = null) => {
    const key = slug ?? NO_SYSTEM
    let g = map.get(key)
    if (!g) {
      g = { key, system: slug ? system ?? slug : 'Без назви системи', focus: slug ? focus : null, url, lines: [] }
      map.set(key, g)
    }
    if (!g.url && url) g.url = url
    return g
  }
  chain.lead.forEach((w) => group(w.weapon_slug, w.system, w.focus, w.url).lines.push({
    key: `lead:${w.weapon_slug}`,
    body: <b>Головний виробник / конструктор (за ГУР)</b>,
  }))
  chain.bom.forEach((p, i) => group(p.weapon_slug, p.system, p.focus).lines.push({
    key: `bom:${i}`,
    body: (
      <>
        <b>{p.part_kind === 'subsystem' ? `підсистема ${p.part ?? ''}` : p.part ?? 'деталь'}</b>
        {' — '}{p.role === 'involved' ? 'задіяне підприємство' : 'виробник'}
        {ext(p.part_url, 'ГУР')}
      </>
    ),
  }))
  chain.cooperation.forEach((w) => group(w.weapon_slug, w.system, w.focus, w.url).lines.push({
    key: `coop:${w.weapon_slug}`,
    body: <>Учасник кооперації (деталь не вказана)</>,
  }))
  chain.claims.forEach((c, i) => group(c.weapon_slug, c.system, c.focus).lines.push({
    key: `claim:${i}`,
    body: (
      <>
        <span className="badge sm">{SUPPLY_SOURCE[c.source] ?? c.source}</span>
        {!c.weapon_slug && c.focus && <span className="badge sm">{WEAPON_FOCUS_FOR[c.focus] ?? c.focus}</span>}
        {' '}<b>{SUPPLY_ROLE[c.role] ?? c.role}</b>
        {c.part_text ? `: ${c.part_text}` : ''}
        {!c.weapon_slug && c.system ? <span className="src"> ({c.system})</span> : null}
        <q lang="ru">{c.quote}</q>
        {ext(c.url, 'джерело')}
      </>
    ),
  }))
  return [...map.values()].sort((a, b) => Number(a.key === NO_SYSTEM) - Number(b.key === NO_SYSTEM))
}

/**
 * What the company makes or supplies for weapon systems: GUR bills of materials and quotes from
 * open sources. `limit` shows only the first lines (the rating row's preview).
 */
export function SupplyChainList({ chain, limit }: { chain: ApiSupplyChain; limit?: number }) {
  const all = groups(chain)
  if (!all.length) return <p className="empty-row">Зв’язків постачання з системами озброєння не знайдено.</p>
  const total = all.reduce((n, g) => n + g.lines.length, 0)
  const max = limit ?? total
  // The first `max` lines across the groups, groups kept whole until the limit.
  const shown = all
    .map((g, i) => {
      const before = all.slice(0, i).reduce((n, x) => n + x.lines.length, 0)
      return { ...g, lines: g.lines.slice(0, Math.max(0, max - before)) }
    })
    .filter((g) => g.lines.length > 0)
  const count = shown.reduce((n, g) => n + g.lines.length, 0)
  return (
    <div className="rt-chain">
      {shown.map((g) => (
        <div key={g.key} className="rt-chain-group">
          <h5>
            {g.key !== NO_SYSTEM && <FocusDot focus={g.focus} />}
            {g.url ? <a href={g.url} target="_blank" rel="noreferrer noopener">{g.system}</a> : g.system}
            {g.focus && <span className="src">{g.focus === 'carrier' ? 'носій КАБ і ракет' : WEAPON_FOCUS[g.focus] ?? g.focus}</span>}
          </h5>
          <ul>{g.lines.map((l) => <li key={l.key}>{l.body}</li>)}</ul>
        </div>
      ))}
      {count < total && <p className="src">Показано {count} з {total} зв’язків.</p>}
    </div>
  )
}

/** The «Ланцюг постачання» panel of a company page. */
export function SupplyChainPanel({ chain }: { chain: ApiSupplyChain | null }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>Ланцюг постачання</h3>
          <p>
            Що саме підприємство виробляє чи постачає для систем озброєння. Специфікації — з портала ГУР «War & Sanctions», інші зв’язки — дослівні
            цитати з відкритих джерел, кожна перевірена на сторінці-джерелі.
          </p>
        </div>
      </div>
      {chain ? <SupplyChainList chain={chain} /> : <p className="empty-row">Юрособу не знайдено, тож ланцюга постачання немає.</p>}
    </div>
  )
}
