// Numbers in Ukrainian style: space between thousands, comma in decimals (86 500 ₽, 12,4%).

export const fmt = (n: number) => Math.round(n).toLocaleString('uk-UA')

/** 0.62 → "62%". */
export const pct = (share: number) => `${Math.round(share * 100)}%`

export const money = (rub: number | null | undefined) => (rub == null ? '—' : `${fmt(rub)} ₽`)

export const moneyK = (rub: number | null | undefined) => (rub == null ? '—' : `${fmt(Math.round(rub / 1000))} тис. ₽`)

const PERIODS: Record<string, string> = { MONTH: 'на місяць', SHIFT: 'за зміну', HOUR: 'за годину', FLY_IN_FLY_OUT: 'за вахту' }

/** "70 000–80 000 ₽ на місяць", "від 60 000 ₽", or null when the vacancy has no salary. */
export function salaryRange(v: { salary_from: number | null; salary_to: number | null; salary_currency: string | null; salary_period: string | null; source: string }): string | null {
  const { salary_from: from, salary_to: to } = v
  if (from == null && to == null) return null
  const cur = v.salary_currency === 'RUB' || !v.salary_currency ? '₽' : v.salary_currency
  const amount = from != null && to != null && from !== to ? `${fmt(from)}–${fmt(to)}` : from != null ? (to == null ? `від ${fmt(from)}` : fmt(from)) : `до ${fmt(to!)}`
  const period = v.salary_period ? PERIODS[v.salary_period] : v.source === 'trudvsem' ? PERIODS.MONTH : undefined
  return `${amount} ${cur}${period ? ` ${period}` : ''}`
}

/** Ukrainian plural: plural(5, 'день', 'дні', 'днів') → 'днів'. */
export function plural(n: number, one: string, few: string, many: string): string {
  const x = n % 10
  const y = n % 100
  if (x === 1 && y !== 11) return one
  if (x >= 2 && x <= 4 && (y < 12 || y > 14)) return few
  return many
}

const HOUR = 36e5

/** "2 год тому", "вчора", "5 днів тому" — counted from the data snapshot, not from now. */
export function ago(date: Date | string | null, asOf: Date): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  const hours = Math.round((asOf.getTime() - d.getTime()) / HOUR)
  if (hours < 1) return 'щойно'
  if (hours < 20) return `${hours} год тому`
  const days = Math.max(1, Math.round(hours / 24))
  if (days === 1) return 'вчора'
  if (days < 60) return `${days} ${plural(days, 'день', 'дні', 'днів')} тому`
  return longDate(d)
}

const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру']
export const monthShort = (d: Date) => MONTHS_SHORT[d.getUTCMonth()]

export const longDate = (d: Date | string) =>
  (typeof d === 'string' ? new Date(d) : d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** ISO month ("2026-09-01") → Date at UTC midnight. */
export const monthDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
