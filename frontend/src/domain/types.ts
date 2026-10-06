import type { ApiEmployer, ApiEmployerDetail, ApiStats, ApiVacancy, ApiVacancyDetail, Category, Level } from '../api/types'

export type { Category, Level }

export type Employer = ApiEmployer
export type EmployerDetail = ApiEmployerDetail
export type Vacancy = ApiVacancy
export type VacancyDetail = ApiVacancyDetail
export type Stats = ApiStats
export type Region = ApiStats['regions_list'][number]

export type Dataset = {
  stats: Stats
  /** Employers with ВПК vacancies, biggest first. */
  employers: Employer[]
  byId: Record<number, Employer>
  regions: Region[]
  regionById: Record<number, Region>
  /** When the data was last collected; relative dates are counted from it. */
  asOf: Date
}
