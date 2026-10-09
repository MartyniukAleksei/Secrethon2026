import type { ApiEmployer, ApiFocus, DiscoveryStatus, ApiRelation, ApiVacancy, FocusKey, HumanSanctions, HumanSource, HumanVpk, Reliability, VpkCategory } from '../api/types'
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

/**
 * Badges of a vacancy by its final label. An ordinary vacancy of a ВПК enterprise has none:
 * every vacancy of the enterprise counts, whatever the post.
 */
export function vacancyBadges(v: Pick<ApiVacancy, 'final_category' | 'final_basis' | 'level' | 'has_markers'>) {
  const badges: { name: string; badge: string }[] = []
  const review = v.level === 'likely'
  if (v.final_category === 'agency') badges.push({ name: 'Через кадрове агентство', badge: 'warning' })
  if (v.final_basis === 'company_vpk_review') badges.push({ name: 'Підприємство на перевірці', badge: 'warning' })
  else if (v.final_basis === 'text_jev') badges.push({ name: `ВПК за текстом вакансії${review ? ' · на перевірці' : ''}`, badge: review ? 'warning' : 'hostile' })
  else if (v.final_basis === 'legacy') badges.push(LEVELS[v.level])
  if (v.has_markers) badges.push({ name: 'Явні ознаки ВПК у тексті', badge: '' })
  return badges
}

