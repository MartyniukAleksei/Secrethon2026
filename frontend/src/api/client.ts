import type { ApiMethodology, ApiDiscoveryCount, ApiDiscoveryPage, ApiEmployer, ApiExportCatalog, ExportFormat, ApiEmployerDetail, ApiEmployerReview, ApiEmployerReviewInput, ApiMapNetwork, ApiMapPoint, ApiProfession, ApiStats, ApiVacancyDetail, ApiVacancyFacets, ApiVacancyPage, ApiVacancyReview, ApiVacancyReviewInput } from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, path: string) {
    super(`GET ${path} failed with ${status}`)
    this.status = status
  }
}

type Params = Record<string, string | number | boolean | undefined | null>

export const query = (params: Params) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v))
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
  /** ВПК enterprises (default), recruitment agencies hiring for the ВПК, or both. */
  scope?: 'vpk' | 'agency' | 'all'
  level?: 'vpk' | 'confirmed' | 'likely' | 'all'
  /** Only vacancies with explicit ВПК markers in the text. */
  markers?: boolean
  /**
   * List filters take one value or several, comma-separated (`region_id: '64,77'`): any matches.
   * The card's legal entity: focus tag (`other` = ВПК without one), industry and role.
   */
  focus?: string
  domain?: string
  role?: string
  employer_id?: number
  region_id?: number | string
  /** Direction, job site and the vacancy's own fields; `none` = not given. */
  category?: string
  source?: string
  experience?: string
  schedule?: string
  employment?: string
  /** Monthly salary in RUB. */
  salary_min?: number
  salary_max?: number
  with_salary?: boolean
  title?: string
  q?: string
  days?: number
  sort?: 'confirmed' | 'published' | 'salary'
  limit?: number
  offset?: number
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new ApiError(res.status, path)
  return await res.json() as T
}

/** Download link for an export dataset; `vacancies` takes the same filters as the list. */
export const exportUrl = (dataset: string, format: ExportFormat, params: Params = {}) =>
  `/api/export/${dataset}.${format}${query(params)}`

export const api = {
  exportCatalog: (signal?: AbortSignal) => get<ApiExportCatalog>('/export', signal),
  mapPoints: (signal?: AbortSignal) => get<ApiMapPoint[]>('/employers/map-points', signal),
  mapNetwork: (signal?: AbortSignal) => get<ApiMapNetwork>('/employers/map-network', signal),
  stats: (signal?: AbortSignal) => get<ApiStats>('/stats', signal),
  employers: (signal?: AbortSignal) => get<ApiEmployer[]>('/employers', signal),
  employer: (id: number, signal?: AbortSignal) => get<ApiEmployerDetail>(`/employers/${id}`, signal),
  vacancies: (params: VacancyQuery, signal?: AbortSignal) => get<ApiVacancyPage>(`/vacancies${query(params)}`, signal),
  vacancyFacets: (params: Omit<VacancyQuery, 'sort' | 'limit' | 'offset'>, signal?: AbortSignal) =>
    get<ApiVacancyFacets>(`/vacancies/facets${query(params)}`, signal),
  vacancy: (id: number, signal?: AbortSignal) => get<ApiVacancyDetail>(`/vacancies/${id}`, signal),
  saveReview: (id: number, review: ApiVacancyReviewInput) => post<ApiVacancyReview>(`/vacancies/${id}/reviews`, review),
  saveEmployerReview: (id: number, review: ApiEmployerReviewInput) => post<ApiEmployerReview>(`/employers/${id}/reviews`, review),
  discoverySummary: (signal?: AbortSignal) => get<ApiDiscoveryCount[]>('/discovery/summary', signal),
  methodology: (signal?: AbortSignal) => get<ApiMethodology>('/methodology', signal),
  discovery: (params: { company_id?: number; provider?: string; status?: string; q?: string; limit?: number; offset?: number }, signal?: AbortSignal) =>
    get<ApiDiscoveryPage>(`/discovery${query(params)}`, signal),
  professions: (params: Omit<VacancyQuery, 'employer_id' | 'title' | 'q' | 'sort' | 'offset'>, signal?: AbortSignal) =>
    get<ApiProfession[]>(`/professions${query(params)}`, signal),
}
