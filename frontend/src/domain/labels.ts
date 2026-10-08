import type { ApiEmployer, ApiRelation, HumanSanctions, HumanSource, HumanVpk, Reliability, VpkCategory } from '../api/types'
import { pct } from './format'
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

/** Human review options for the employer card (keys are stored in web_reviews.employer_review). */
export const HUMAN_SOURCES: Record<HumanSource, string> = {
  hh: 'hh.ru', trudvsem: 'trudvsem.ru', superjob: 'superjob.ru', gur: 'ГУР',
  registry: 'Реєстр', company_site: 'Сайт компанії', media: 'ЗМІ', other: 'Інше',
}
/** Admiralty source reliability scale. */
export const RELIABILITY: Record<Reliability, string> = {
  A: 'Повністю надійне', B: 'Зазвичай надійне', C: 'Досить надійне',
  D: 'Зазвичай ненадійне', E: 'Ненадійне', F: 'Неможливо оцінити',
}
/** Admiralty code of the company classification: letter = best source, digit = agreement. */
const RELIABILITY_SOURCE: Record<string, string> = {
  A: 'офіційний реєстр, санкційний список', B: 'ГУР, сайт компанії', C: 'вакансії, агрегатори, ЗМІ',
  D: 'інше', F: 'прямого джерела немає',
}
const RELIABILITY_AGREEMENT: Record<string, string> = {
  '1': 'підтверджено кількома джерелами', '2': 'ймовірно', '3': 'можливо', '4': 'сумнівно', '6': 'неможливо оцінити',
}
export function reliabilityName(code: string): string {
  const [letter, digit] = code.trim()
  return [RELIABILITY_SOURCE[letter], digit && RELIABILITY_AGREEMENT[digit]].filter(Boolean).join('; ')
}

/** Final ВПК category of the legal entity. */
export const VPK_CATEGORY: Record<VpkCategory, string> = {
  vpk: 'ВПК',
  agency_vpk: 'Кадрове агентство: наймає у ВПК',
  foreign_intermediary: 'Іноземний посередник',
  foreign_other: "Іноземна, не пов'язана з рф",
  civil_sanctioned: 'Цивільна, під санкціями',
  out: 'Не ВПК',
  unknown: 'Недостатньо даних',
}
export const vpkCategoryName = (c: string) => VPK_CATEGORY[c as VpkCategory] ?? c
/** Categories that tie the company to the ВПК in some way (highlighted). */
export const VPK_RELATED = new Set<string>(['vpk', 'agency_vpk', 'foreign_intermediary', 'civil_sanctioned'])

export const HUMAN_SANCTIONS: Record<HumanSanctions, string> = { sanctioned: 'Під санкціями', not_sanctioned: 'Санкцій не виявлено' }
export const HUMAN_VPK: Record<HumanVpk, string> = { confirmed: 'ВПК підтверджено', likely: 'ВПК ймовірно', no: 'Не ВПК' }

// Effective employer values: a human review wins over the automatic classification.
export const autoVpk = (e: ApiEmployer): HumanVpk => (e.confirmed_vacancies > 0 ? 'confirmed' : 'likely')
export const effectiveCategory = (e: ApiEmployer) => e.human_review?.category ?? e.category
export const effectiveVpk = (e: ApiEmployer): HumanVpk => e.human_review?.vpk ?? autoVpk(e)
export const isSanctioned = (e: ApiEmployer) =>
  e.human_review?.sanctions
    ? e.human_review.sanctions === 'sanctioned'
    : e.sanctions_count > 0 || !!e.classification?.sanctions_gur?.length || !!e.classification?.sanctions_new?.length
/** ВПК confirmed: human review, else a decided company classification, else confirmed vacancies. */
export const isVpkConfirmed = (e: ApiEmployer) => {
  if (e.human_review?.vpk) return e.human_review.vpk === 'confirmed'
  if (e.classification) return e.classification.vpk_category === 'vpk' && e.classification.vpk_level === 'decided'
  if (e.agency?.category === 'agency_vpk') return false
  return autoVpk(e) === 'confirmed'
}

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

/** Automatic values as the card shows them (the company classification first), for review hints. */
export function autoVpkName(e: ApiEmployer): string {
  const c = e.classification
  if (c) return `${vpkCategoryName(c.vpk_category)} · ${c.vpk_probability != null ? pct(c.vpk_probability) : 'за правилом'}${c.vpk_level === 'review' ? ' · на перевірці' : ''}`
  if (e.agency?.category === 'agency_vpk') return VPK_CATEGORY.agency_vpk
  return HUMAN_VPK[autoVpk(e)]
}
export const autoDirectionName = (e: ApiEmployer) => e.classification?.direction_label ?? categoryOf(e.category).name
export const autoReliabilityName = (e: ApiEmployer) => e.classification?.reliability?.trim() ?? 'не оцінено'
