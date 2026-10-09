import { CATEGORIES, categoryOf, effectiveCategory } from '../domain/labels'
import type { Employer } from '../domain/types'

/** Pin colour of a card's category (a CSS token resolved to its value). */
export function markerColor(category: Employer['category']) {
  const color = categoryOf(category).color
  const token = /^var\((--[\w-]+)\)$/.exec(color)
  return token ? getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim() || '#73786a' : color
}

export const SELECTED_COLOR = '#d97706'

export const markerIcon = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path fill="${color}" stroke="white" stroke-width="2" d="M16 1a15 15 0 0 0-15 15c0 11 15 23 15 23s15-12 15-23A15 15 0 0 0 16 1Z"/><circle cx="16" cy="16" r="5" fill="white"/></svg>`)}`

/** Legend key of a card's pin: its known category, or `none`. */
export function categoryKey(e: Employer) {
  const c = effectiveCategory(e)
  return c && CATEGORIES.some((k) => k.key === c) ? c : 'none'
}

/** Legend rows of the pin colours, in the order shown. */
export const LEGEND = [...CATEGORIES.map((c) => ({ key: c.key, name: c.name, category: c.key as string | null })), { key: 'none', name: categoryOf(null).name, category: null }]
