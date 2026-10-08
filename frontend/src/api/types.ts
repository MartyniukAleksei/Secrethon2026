// Wire format of the FastAPI backend (backend/app/api/schemas.py). Keep in sync.

export type Level = 'confirmed' | 'likely' | 'review' | 'no' | 'out_of_scope'
/** Category labels as stored by the pipeline classifier. */
export type Category = string | null

export type ApiMonthPoint = { month: string; vacancies: number }

export type ApiMapPoint = {
  employer_id: number
  lat: number
  lng: number
  locality: string | null
  region_id: number | null
  vacancies: number
}

export type ApiMapRelation = {
  company_id: number
  related_id: number
  kind: 'supplier' | 'parent'
  company_name: string
  related_name: string
  source: string
  label: string | null
  evidence_url: string | null
  profile_url: string | null
}

export type ApiMapNetwork = {
  relations: ApiMapRelation[]
  company_tags: { company_id: number; uav: boolean; weapons: boolean }[]
}

export type ApiStats = {
  as_of: string | null
  vacancies: number
  vpk_vacancies: number
  confirmed_vacancies: number
  vpk_employers: number
  regions: number
  median_salary: number | null
  gur_companies: number
  sanctioned_companies: number
  company_relations: number
  matched_employers: number
  /** Legal entities by the final classification; agencies and intermediaries are counted apart. */
  vpk_companies: number
  vpk_companies_decided: number
  agency_vpk_companies: number
  foreign_intermediary_companies: number
  /** Employer pages of recruitment agencies hiring for the ВПК, and their ВПК vacancies. */
  agency_employers: number
  agency_vacancies: number
  by_source: { source: string; vacancies: number; vpk_vacancies: number }[]
  by_level: { level: Level; vacancies: number }[]
  by_category: { category: Category; vacancies: number }[]
  regions_list: { region_id: number; name: string; vpk_vacancies: number; employers: number }[]
  monthly: ApiMonthPoint[]
}

export type ApiEmployer = {
  id: number
  name: string
  source: string
  inn: string | null
  ogrn: string | null
  kpp: string | null
  profile_url: string | null
  vpk_vacancies: number
  confirmed_vacancies: number
  total_vacancies: number
  new_30d: number
  median_salary: number | null
  category: Category
  locality: string | null
  region_id: number | null
  region: string | null
  last_published_at: string | null
  gur_company_id: number | null
  gur_name: string | null
  sanctions_count: number
  /** Latest human review; its values override the automatic ones above. */
  human_review: ApiEmployerReview | null
  /** Final classification of the legal entity; agency decision only for pages without one. */
  classification?: ApiCompanyClassificationBrief | null
  agency?: ApiEmployerAgency | null
}

export type HumanSource = 'hh' | 'trudvsem' | 'superjob' | 'gur' | 'registry' | 'company_site' | 'media' | 'other'
/** Admiralty code letter: A reliable … E unreliable, F cannot be judged. */
export type Reliability = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export type HumanSanctions = 'sanctioned' | 'not_sanctioned'
export type HumanVpk = 'confirmed' | 'likely' | 'no'
/** A human snapshot of the employer card; null keeps the automatic value. */
export type ApiEmployerReviewInput = {
  sources: HumanSource[] | null
  reliability: Reliability | null
  category: Category
  sanctions: HumanSanctions | null
  vpk: HumanVpk | null
  reviewed_by: string
  comment: string | null
}
export type ApiEmployerReview = ApiEmployerReviewInput & {
  review_id: number
  employer_id: number
  reviewed_at: string
}

export type ApiRelation = {
  kind: 'parent' | 'bank' | 'related' | 'successor' | 'supplier'
  direction: 'out' | 'in'
  company_id: number
  name: string
  inn: string | null
  sanctions_count: number
  employer_id: number | null
}

export type ApiGurCompany = {
  company_id: number
  name: string
  name_full_uk: string
  name_full_ru: string | null
  inn: string | null
  ogrn: string | null
  kpp: string | null
  address_uk: string | null
  description_uk: string | null
  products_uk: string[] | null
  activity_tags: string[]
  website: string | null
  logo_url: string | null
  gur_url: string | null
  sanctions_count: number
  sanctions_count_intl: number
  sanctions: { jurisdiction: string; jurisdiction_name: string | null; listed_on: string | null }[]
  relations: ApiRelation[]
  /** How the company was linked: by INN, automatic match, or probable name match. */
  match: 'inn' | 'auto' | 'name'
}

export type ApiProfileSource = {
  /** Number referenced as [n] in description_ru. */
  n: number
  url: string
  quote: string
  claim: string
  source_type: 'official_site' | 'registry' | 'sanctions_document' | 'news' | 'aggregator' | 'other'
  grade: string
}

