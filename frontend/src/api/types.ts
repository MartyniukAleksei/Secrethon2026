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

/** A company's head office or branch by the register (DaData), not a hiring place. */
export type ApiSiteKind = 'head_office' | 'branch'

export type ApiMapSite = {
  employer_id: number
  kind: ApiSiteKind
  name: string | null
  address: string
  lat: number
  lng: number
  /** DaData qc_geo: 0 house, 1 nearest house, 2 street, 3 settlement. */
  geo_qc: number | null
}

export type ApiCompanySite = Omit<ApiMapSite, 'employer_id' | 'lat' | 'lng'> & {
  lat: number | null
  lng: number | null
  on_map: boolean
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

export type ApiFunnel = {
  collected: number
  unique_vacancies: number
  excluded: number
  no_signal: number
  agency: number
  likely: number
  confirmed: number
  cards: number
  legal_entities: number
  decided: number
  on_gur: number
}

export type DiscoveryStatus = 'fact' | 'no_fact' | 'contact' | 'query'
export type ApiDiscoveryCount = { provider: string; status: DiscoveryStatus; rows: number; first_at: string | null; last_at: string | null }
export type ApiDiscoveryEntry = {
  log_id: number
  company_id: number | null
  company_name: string | null
  /** The company's card on the site, when it has one. */
  card_id: number | null
  provider: string
  query: string | null
  url: string | null
  title: string | null
  snippet: string | null
  published: string | null
  found_at: string | null
  status: DiscoveryStatus
}
export type ApiDiscoveryPage = { total: number; items: ApiDiscoveryEntry[] }

export type ApiStats = {
  as_of: string | null
  /** Start of the final vacancy labelling run (`vacancy_final`); null while the fallback is used. */
  final_run_at: string | null
  vacancies: number
  vpk_vacancies: number
  confirmed_vacancies: number
  /** ВПК vacancies on review (`likely`). */
  on_review_vacancies: number
  /** Enterprise cards with ВПК vacancies, and the job-site profiles and legal entities behind them. */
  vpk_employers: number
  vpk_profiles: number
  vpk_legal_entities: number
  /** ВПК vacancies with a monthly RUB salary (the median is over these). */
  salary_samples: number
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
  foreign_intermediary_decided: number
  /** Employer pages of recruitment agencies hiring for the ВПК and their vacancies; not part of vpk_*. */
  agency_employers: number
  agency_vacancies: number
  by_source: { source: string; vacancies: number; vpk_vacancies: number }[]
  by_level: { level: Level; vacancies: number }[]
  /** Found → deduplicated → screened out → shown → cards → legal entities → decided → on GUR. */
  funnel: ApiFunnel
  by_basis: { category: FinalCategory; basis: string; vacancies: number }[]
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
  on_review_vacancies: number
  /** Vacancies placed as a recruitment agency hiring for the ВПК. */
  agency_vacancies: number
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
  /** Logo from the company's GUR card. */
  logo_url?: string | null
  /** One card per enterprise: job-site profiles merged into it; a branch card of its legal entity. */
  profiles: number
  is_branch: boolean
  /** Focus tags of a ВПК company: [] = adjacent defence, null = not a ВПК company. */
  focus: ApiFocus[] | null
  /** A profile of the card has a questionable link to its legal entity. */
  match_conflict: boolean
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
  kind: 'parent' | 'bank' | 'related' | 'successor' | 'supplier' | 'branch'
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
  /** Industry (filter «Галузь») and role (filter «Роль») of the company. */
  direction_domain: string | null
  direction_role: string | null
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

export type FocusKey = 'drone' | 'missile' | 'kab'
/** Customer focus tag of a ВПК company with its strongest basis; `evidence` holds every basis found. */
export type ApiFocus = {
  focus: FocusKey
  basis: string
  score: number | null
  evidence: {
    gur_weapon?: { weapon: string }[]
    gur_component?: { weapon: string }[]
    gur_uav?: { model: string }[]
    vacancies?: { vacancy_id: number; quote: string }[]
  } | null
}

/** A job-site profile merged into the card, with its shown vacancies. */
export type ApiCardSource = { employer_profile_id: number; source: string; name: string; url: string | null; vacancies: number }
/** A questionable link of a profile to its legal entity. */
export type ApiMatchConflict = {
  employer_profile_id: number
  kind: 'different_inn' | 'peer_other_region'
  evidence: { inn?: string; other_inn?: string; profile?: string[]; other?: string[]; regions?: string[]; company_regions?: string[]; profile_regions?: string[] } | null
}

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
  /** Where the company is by the register: head office and branches. */
  sites: ApiCompanySite[]
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
  /** «Джерела вакансій»: the card's profiles on job sites. */
  sources: ApiCardSource[]
  /** A branch card: the card of its head office. */
  parent_card_id: number | null
  match_conflicts: ApiMatchConflict[]
}

/** Vacancies per value of each filter field, counted under all the other filters. */
export type ApiVacancyFacets = Record<
  'region_id' | 'source' | 'category' | 'experience' | 'schedule' | 'employment' | 'domain' | 'role' | 'focus',
  { value: string | null; vacancies: number }[]
>

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
  final_category: FinalCategory
  /** Basis of the final label: company_vpk, company_vpk_review, text_jev, legacy, … */
  final_basis: string
  /** Explicit ВПК markers in the text (state secret, GOZ, military acceptance…). */
  has_markers: boolean
}

