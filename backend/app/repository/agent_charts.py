"""Design-system analytics built from bounded SQL, never model-supplied numbers."""

import math
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.sql import AS_OF, CTE, GUR_BY_INN
from app.repository.vacancies import VacancyFilter

View = Literal[
    "auto",
    "line",
    "donut",
    "stacked",
    "bar",
    "heatmap",
    "scatter",
    "histogram",
    "professions",
    "kpi",
    "signals",
]
TITLES = {
    "line": "Активні вакансії за місяцем публікації",
    "donut": "Частка вакансій за галузями",
    "stacked": "Склад найму за місяцями",
    "bar": "Медіана зарплати за галузями",
    "heatmap": "Регіони і галузі",
    "scatter": "Підприємства: обсяг найму і зарплата",
    "histogram": "Розподіл місячних зарплат",
    "professions": "Професії, які шукають найбільше",
    "kpi": "Ключові показники вибірки",
    "signals": "Статистичні сигнали",
}
DOMAIN_LABELS = {
    "aviation": "Авіабудування",
    "engines": "Двигуни",
    "missiles_space": "Ракетно-космічна техніка",
    "air_defense_radar": "ППО і радіолокація",
    "electronics_comms": "Радіоелектроніка і зв'язок",
    "optics": "Оптика",
    "armored_vehicles": "Бронетехніка й артилерія",
    "ammo_chemicals": "Боєприпаси і спецхімія",
    "shipbuilding": "Суднобудування",
    "uav": "БпЛА",
    "small_arms": "Стрілецька зброя",
    "machining_materials": "Верстати і матеріали",
    "rnd_institute": "НДІ і КБ",
    "trade_logistics": "Торгівля і логістика",
    "finance": "Фінанси",
    "civil_other": "Цивільна діяльність",
    "none": "Галузь не визначено",
}


def column(key: str, label: str, fmt: str = "number") -> dict:
    return {"key": key, "label": label, "format": fmt}


def selection(filters, query, employer_ids, only_sanctioned):
    where, params = filters.where()
    if query:
        where += " AND (ep.name ILIKE :name OR coalesce(c.inn, ep.inn) = :exact)"
        params.update(name=f"%{query}%", exact=query)
    if employer_ids:
        where += " AND v.card_id = ANY(:ids)"
        params["ids"] = employer_ids
    if only_sanctioned:
        where += " AND coalesce(g.sanctions_count, 0) > 0"
    cte = f"""{CTE}, {GUR_BY_INN}, selected AS (
        SELECT v.*, coalesce(ep.name, v.employer_name, 'Невідомо') AS company_name,
               coalesce(r.name, 'Регіон не вказано') AS region_name,
               v.direction_domain AS domain
        FROM v
        LEFT JOIN employer_profile ep ON ep.employer_profile_id = v.card_id
        LEFT JOIN company c ON c.company_id = v.company_id
        LEFT JOIN region r ON r.region_id = v.region_id
        LEFT JOIN gur g ON g.inn = coalesce(c.inn, ep.inn)
        WHERE {where}
    )"""
    return cte, params


