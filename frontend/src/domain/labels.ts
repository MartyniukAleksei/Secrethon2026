import type { ApiRelation } from '../api/types'
import type { Category, Level } from './types'

/** Classifier categories (stored in Russian by the pipeline) → display name and color token. */
export const CATEGORIES: { key: string; name: string; color: string }[] = [
  { key: 'производство', name: 'Виробництво', color: 'var(--sector-uav)' },
  { key: 'НИИ/КБ', name: 'НДІ і КБ', color: 'var(--sector-aviation)' },
  { key: 'ремонт', name: 'Ремонт', color: 'var(--sector-ammo)' },
]
const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))
const UNKNOWN_CATEGORY = { key: '', name: 'Напрям не визначено', color: 'var(--sector-other)' }

export const categoryOf = (c: Category) => (c && CATEGORY_BY_KEY[c]) || UNKNOWN_CATEGORY

export const LEVELS: Record<Level, { name: string; badge: string }> = {
  confirmed: { name: 'ВПК: підтверджено', badge: 'hostile' },
  likely: { name: 'ВПК: ймовірно', badge: 'warning' },
  review: { name: 'На перевірку', badge: '' },
  no: { name: 'Не ВПК', badge: '' },
  out_of_scope: { name: 'Поза темою', badge: '' },
}

export const SOURCES: Record<string, string> = {
  hh: 'hh.ru',
  trudvsem: 'Работа России (trudvsem.ru)',
}
export const sourceName = (s: string) => SOURCES[s] ?? s

/** Experience as written by each job site → one wording. */
export function experienceName(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (s.includes('не требуется') || s === 'noexperience') return 'Без досвіду'
  if (s.includes('1–3') || s.includes('1-3') || s === 'between1and3') return '1–3 роки'
  if (s.includes('3–6') || s.includes('3-6') || s === 'between3and6') return '3–6 років'
  if (s.includes('более 6') || s === 'morethan6') return 'Понад 6 років'
  return raw
}

/** How a related GUR company relates to this one (edges are stored as listed on a company's profile). */
export function relationName(r: Pick<ApiRelation, 'kind' | 'direction'>): string {
  const out = r.direction === 'out'
  switch (r.kind) {
    case 'parent':
      return out ? 'Материнська компанія' : 'Дочірня компанія'
    case 'supplier':
      return out ? 'Постачальник' : 'Замовник'
    case 'bank':
      return out ? 'Банк' : 'Клієнт банку'
    case 'successor':
      return out ? 'Правонаступник' : 'Попередник'
    default:
      return "Пов'язана компанія"
  }
}