/** Final vacancy label: of a ВПК enterprise, through a recruitment agency, or not shown. */
export type FinalCategory = 'vpk' | 'agency' | 'excluded'
export type ApiEvidence = { signal: string; origin: string; weight: number | null; snippet: string | null }

export type ApiVacancyDetail = ApiVacancy & {
  address: string | null
  description: string | null
  responsibilities: string | null
  requirements: string | null
  conditions: string | null
  skills_raw: string | null
  education: string | null
  final_level: Level
  final_score: number | null
  /** Counted and listed on the site; excluded vacancies stay reachable by a direct link. */
  shown: boolean
  evidence: ApiEvidence[]
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
  /** What one row is: «одна юрособа», «одна вакансія». */
  row: string
  key: string[]
  filterable: boolean
  columns: ApiExportColumn[]
  row_count: number
  urls: Record<ExportFormat, string>
  schema_url: string
}

export type ExportFormat = 'csv' | 'json' | 'jsonl' | 'parquet'

/** Export coverage: as on the site, every ВПК company, or the whole database. */
export type ExportCoverage = 'site' | 'vpk' | 'all'

export type ApiExportCoverageCounts = { companies: number; cards: number; vacancies: number }

export type ApiExportCatalog = {
  as_of: string | null
  coverage: ExportCoverage
  dedup: boolean
  coverages: { name: ExportCoverage; title: string; description: string }[]
  formats: ExportFormat[]
  snapshot: { zip: string; sql: string }
  datasets: ApiExportDataset[]
  overview: {
    coverages: Record<ExportCoverage, ApiExportCoverageCounts>
    dedup: {
      vacancies_raw: number
      vacancies_unique: number
      reposts: number
      cross_source: number
      site_profiles: number
      site_cards: number
      company_duplicates: number
      companies_raw: number
    }
  }
}

/** Numbers for the «Про дані» page (GET /api/methodology). */
export type ApiJudgeStratum = { kind: 'company' | 'vacancy'; stratum: string; n: number; agree: number; agree_vpk: number }
export type ApiJudgeDisagreement = {
  kind: 'company' | 'vacancy'
  item_id: number
  stratum: string
  our_label: string
  judge_label: string
  confidence: number | null
  reason: string | null
  name: string | null
  card_id: number | null
}
export type ApiMethodology = {
  matching: { kind: 'auto' | 'verified' | 'candidate_sure' | 'candidate_weak'; profiles: number }[]
  match_methods: { method: string; links: number }[]
  dedup: {
    vacancies: number
    reposts: number
    cross_source: number
    profiles: number
    cards: number
    branch_profiles: number
    companies: number
    company_duplicates: number
    branch_edges: number
  }
  companies: { category: string; level: 'decided' | 'review'; decided_by: 'jev' | 'rule'; n: number }[]
  vacancies: { category: string; level: string; n: number }[]
  focus: { focus: string; basis: string; n: number }[]
  checks: {
    facts_verified: number
    facts_rejected: number
    contacts_verified: number
    contacts_rejected: number
    profiles: number
    sanctions_found: number
  }
  judge: {
    run_id: number
    version: string
    model: string | null
    started_at: string
    strata: ApiJudgeStratum[]
    disagreements: ApiJudgeDisagreement[]
  } | null
  human: { employer_reviews: number; employer_cards: number; vacancy_human: number; vacancy_llm: number }
  mcp: { enabled: boolean; url: string; key: string | null; tools: { name: string; description: string }[] }
}