/** Final-label bases, for «Чому ця вакансія тут». */
export const FINAL_BASIS: Record<string, string> = {
  company_vpk: 'Роботодавець — підприємство ВПК: зараховано всі його вакансії, не лише профільні.',
  company_vpk_review: 'Роботодавець — ймовірне підприємство ВПК, рішення щодо нього ще на перевірці.',
  text_jev: 'Про роботодавця даних замало, тож вирішив текст вакансії (класифікатор JEV).',
  legacy: 'Позначено фільтром ключових слів за текстом вакансії (попередня методика).',
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
/** Shown on hover over the reliability label: which scale the code follows. */
export const RELIABILITY_SCALE = [
  'Код Адміралтейства (NATO Admiralty Code, STANAG 2511): літера — надійність джерела, цифра — достовірність інформації.',
  'Літера — найкраще джерело серед тих, що стосуються саме цієї категорії:',
  'A — офіційний реєстр, санкційний список; B — ГУР, сайт компанії; C — вакансії, агрегатори, ЗМІ; D — інше; F — прямого джерела немає, рішення за сукупністю ознак.',
  'Цифра — узгодженість рішення:',
  '1 — імовірність ≥ 90% і щонайменше два незалежні види джерел; 2 — ≥ 90% за одним видом або за правилом; 3 — 60–90%; 4 — < 60%; 6 — судити немає з чого.',
].join('\n')
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

/** The employer's shown vacancies: its own ВПК ones and those it places as a recruitment agency. */
export function shownVacancies(e: Pick<ApiEmployer, 'vpk_vacancies' | 'agency_vacancies'>) {
  const value = e.vpk_vacancies + e.agency_vacancies
  if (!e.agency_vacancies) return { label: 'Вакансій ВПК', value }
  return { label: e.vpk_vacancies ? 'Вакансій ВПК, з агентськими' : 'Вакансій через агентство', value }
}

// Effective employer values: a human review wins over the automatic classification.
export const autoVpk = (e: ApiEmployer): HumanVpk => (e.confirmed_vacancies > 0 ? 'confirmed' : 'likely')
export const effectiveCategory = (e: ApiEmployer) => e.human_review?.category ?? e.category
export const effectiveVpk = (e: ApiEmployer): HumanVpk => e.human_review?.vpk ?? autoVpk(e)
/**
 * Sanctions jurisdictions of the legal entity: GUR's and those found in open sources besides,
 * counted once. Without a company classification, the GUR card's count.
 */
export function sanctionsOf(e: Pick<ApiEmployer, 'classification' | 'sanctions_count'>) {
  const gur = e.classification?.sanctions_gur ?? []
  const extra = (e.classification?.sanctions_new ?? []).filter((c) => !gur.includes(c))
  if (!e.classification) return { total: e.sanctions_count, gur: e.sanctions_count, extra: 0, codes: [] as string[] }
  return { total: gur.length + extra.length, gur: gur.length, extra: extra.length, codes: [...gur, ...extra] }
}
export const isSanctioned = (e: ApiEmployer) =>
  e.human_review?.sanctions ? e.human_review.sanctions === 'sanctioned' : sanctionsOf(e).total > 0
/** ВПК confirmed: human review, else a decided company classification, else confirmed vacancies. */
export const isVpkConfirmed = (e: ApiEmployer) => {
  if (e.human_review?.vpk) return e.human_review.vpk === 'confirmed'
  if (e.classification) return e.classification.vpk_category === 'vpk' && e.classification.vpk_level === 'decided'
  if (e.agency?.category === 'agency_vpk') return false
  return autoVpk(e) === 'confirmed'
}

/** Customer focus categories; a ВПК company with none is «Суміжне». */
export const FOCUS: Record<FocusKey | 'other', string> = { drone: 'БпЛА', missile: 'Ракети', kab: 'КАБ', other: 'Суміжне' }
const FOCUS_BASIS: Record<string, string> = {
  gur_weapon: 'кооперація з виробництва озброєння (ГУР)',
  gur_uav: 'моделі БпЛА в базі ГУР',
  gur_component: 'постачає компоненти (ГУР)',
  jev_direction: 'напрям діяльності за оцінкою моделі',
  vacancies: 'згадується у вакансіях',
  jev_focus: 'за оцінкою моделі',
}
/** Why the company has the focus tag: its basis, with the weapons, models or quotes behind it. */
export function focusTitle(f: ApiFocus): string {
  const ev = f.evidence ?? {}
  const names =
    f.basis === 'gur_weapon' ? ev.gur_weapon?.map((w) => w.weapon)
      : f.basis === 'gur_uav' ? ev.gur_uav?.map((m) => m.model)
        : f.basis === 'gur_component' ? ev.gur_component?.map((w) => w.weapon)
          : f.basis === 'vacancies' ? ev.vacancies?.map((q) => `«${q.quote}»`)
            : undefined
  const basis = FOCUS_BASIS[f.basis] ?? f.basis
  const score = f.basis === 'jev_focus' && f.score != null ? `, p = ${f.score.toFixed(2)}` : ''
  return [`${basis}${score}`, ...(names ?? []).slice(0, 5)].join('\n')
}
/** The card's focus: its tags, «Суміжне» for a ВПК company without one, nothing otherwise. */
export const focusKeys = (e: Pick<ApiEmployer, 'focus'>): (FocusKey | 'other')[] =>
  e.focus == null ? [] : e.focus.length ? e.focus.map((f) => f.focus) : ['other']

/** Industry (`direction_domain`) and role (`direction_role`) of the legal entity. */
export const DOMAINS: Record<string, string> = {
  aviation: 'Авіабудування',
  engines: 'Двигуни',
  missiles_space: 'Ракетно-космічна техніка',
  air_defense_radar: 'ППО і радіолокація',
  electronics_comms: "Радіоелектроніка і зв'язок",
  optics: 'Оптика',
  armored_vehicles: 'Бронетехніка й артилерія',
  ammo_chemicals: 'Боєприпаси і спецхімія',
  shipbuilding: 'Суднобудування',
  uav: 'БпЛА',
  small_arms: 'Стрілецька зброя',
  machining_materials: 'Верстати і матеріали',
  rnd_institute: 'НДІ і КБ',
  trade_logistics: 'Торгівля і логістика',
  finance: 'Фінанси',
  civil_other: 'Цивільна діяльність',
}
export const ROLES: Record<string, string> = {
  manufacturer: 'Виробник',
  component_supplier: 'Постачальник компонентів',
  equipment_supplier: 'Постачальник обладнання',
  rnd: 'НДДКР',
  repair: 'Ремонт',
  intermediary: 'Посередник',
  finance: 'Фінанси',
  management: 'Управління холдингом',
  services: 'Послуги',
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

const SCHEDULES: Record<string, string> = {
  fullday: 'Повний день', 'полный день': 'Повний день',
  shift: 'Змінний графік', 'сменный график': 'Змінний графік',
  flexible: 'Гнучкий графік', 'гибкий график': 'Гнучкий графік',
  remote: 'Віддалена робота', 'удаленная работа': 'Віддалена робота',
  flyinflyout: 'Вахта', 'вахтовый метод': 'Вахта',
}
/** Work schedule as published (hh codes or Russian text), in Ukrainian when known. */
export const scheduleName = (raw: string) => SCHEDULES[raw.toLowerCase()] ?? raw

const EMPLOYMENT: Record<string, string> = {
  full: 'Повна зайнятість', 'полная занятость': 'Повна зайнятість',
  part: 'Часткова зайнятість', 'частичная занятость': 'Часткова зайнятість',
  project: 'Проєктна робота', 'проектная работа': 'Проєктна робота',
  probation: 'Стажування', 'стажировка': 'Стажування',
  volunteer: 'Волонтерство', 'волонтерство': 'Волонтерство',
}
/** Employment type as published, in Ukrainian when known. */
export const employmentName = (raw: string) => EMPLOYMENT[raw.toLowerCase()] ?? raw

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
    case 'branch':
      return out ? 'Головне підприємство' : 'Філія'
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

/** Search log (`discovery_log`): what came of each search result. */
export const DISCOVERY_STATUS: Record<DiscoveryStatus, string> = {
  fact: 'Перевірений факт',
  no_fact: 'Знайдено, нічого не взято',
  contact: 'Перевірений контакт',
  query: 'Запит (результати не збереглися)',
}
export const PROVIDERS: Record<string, string> = { exa: 'Exa (вебпошук)', opensanctions: 'OpenSanctions', agy: 'Agent' }
export const DISCOVERY_NOTE = 'Результати пошуку без підтвердженого факту зберігаються з 09.10.2026.'
