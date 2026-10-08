import { useEffect, useState } from 'react'

/** GUR description split into fields by an LLM (parsers/data/gur_about); keyed by GUR company_id. */
export type GurAboutData = {
  summary: string
  products: { group: string | null; items: string[] }[]
  owners: { chain: string[]; relation: string; since: string | null }[]
  licenses: { issued: string | null; number: string; scope: string }[]
  cooperation: { program: string; role: string; supplies: string[]; recipient: string | null }[]
  customers: string[]
  other_facts: string[]
}

let cache: Promise<Record<string, GurAboutData>> | undefined

function loadAll() {
  cache ??= fetch('/gur-about.json')
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => {
      cache = undefined
      return {}
    })
  return cache
}

/** Structured description for a GUR company; null until loaded or when there is none. */
export function useGurAbout(companyId: number | undefined) {
  const [loaded, setLoaded] = useState<{ id: number; about: GurAboutData | null } | null>(null)
  useEffect(() => {
    if (companyId == null) return
    let alive = true
    loadAll().then((all) => alive && setLoaded({ id: companyId, about: all[String(companyId)] ?? null }))
    return () => { alive = false }
  }, [companyId])
  return loaded && loaded.id === companyId ? loaded.about : null
}