async def visualization(
    session: AsyncSession,
    filters: VacancyFilter,
    view: View,
    query: str = "",
    employer_ids: list[int] | None = None,
    limit: int = 10,
    only_sanctioned: bool = False,
) -> dict:
    cte, params = selection(filters, query, employer_ids, only_sanctioned)
    params["limit"] = limit
    metrics = (
        """count(*) AS vacancies, count(monthly_salary) AS salary_samples,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary) AS median_salary,
        count(*) FILTER (WHERE published_at > """
        + AS_OF
        + """ - interval '30 days'
            AND published_at <= """
        + AS_OF
        + ") AS recent_30d"
    )
    stats = dict(
        (
            await session.execute(
                text(f"""WITH {cte}
        SELECT count(*) AS vacancies, count(DISTINCT card_id) AS employers,
               count(DISTINCT region_id) AS regions, count(monthly_salary) AS salary_samples,
               count(*) FILTER (WHERE final_level = 'confirmed') AS confirmed,
               count(*) FILTER (WHERE final_level = 'likely') AS likely,
               percentile_cont(ARRAY[0.25,0.5,0.75])
                   WITHIN GROUP (ORDER BY monthly_salary) AS quartiles,
               max(monthly_salary) AS max_salary
        FROM selected"""),
                params,
            )
        )
        .mappings()
        .one()
    )
    as_of = (await session.execute(text(f"SELECT {AS_OF}"))).scalar_one()
    note = "Активні вакансії, без дублів. Період відраховано від дати зрізу бази."
    columns = [column("label", "Галузь", "domain"), column("value", "Вакансій")]
    sql = ""
    kind = view
    if view in {"donut", "bar"}:
        value = (
            "count(*)"
            if view == "donut"
            else ("percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_salary)")
        )
        sql = f"""SELECT domain AS id, domain AS label, {value} AS value, {metrics}
                  FROM selected GROUP BY domain ORDER BY value DESC NULLS LAST, domain"""
        if view == "bar":
            columns = [
                column("label", "Галузь", "domain"),
                column("value", "Медіана, ₽", "money"),
                column("salary_samples", "Вибірка зарплат"),
            ]
            note += " Медіани місячних зарплат із вакансій у RUB, не фактична оплата праці."
    elif view == "line":
        sql = f"""SELECT date_trunc('month', published_at)::date AS id,
                 date_trunc('month', published_at)::date::text AS label,
                 count(*) AS value, {metrics}
                 FROM selected WHERE published_at IS NOT NULL
                 GROUP BY 1,2 ORDER BY id DESC LIMIT :limit"""
        columns = [column("label", "Місяць", "text"), column("value", "Вакансій")]
        note += " Останні місяці публікації; це не історичні знімки чисельності вакансій."
    elif view == "stacked":
        sql = f"""SELECT date_trunc('month', published_at)::date::text AS id,
                 date_trunc('month', published_at)::date::text AS label,
                 domain, count(*) AS value, {metrics}
                 FROM selected WHERE published_at >= date_trunc('month', {AS_OF})
                     - interval '11 months' AND published_at <= {AS_OF}
                 GROUP BY 1,2,domain ORDER BY id,domain"""
        columns = [
            column("label", "Місяць", "text"),
            column("domain", "Галузь", "domain"),
            column("value", "Вакансій"),
        ]
        note += " До 12 місяців за датою публікації нині активних вакансій."
    elif view == "heatmap":
        sql = f"""SELECT region_id AS id, region_name AS label, domain,
                     count(*) AS value, {metrics}
                 FROM selected WHERE region_name IN (
                     SELECT region_name FROM selected GROUP BY region_name
                     ORDER BY count(*) DESC,region_name LIMIT :limit)
                 GROUP BY region_id,region_name,domain ORDER BY label,domain"""
        columns = [
            column("label", "Регіон", "text"),
            column("domain", "Галузь", "domain"),
            column("value", "Вакансій"),
        ]
        note += f" Показано до {limit} регіонів із найбільшим наймом, усі їхні галузі."
    elif view == "scatter":
        sql = f"""SELECT card_id AS id, company_name AS label,
                  count(*) AS value, {metrics} FROM selected
                  GROUP BY card_id,company_name ORDER BY value DESC,label LIMIT :limit"""
        columns = [
            column("label", "Підприємство", "company"),
            column("value", "Вакансій"),
            column("median_salary", "Медіана, ₽", "money"),
            column("salary_samples", "Вибірка зарплат"),
            column("recent_30d", "Опубліковано за 30 днів"),
        ]
        note += f" Топ-{limit}. Розмір кола — публікації за 30 днів, а не ріст найму."
        note += " Підприємства без зарплат залишено в таблиці, але не на графіку."
    elif view == "histogram":
        params["bin_width"] = max(20000, math.ceil((stats["max_salary"] or 0) / 12 / 10000) * 10000)
        sql = """SELECT floor(monthly_salary / :bin_width)::int AS id,
                    (floor(monthly_salary / :bin_width) * :bin_width) AS lower,
                    ((floor(monthly_salary / :bin_width) + 1) * :bin_width) AS upper,
                    count(*) AS value, count(*) AS vacancies, count(*) AS salary_samples
                 FROM selected WHERE monthly_salary IS NOT NULL
                 GROUP BY 1,2,3 ORDER BY id"""
        columns = [column("label", "Діапазон, ₽", "text"), column("value", "Вакансій")]
        note += " Діапазони [від; до). Медіана розрахована в БД."
    elif view == "professions":
        kind = "table"
        sql = f"""SELECT title AS id, title AS label, domain, count(*) AS value, {metrics},
            ARRAY(SELECT count(t.vacancy_id) FROM generate_series(
                date_trunc('month', {AS_OF}) - interval '5 months',
                date_trunc('month', {AS_OF}), interval '1 month') AS m(month)
                LEFT JOIN selected t ON t.title = s.title AND t.domain = s.domain
                   AND date_trunc('month', t.published_at) = m.month
                GROUP BY m.month ORDER BY m.month) AS trend
            FROM selected s GROUP BY title,domain
            ORDER BY value DESC,label,domain LIMIT :limit"""
        columns = [
            column("label", "Професія", "text"),
            column("domain", "Галузь", "domain"),
            column("value", "Вакансій"),
            column("median_salary", "Медіана, ₽", "money"),
            column("salary_samples", "Вибірка зарплат"),
            column("recent_30d", "Публікацій за 30 днів"),
            column("trend", "Публікації, 6 міс.", "spark"),
        ]
        note += " Мініграфіки — місяці публікації активних вакансій; історичний ріст невідомий."
    elif view == "signals":
        q = stats["quartiles"] or [None, None, None]
        params["salary_fence"] = (q[2] + 1.5 * (q[2] - q[0])) if q[2] is not None else None
        params["total"] = stats["vacancies"]
        sql = f"""SELECT card_id AS id, company_name AS label, count(*) AS value, {metrics},
                  count(*)::float / nullif(:total,0) * 100 AS share,
                  count(*) FILTER (WHERE monthly_salary > :salary_fence) AS outlier_salaries
                  FROM selected GROUP BY card_id,company_name
                  HAVING (count(*) >= 5 AND count(*)::float / nullif(:total,0) >= 0.5)
                     OR count(*) FILTER (WHERE monthly_salary > :salary_fence) > 0
                  ORDER BY value DESC,label LIMIT :limit"""
        columns = [
            column("label", "Підприємство", "company"),
            column("share", "Частка, %", "percent"),
            column("value", "Вакансій"),
            column("outlier_salaries", "Високих зарплат"),
        ]
        note += " Правила: ≥50% вибірки та ≥5 вакансій; зарплата вище Q3 + 1,5×IQR."
        note += " Це статистичні сигнали поточного зрізу, не підтверджений ріст чи нова діяльність."
    elif view != "kpi":
        raise ValueError("Unsupported analytics view")

    if view == "kpi":
        q = stats["quartiles"] or [None, None, None]
        rows = [
            {
                "id": key,
                "label": label,
                "value": value,
                "unit": unit,
                "vacancies": stats["vacancies"],
                "salary_samples": stats["salary_samples"],
            }
            for key, label, value, unit in [
                ("vacancies", "Активних вакансій", stats["vacancies"], "вакансій"),
                ("employers", "Підприємств", stats["employers"], "підприємств"),
                ("regions", "Регіонів найму", stats["regions"], "регіонів"),
                ("salary", "Медіана зарплати", q[1], "₽/місяць"),
            ]
        ]
        columns = [
            column("label", "Показник", "text"),
            column("value", "Значення"),
            column("unit", "Одиниця", "text"),
        ]
    else:
        rows = [
            dict(r) for r in (await session.execute(text(f"WITH {cte} {sql}"), params)).mappings()
        ]
    if view == "line":
        rows.reverse()
    if view == "donut":
        for row in rows:
            row["share"] = 100 * row["value"] / stats["vacancies"] if stats["vacancies"] else 0
        columns.append(column("share", "Частка, %", "percent"))
        if len(rows) > 7:
            kind = "bar"
            note += " Галузей більше семи: замість кільця показано стовпці, без втрати часток."
    if view == "histogram":
        for row in rows:
            row["label"] = f"{row['lower']:,.0f}–{row['upper']:,.0f}".replace(",", " ")
    return {
        "kind": kind,
        "title": TITLES[view],
        "rows": rows,
        "columns": columns,
        "domain_labels": DOMAIN_LABELS,
        "unit": "RUB/місяць" if view == "bar" else "вакансій",
        "stats": stats,
        "as_of": as_of,
        "note": note,
    }
