import type { ApiEmployer, ApiEmployerDetail, ApiMapNetwork, ApiMapPoint, ApiProfession, ApiStats, ApiVacancyDetail, ApiVacancyPage, ApiVacancyReview, ApiVacancyReviewInput } from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, path: string) {
    super(`GET ${path} failed with ${status}`)
    this.status = status
  }
}

type Params = Record<string, string | number | undefined | null>

const query = (params: Params) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

export type VacancyQuery = {
  level?: 'vpk' | 'confirmed' | 'likely' | 'all'
  employer_id?: number
  region_id?: number
  category?: string
  title?: string
  q?: string
  days?: number
  sort?: 'published' | 'salary'
  limit?: number
  offset?: number
}

export const api = {
  mapPoints: (signal?: AbortSignal) => get<ApiMapPoint[]>('/employers/map-points', signal),
  mapNetwork: (signal?: AbortSignal) => get<ApiMapNetwork>('/employers/map-network', signal),
  stats: (signal?: AbortSignal) => get<ApiStats>('/stats', signal),
  employers: (signal?: AbortSignal) => get<ApiEmployer[]>('/employers', signal),
  employer: (id: number, signal?: AbortSignal) => get<ApiEmployerDetail>(`/employers/${id}`, signal),
  vacancies: (params: VacancyQuery, signal?: AbortSignal) => get<ApiVacancyPage>(`/vacancies${query(params)}`, signal),
  vacancy: (id: number, signal?: AbortSignal) => get<ApiVacancyDetail>(`/vacancies/${id}`, signal),
  saveReview: async (id: number, review: ApiVacancyReviewInput): Promise<ApiVacancyReview> => {
    const path = `/vacancies/${id}/reviews`
    const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(review) })
    if (!res.ok) throw new ApiError(res.status, path)
    return await res.json() as ApiVacancyReview
  },
  professions: (params: Omit<VacancyQuery, 'employer_id' | 'title' | 'q' | 'sort' | 'offset'>, signal?: AbortSignal) =>
    get<ApiProfession[]>(`/professions${query(params)}`, signal),
}
