import { CATEGORIES, categoryOf, effectiveCategory } from '../domain/labels'
import type { ApiSiteKind } from '../api/types'
import type { Employer } from '../domain/types'

/** Pin colour of a card's category (a CSS token resolved to its value). */
export function markerColor(category: Employer['category']) {
  const color = categoryOf(category).color
  const token = /^var\((--[\w-]+)\)$/.exec(color)
  return token ? getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim() || '#73786a' : color
}

export const SELECTED_COLOR = '#d97706'

const PIN = 'M16 1a15 15 0 0 0-15 15c0 11 15 23 15 23s15-12 15-23A15 15 0 0 0 16 1Z'
const svg = (body: string, size: number[]) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}" viewBox="0 0 ${size[0]} ${size[1]}">${body}</svg>`)}`

/** A company's own place by the register: a pin with an office building or a plant. */
export function siteIcon(color: string, kind: ApiSiteKind) {
  const glyph = kind === 'head_office'
    ? `<path fill="white" d="M10 9h12v14H10z"/><path fill="${color}" d="M12 11h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3z"/>`
    : '<path fill="white" d="M8 23v-8l5 3v-3l5 3v-3l4 2.4V8h3v15z"/>'
  return svg(`<path fill="${color}" stroke="white" stroke-width="2" d="${PIN}"/>${glyph}`, [32, 40])
}

/** Where the company hires (vacancy coordinates): a dot of one colour for every company. */
export const HIRING_COLOR = '#009E73'
export const hiringIcon = (color = HIRING_COLOR) =>
  svg(`<circle cx="9" cy="9" r="7" fill="${color}" stroke="white" stroke-width="2"/>`, [18, 18])

/** Legend key of a card's pin: its known category, or `none`. */
export function categoryKey(e: Employer) {
  const c = effectiveCategory(e)
  return c && CATEGORIES.some((k) => k.key === c) ? c : 'none'
}

/** Legend rows of the pin colours, in the order shown. */
export const LEGEND = [...CATEGORIES.map((c) => ({ key: c.key, name: c.name, category: c.key as string | null })), { key: 'none', name: categoryOf(null).name, category: null }]