/** Company profile assembled from open sources (Russian text); every source has a verified quote. */
export type ApiCompanyProfile = {
  company_id: number
  origin: string
  created_at: string
  /** Start of the search run that produced the profile. */
  updated_at: string
  activity_tags: string[] | null
  products_ru: string[] | null
  description_ru: string | null
  sources: ApiProfileSource[]
}

export type VpkCategory = 'vpk' | 'agency_vpk' | 'foreign_intermediary' | 'foreign_other' | 'civil_sanctioned' | 'out' | 'unknown'

/** Final ВПК decision for the legal entity (latest classification run); lists carry this short form. */
export type ApiCompanyClassificationBrief = {
  vpk_category: VpkCategory
  /** Empty when a rule decided. */
  vpk_probability: number | null
  vpk_level: 'decided' | 'review'
  direction_label: string | null
  direction_secondary: string | null
  /** Admiralty code: A1, B3, … */
  reliability: string | null
  reliability_note: string | null
  sanctions_gur: string[] | null
  sanctions_new: string[] | null
}

/** Company-page form: with the sanctions found and the explanation. */
export type ApiCompanyClassification = ApiCompanyClassificationBrief & {
  sanctions_found: { jurisdiction: string; list_name: string | null; listed_raw: string | null; in_gur: boolean; url: string | null }[]
  /** Russian text: decision, probabilities, evidence. */
  explanation: string
}

/** Verified corporate requisite or contact; `url` is the page it was found on. */
export type ApiCompanyContact = {
  kind: 'inn' | 'ogrn' | 'legal_name' | 'website' | 'phone' | 'email' | 'head' | 'address'
  value: string
  detail: string | null
  url: string | null
}

export type ApiEmployerAgency = { category: string | null; level: string; score: number | null; raw_label: string }

export type ApiProfession = {
  title: string
  vacancies: number
  employers: number | null
  median_salary: number | null
  category: Category
}

export type ApiEmployerDetail = ApiEmployer & {
  monthly: ApiMonthPoint[]
  professions: ApiProfession[]
  localities: { locality: string; region: string | null; vacancies: number }[]
  hiring_locations: {
    address: string | null
    locality: string | null
    lat: number | null
    lng: number | null
    source: string
    vacancy_id: number
    vacancy_url: string
  }[]
  gur: ApiGurCompany | null
  /** Legal entity behind the page; 'candidate' marks a probable link. */
  company_id: number | null
  company_link: 'auto' | 'candidate' | null
  classification: ApiCompanyClassification | null
  profile: ApiCompanyProfile | null
  registry: { address: string | null; head: string | null } | null
  contacts: ApiCompanyContact[]
  /** Recruitment-agency decision, only for a page without a legal entity. */
  agency: ApiEmployerAgency | null
  human_reviews: ApiEmployerReview[]
}

export type ApiVacancy = {
  id: number
  source: string
  url: string
  employer_id: number | null
  employer_name: string | null
  title: string
  locality: string | null
  region_id: number | null
  region: string | null
  salary_from: number | null
  salary_to: number | null
  salary_currency: string | null
  salary_period: string | null
  monthly_salary: number | null
  experience: string | null
  schedule: string | null
  employment: string | null
  published_at: string | null
  level: Level
  category: Category
}

export type ApiVacancyDetail = ApiVacancy & {
  address: string | null
  description: string | null
  responsibilities: string | null
  requirements: string | null
  conditions: string | null
  skills_raw: string | null
  education: string | null
  classifier_name: string
  classifier_version: string | null
  reviews: ApiVacancyReview[]
}

export type ReviewConfidence = 'high' | 'medium' | 'low'
export type ApiVacancyReviewInput = {
  source: 'human' | 'llm'
  confidence: ReviewConfidence
  reviewed_by: string
  comment: string | null
}
export type ApiVacancyReview = ApiVacancyReviewInput & {
  review_id: number
  vacancy_id: number
  reviewed_at: string
}

export type ApiVacancyPage = { total: number; items: ApiVacancy[] }

export type ApiExportColumn = { name: string; type: 'int' | 'float' | 'text' | 'bool' | 'date' | 'timestamp' | 'text[]'; description: string }

export type ApiExportDataset = {
  name: string
  title: string
  description: string
  key: string[]
  filterable: boolean
  columns: ApiExportColumn[]
  row_count: number
  urls: Record<ExportFormat, string>
  schema_url: string
}

export type ExportFormat = 'csv' | 'json' | 'jsonl' | 'parquet'

export type ApiExportCatalog = {
  as_of: string | null
  formats: ExportFormat[]
  snapshot: { zip: string; sql: string }
  datasets: ApiExportDataset[]
}
