"""SQL building blocks over the pipeline schema (see db/schema.sql).

Definitions used across queries:
- The enterprise is classified, not the vacancy: every vacancy carries one final label, the
  classifier run `vacancy_final` (the pipeline keeps a single run). Its category is `vpk`,
  `agency` (a recruitment agency hiring for the ВПК, counted apart) or `excluded`; its level is
  `confirmed`, `likely` (shown, on review) or `no` (not shown).
- Until the first `vacancy_final` run exists, the latest row of any run stands in, all as `vpk`.
- Duplicates are dropped: vacancies are read from `vacancy_unique`.
- The direction (производство, НИИ/КБ, ремонт) comes from the source text filters; it is shown
  only and never decides whether a vacancy counts.
- hh.ru vacancies have no region, only a city; the region is taken from trudvsem
  vacancies in the same city (the most common region for that locality).
- Monthly salary: RUB, period MONTH (trudvsem has no period and is monthly),
  midpoint of the range when both ends are known.
"""

FINAL_RUN = "vacancy_final"
TEXT_RUNS = "('hh_filter', 'superjob_filter', 'trudvsem_vpk_rules', 'hidden_vpk_employer')"
MARKERS_SIGNAL = "явные признаки ВПК в тексте"

# Shown on the site: confirmed, or likely (on review). Vacancies of ВПК enterprises and those
# of recruitment agencies are counted apart.
SHOWN = "final_level IN ('confirmed', 'likely')"
VPK = f"final_category = 'vpk' AND {SHOWN}"
AGENCY = f"final_category = 'agency' AND {SHOWN}"

AS_OF = "(SELECT max(last_seen_at) FROM vacancy)"

CTE = f"""
fin AS (
    SELECT vc.vacancy_id, vc.category AS final_category, vc.level AS final_level,
           vc.raw_label AS final_basis, vc.score AS final_score
    FROM vacancy_classification vc JOIN classifier_run r USING (run_id)
    WHERE r.classifier = '{FINAL_RUN}'
    UNION ALL
    -- Fallback until the first final run: the latest row of any run, as before; vacancies of
    -- employers the `employer_agency` run found to be ВПК recruitment agencies go apart.
    SELECT l.vacancy_id,
           CASE WHEN ag.employer_profile_id IS NOT NULL THEN 'agency' ELSE 'vpk' END,
           l.level, 'legacy', NULL::real
    FROM (
        SELECT DISTINCT ON (vacancy_id) vacancy_id, level
        FROM vacancy_classification
        ORDER BY vacancy_id, run_id DESC
    ) l
    JOIN vacancy lv USING (vacancy_id)
    LEFT JOIN (
        SELECT DISTINCT ON (ec.employer_profile_id) ec.employer_profile_id, ec.category
        FROM employer_classification ec JOIN classifier_run r USING (run_id)
        WHERE r.classifier = 'employer_agency'
        ORDER BY ec.employer_profile_id, r.started_at DESC
    ) ag ON ag.employer_profile_id = lv.employer_profile_id AND ag.category = 'agency_vpk'
    WHERE NOT EXISTS (SELECT 1 FROM classifier_run WHERE classifier = '{FINAL_RUN}')
),
direction AS (
    SELECT DISTINCT ON (vc.vacancy_id) vc.vacancy_id, vc.category
    FROM vacancy_classification vc JOIN classifier_run r USING (run_id)
    WHERE r.classifier IN {TEXT_RUNS} AND vc.category IS NOT NULL
    ORDER BY vc.vacancy_id, vc.run_id DESC
),
markers AS (
    SELECT DISTINCT e.vacancy_id
    FROM classification_evidence e JOIN classifier_run r USING (run_id)
    WHERE r.classifier = '{FINAL_RUN}' AND e.signal = '{MARKERS_SIGNAL}'
),
city_region AS (
    SELECT DISTINCT ON (locality) locality, region_id
    FROM vacancy
    WHERE region_id IS NOT NULL AND locality IS NOT NULL
    GROUP BY locality, region_id
    ORDER BY locality, count(*) DESC
),
v AS (
    SELECT
        vac.vacancy_id, vac.source, vac.url, vac.employer_profile_id, vac.employer_name, vac.title,
        vac.locality, vac.lat, vac.lng, coalesce(vac.region_id, cr.region_id) AS region_id,
        vac.salary_from, vac.salary_to, vac.salary_currency, vac.salary_period,
        vac.experience, vac.schedule, vac.employment, vac.published_at,
        fin.final_category, fin.final_level, fin.final_basis, fin.final_score,
        fin.final_level AS level, d.category, m.vacancy_id IS NOT NULL AS has_markers,
        CASE
            WHEN vac.salary_currency = 'RUB'
             AND (vac.salary_period = 'MONTH' OR (vac.salary_period IS NULL AND vac.source = 'trudvsem'))
            THEN CASE
                WHEN vac.salary_from IS NOT NULL AND vac.salary_to IS NOT NULL
                THEN (vac.salary_from + vac.salary_to) / 2
                ELSE coalesce(vac.salary_from, vac.salary_to)
            END
        END AS monthly_salary
    FROM vacancy_unique vac
    JOIN fin USING (vacancy_id)
    LEFT JOIN direction d USING (vacancy_id)
    LEFT JOIN markers m USING (vacancy_id)
    LEFT JOIN city_region cr ON cr.locality = vac.locality
    WHERE vac.is_active
)
"""

