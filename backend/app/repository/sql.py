"""SQL building blocks over the pipeline schema (see db/schema.sql).

Definitions used across queries:
- A vacancy's classification is the row from the latest classifier run.
- "ВПК" vacancies are those classified `confirmed` or `likely`.
- hh.ru vacancies have no region, only a city; the region is taken from trudvsem
  vacancies in the same city (the most common region for that locality).
- Monthly salary: RUB, period MONTH (trudvsem has no period and is monthly),
  midpoint of the range when both ends are known.
"""

VPK_LEVELS = ("confirmed", "likely")
VPK = "level IN ('confirmed', 'likely')"

AS_OF = "(SELECT max(last_seen_at) FROM vacancy)"

CTE = """
vc AS (
    SELECT DISTINCT ON (vacancy_id) vacancy_id, level, category
    FROM vacancy_classification
    ORDER BY vacancy_id, run_id DESC
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
        vc.level, vc.category,
        CASE
            WHEN vac.salary_currency = 'RUB'
             AND (vac.salary_period = 'MONTH' OR (vac.salary_period IS NULL AND vac.source = 'trudvsem'))
            THEN CASE
                WHEN vac.salary_from IS NOT NULL AND vac.salary_to IS NOT NULL
                THEN (vac.salary_from + vac.salary_to) / 2
                ELSE coalesce(vac.salary_from, vac.salary_to)
            END
        END AS monthly_salary
    FROM vacancy vac
    JOIN vc USING (vacancy_id)
    LEFT JOIN city_region cr ON cr.locality = vac.locality
    WHERE vac.is_active
)
"""

# One GUR company per INN (the pipeline may hold duplicates).
GUR_BY_INN = """
gur AS (
    SELECT DISTINCT ON (inn) inn, company_id,
           coalesce(name_short_uk, name_full_uk) AS name, sanctions_count
    FROM company
    WHERE inn IS NOT NULL
    ORDER BY inn, company_id
)
"""

EMPLOYER_AGG = f"""
agg AS (
    SELECT
        employer_profile_id AS id,
        count(*) FILTER (WHERE {VPK}) AS vpk_vacancies,
        count(*) FILTER (WHERE level = 'confirmed') AS confirmed_vacancies,
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

EMPLOYER_SELECT = f"""
WITH {CTE}, {GUR_BY_INN}, {EMPLOYER_AGG}
SELECT a.*, ep.name, ep.source, ep.inn, ep.ogrn, ep.kpp, ep.url AS profile_url, r.name AS region,
       g.company_id AS gur_company_id, g.name AS gur_name, coalesce(g.sanctions_count, 0) AS sanctions_count
FROM agg a
JOIN employer_profile ep ON ep.employer_profile_id = a.id
LEFT JOIN region r ON r.region_id = a.region_id
LEFT JOIN gur g ON g.inn = ep.inn
"""
