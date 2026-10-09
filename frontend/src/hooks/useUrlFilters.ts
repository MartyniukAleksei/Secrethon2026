import { useSearchParams } from 'react-router'

/**
 * Filters kept in the URL, so a selection can be shared and survives a reload. A list filter is
 * one comma-separated parameter (`region=64,77`); changing any filter resets the page.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams()
  const update = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v == null || v === '' ? next.delete(k) : next.set(k, v)))
    if (!keepPage) next.delete('page')
    setParams(next, { replace: true })
  }
  const list = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean)
  const setList = (key: string, values: string[]) => update({ [key]: values.length ? values.join(',') : null })
  const num = (key: string) => {
    const raw = params.get(key)
    const n = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  return { params, update, list, setList, num }
}
