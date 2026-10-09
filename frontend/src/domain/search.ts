/**
 * Search that forgives the alphabet, as on the server (backend/app/search.py): names are stored
 * in Russian, a query may be Ukrainian ("Калашніков") or Latin ("Kalashnikov").
 */
const FOLD: Record<string, string> = { і: 'и', ї: 'и', є: 'е', ґ: 'г', ё: 'е' }

// Longest first: "shch" before "sh" before "s".
const LATIN: [string, string][] = [
  ['shch', 'щ'], ['sch', 'щ'], ['kh', 'х'], ['zh', 'ж'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'],
  ['yu', 'ю'], ['ya', 'я'], ['yo', 'е'], ['ye', 'е'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'],
  ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'],
  ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['z', 'з'],
]

/** Lowercase, Ukrainian letters and ё folded, quotes dropped. */
export const fold = (text: string) =>
  text.toLowerCase().replace(/[іїєґё]/g, (ch) => FOLD[ch]).replace(/["«»]/g, '')

function translit(text: string, y: string): string {
  let out = ''
  for (let i = 0; i < text.length; ) {
    const hit = LATIN.find(([latin]) => text.startsWith(latin, i))
    if (hit) {
      out += hit[1]
      i += hit[0].length
    } else {
      out += text[i] === 'y' ? y : text[i]
      i += 1
    }
  }
  return out
}

/** The folded query and, when it has Latin letters, its Cyrillic readings (y as ы and й). */
export function variants(query: string): string[] {
  const q = fold(query.trim())
  const found = /[a-z]/.test(q) ? [q, translit(q, 'ы'), translit(q, 'й')] : [q]
  return [...new Set(found.filter(Boolean))]
}

/** A matcher for one query: true when any of the texts contains any reading of it. */
export function matcher(query: string): (...texts: (string | null | undefined)[]) => boolean {
  const qs = variants(query)
  if (!qs.length) return () => true
  return (...texts) => {
    const hay = fold(texts.filter(Boolean).join(' '))
    return qs.some((q) => hay.includes(q))
  }
}