# `company` also holds registry-only companies (no GUR portal card); GUR ones have a Ukrainian name.
ON_GUR = "name_full_uk IS NOT NULL"

# One GUR company per INN (the pipeline may hold duplicates).
GUR_BY_INN = f"""
gur AS (
    SELECT DISTINCT ON (inn) inn, company_id,
           coalesce(name_short_uk, name_full_uk) AS name, sanctions_count
    FROM company
    WHERE inn IS NOT NULL AND {ON_GUR}
    ORDER BY inn, company_id
)
"""

EMPLOYER_AGG = f"""
agg AS (
    SELECT
        employer_profile_id AS id,
        count(*) FILTER (WHERE {VPK}) AS vpk_vacancies,
        count(*) FILTER (WHERE {VPK} AND final_level = 'confirmed') AS confirmed_vacancies,
        count(*) FILTER (WHERE {VPK} AND final_level = 'likely') AS on_review_vacancies,
        count(*) FILTER (WHERE {AGENCY}) AS agency_vacancies,
        count(*) AS total_vacancies,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary) FILTER (WHERE {VPK}) AS median_salary,
        mode() WITHIN GROUP (ORDER BY category) FILTER (WHERE {VPK}) AS category,
        mode() WITHIN GROUP (ORDER BY locality) AS locality,
        mode() WITHIN GROUP (ORDER BY region_id) AS region_id,
        max(published_at) AS last_published_at,
        count(*) FILTER (WHERE {VPK} AND published_at > {AS_OF} - interval '30 days') AS new_30d
    FROM v
    WHERE employer_profile_id IS NOT NULL
    GROUP BY employer_profile_id
)
"""

# Employers listed on the site: at least one shown vacancy, of a ВПК enterprise or an agency.
LISTED = "(a.vpk_vacancies + a.agency_vacancies) > 0"

# The latest human review per employer (app-owned table, see app/reviews.py). Until the first
# review is saved the table doesn't exist, so queries get an empty stand-in with the same columns.
HUMAN_REVIEW_PLACEHOLDER = "{human_review}"
HUMAN_REVIEW_LATEST = """
hr AS (
    SELECT DISTINCT ON (employer_id) *
    FROM web_reviews.employer_review
    ORDER BY employer_id, review_id DESC
)
"""
HUMAN_REVIEW_EMPTY = """
hr AS (
    SELECT NULL::bigint AS review_id, NULL::bigint AS employer_id, NULL::text[] AS sources,
           NULL::text AS reliability, NULL::text AS category, NULL::text AS sanctions,
           NULL::text AS vpk, NULL::text AS reviewed_by, NULL::text AS comment,
           NULL::timestamptz AS reviewed_at
    WHERE false
)
"""
HUMAN_REVIEW_FIELDS = (
    "review_id",
    "sources",
    "reliability",
    "category",
    "sanctions",
    "vpk",
    "reviewed_by",
    "comment",
    "reviewed_at",
)


def with_human_review(sql: str, ready: bool) -> str:
    """Fill the `hr` CTE placeholder: the real table once it exists, else an empty one."""
    return sql.replace(
        HUMAN_REVIEW_PLACEHOLDER, HUMAN_REVIEW_LATEST if ready else HUMAN_REVIEW_EMPTY
    )


AGG_COUNTS = (
    "vpk_vacancies",
    "confirmed_vacancies",
    "on_review_vacancies",
    "agency_vacancies",
    "total_vacancies",
    "new_30d",
)

# Contains the `{human_review}` placeholder; run it through with_human_review().
# Every employer profile, with zero counts when it has no shown vacancy: the company page stays
# reachable; lists filter by LISTED.
EMPLOYER_SELECT = f"""
WITH {CTE}, {GUR_BY_INN}, {EMPLOYER_AGG}, {HUMAN_REVIEW_PLACEHOLDER}
SELECT ep.employer_profile_id AS id,
       {", ".join(f"coalesce(a.{c}, 0) AS {c}" for c in AGG_COUNTS)},
       a.median_salary, a.category, a.locality, a.region_id, a.last_published_at,
       ep.name, ep.source, ep.inn, ep.ogrn, ep.kpp, ep.url AS profile_url, r.name AS region,
       g.company_id AS gur_company_id, g.name AS gur_name, coalesce(g.sanctions_count, 0) AS sanctions_count,
       {", ".join(f"hr.{c} AS human_{c}" for c in HUMAN_REVIEW_FIELDS)}
FROM employer_profile ep
LEFT JOIN agg a ON a.id = ep.employer_profile_id
LEFT JOIN region r ON r.region_id = a.region_id
LEFT JOIN gur g ON g.inn = ep.inn
LEFT JOIN hr ON hr.employer_id = ep.employer_profile_id
"""
