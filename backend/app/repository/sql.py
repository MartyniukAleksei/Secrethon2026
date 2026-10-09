"""SQL building blocks over the pipeline schema (see db/schema.sql).

Definitions used across queries:
- The enterprise is classified, not the vacancy: every vacancy carries one final label, the
  classifier run `vacancy_final` (the pipeline keeps a single run). Its category is `vpk`,
  `agency` (a recruitment agency hiring for the ВПК, counted apart) or `excluded`; its level is
  `confirmed`, `likely` (shown, on review) or `no` (not shown).
- Duplicates are dropped: vacancies are read from `vacancy_unique`.
- One card per enterprise: profiles of one legal entity on different job sites form a group
  (`employer_group`, branches apart); the card id is the group's main profile (`group_id`).
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


def vacancy_cte(with_duplicates: bool = False) -> str:
    """The `v` CTE of active vacancies. With duplicates, reposts and cross-site copies stay
    in (they share their canonical vacancy's label) and `duplicate_of` points at it."""
    source = (
        "vacancy vac LEFT JOIN vacancy_duplicate dup ON dup.vacancy_id = vac.vacancy_id"
        if with_duplicates
        else "vacancy_unique vac LEFT JOIN vacancy_duplicate dup ON false"
    )
    return f"""
fin AS (
    SELECT vc.vacancy_id, vc.category AS final_category, vc.level AS final_level,
           vc.raw_label AS final_basis, vc.score AS final_score
    FROM vacancy_classification vc JOIN classifier_run r USING (run_id)
    WHERE r.classifier = '{FINAL_RUN}'
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
        coalesce(g.group_id, vac.employer_profile_id) AS card_id, g.company_id,
        vac.locality, vac.lat, vac.lng, coalesce(vac.region_id, cr.region_id) AS region_id,
        vac.salary_from, vac.salary_to, vac.salary_currency, vac.salary_period,
        vac.experience, vac.schedule, vac.employment, vac.published_at,
        fin.final_category, fin.final_level, fin.final_basis, fin.final_score,
        fin.final_level AS level, d.category, m.vacancy_id IS NOT NULL AS has_markers,
        dup.canonical_id AS duplicate_of, dup.method AS duplicate_method,
        dup.score AS duplicate_score,
        CASE
            WHEN vac.salary_currency = 'RUB'
             AND (vac.salary_period = 'MONTH' OR (vac.salary_period IS NULL AND vac.source = 'trudvsem'))
            THEN CASE
                WHEN vac.salary_from IS NOT NULL AND vac.salary_to IS NOT NULL
                THEN (vac.salary_from + vac.salary_to) / 2
                ELSE coalesce(vac.salary_from, vac.salary_to)
            END
        END AS monthly_salary
    FROM {source}
    JOIN fin ON fin.vacancy_id = coalesce(dup.canonical_id, vac.vacancy_id)
    LEFT JOIN direction d ON d.vacancy_id = fin.vacancy_id
    LEFT JOIN markers m ON m.vacancy_id = fin.vacancy_id
    LEFT JOIN employer_group g ON g.employer_profile_id = vac.employer_profile_id
    LEFT JOIN city_region cr ON cr.locality = vac.locality
    WHERE vac.is_active
)
"""


CTE = vacancy_cte()

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

# The final classification of every legal entity (latest run).
CLASSIFICATION_SELECT = """
    SELECT DISTINCT ON (cc.company_id) cc.*
    FROM company_classification cc JOIN classifier_run r USING (run_id)
    WHERE r.classifier = 'company_classification'
    ORDER BY cc.company_id, r.started_at DESC
"""
CLASSIFICATION = f"cls AS ({CLASSIFICATION_SELECT})"

# Customer focus tags of ВПК companies (latest `company_focus` run); none means "adjacent".
FOCUS_SELECT = """
    SELECT f.company_id, f.focus, f.basis, f.score, f.evidence
    FROM company_focus f
    WHERE f.run_id = (SELECT max(run_id) FROM classifier_run WHERE classifier = 'company_focus')
"""
FOCUS = f"focus AS ({FOCUS_SELECT})"
FOCUS_KEYS = ("drone", "missile", "kab")

EMPLOYER_AGG = f"""
agg AS (
    SELECT
        card_id AS id,
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
    GROUP BY card_id
)
"""

# Employers listed on the site: at least one shown vacancy, of a ВПК enterprise or an agency.
LISTED = "(a.vpk_vacancies + a.agency_vacancies) > 0"

# The latest human review per card (app-owned table, see app/reviews.py); reviews saved under
# any profile of the group count for its card. Until the first review is saved the table doesn't
# exist, so queries get an empty stand-in with the same columns.
HUMAN_REVIEW_PLACEHOLDER = "{human_review}"
HUMAN_REVIEW_LATEST = """
hr AS (
    SELECT DISTINCT ON (card_id) * FROM (
        SELECT er.*, coalesce(eg.group_id, er.employer_id) AS card_id
        FROM web_reviews.employer_review er
        LEFT JOIN employer_group eg ON eg.employer_profile_id = er.employer_id
    ) x
    ORDER BY card_id, review_id DESC
)
"""
HUMAN_REVIEW_EMPTY = """
hr AS (
    SELECT NULL::bigint AS review_id, NULL::bigint AS employer_id, NULL::text[] AS sources,
           NULL::text AS reliability, NULL::text AS category, NULL::text AS sanctions,
           NULL::text AS vpk, NULL::text AS reviewed_by, NULL::text AS comment,
           NULL::timestamptz AS reviewed_at, NULL::bigint AS card_id
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
# Every card (the group's main profile), with zero counts when it has no shown vacancy: the
# company page stays reachable; lists filter by LISTED. The legal entity is the group's; hh
# profiles carry no INN, so the card takes the INN of its legal entity.
EMPLOYER_SELECT = f"""
WITH {CTE}, {GUR_BY_INN}, {EMPLOYER_AGG}, {HUMAN_REVIEW_PLACEHOLDER},
members AS (
    SELECT group_id, count(*) AS profiles, array_agg(employer_profile_id ORDER BY employer_profile_id) AS profile_ids
    FROM employer_group GROUP BY group_id
)
SELECT ep.employer_profile_id AS id,
       {", ".join(f"coalesce(a.{c}, 0) AS {c}" for c in AGG_COUNTS)},
       a.median_salary, a.category, a.locality, a.region_id, a.last_published_at,
       ep.name, ep.source, coalesce(ep.inn, c.inn) AS inn, coalesce(ep.ogrn, c.ogrn) AS ogrn,
       ep.inn AS profile_inn, ep.kpp, ep.url AS profile_url, r.name AS region,
       gu.company_id AS gur_company_id, gu.name AS gur_name, coalesce(gu.sanctions_count, 0) AS sanctions_count,
       eg.company_id, eg.is_branch, eg.method AS group_method,
       coalesce(m.profiles, 1) AS profiles, coalesce(m.profile_ids, ARRAY[ep.employer_profile_id]) AS profile_ids,
       {", ".join(f"hr.{c} AS human_{c}" for c in HUMAN_REVIEW_FIELDS)}
FROM employer_group eg
JOIN employer_profile ep ON ep.employer_profile_id = eg.group_id
LEFT JOIN company c ON c.company_id = eg.company_id
LEFT JOIN members m ON m.group_id = eg.group_id
LEFT JOIN agg a ON a.id = eg.group_id
LEFT JOIN region r ON r.region_id = a.region_id
LEFT JOIN gur gu ON gu.inn = coalesce(ep.inn, c.inn)
LEFT JOIN hr ON hr.card_id = eg.group_id
WHERE eg.is_head
"""

# The card a profile belongs to (itself when it has no group row).
CARD_OF = "coalesce((SELECT group_id FROM employer_group WHERE employer_profile_id = :id), :id)"
