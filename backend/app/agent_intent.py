"""Conservative plans for explicit rankings; metrics never come from embeddings."""

import re
from dataclasses import dataclass

from app.search import fold


@dataclass(frozen=True)
class AnalyticsPlan:
    group_by: str
    metric: str
    limit: int
    global_scope: bool
    city: str | None = None

    def arguments(self, region_id=None, days=None):
        args = {
            "group_by": self.group_by,
            "metric": self.metric,
            "limit": self.limit,
            "view": "auto",
            "query": "",
        }
        if self.global_scope:
            args.update(category="", region_id=region_id or 0)
        if days is not None:
            args["days"] = days
        return args


def question_days(question: str, default: int) -> int:
    value = fold(question)
    if re.search(r"весь пер[іи]од|все время|увесь.*пер[іи]од", value):
        return 0
    match = re.search(r"(?:останн[іи]|последн[иеых]+)\s+(\d{1,4})\s+(?:дн|ден)", value)
    return min(int(match[1]), 3650) if match else default


def analytics_plan(question: str) -> AnalyticsPlan | None:
    value = fold(question)
    top = re.search(r"\b(?:топ|top)\s*[-:]?\s*(\d{1,2})\b", value)
    salary = bool(re.search(r"зарп|\bзп\b|salary", value))
    vacancies = bool(re.search(r"ваканс|vacanc", value))
    if top and (salary or vacancies):
        city = None
        if re.search(r"москв", value) and not re.search(r"област|обл\.", value):
            city = "Москва"
        elif re.search(r"санкт.?петербур|\bспб\b", value):
            city = "Санкт-Петербург"
        elif re.search(r"казан", value):
            city = "Казань"
        local_scope = bool(re.search(r"вибран|выбран|видим|на карт|ц[іи]й виб[іи]р|тут", value))
        explicit_global = bool(re.search(r"вс[іи]й баз|ус[іи]й баз|вс[іи]й кра", value))
        return AnalyticsPlan(
            "company",
            "median_salary" if salary else "vacancies",
            min(int(top[1]), 30),
            explicit_global or not local_scope or bool(city),
            city,
        )
    if vacancies and re.search(r"ск[іи]льки|сколько|загальн.*к[іи]льк|всього", value):
        return AnalyticsPlan(
            "summary",
            "vacancies",
            1,
            bool(re.search(r"вс[іи]й баз|вс[іи]й кра[іи]|ус[іи]й баз", value)),
        )
    return None


def needs_ranking_criterion(question: str) -> bool:
    value = fold(question)
    return bool(
        re.search(r"\b(?:топ|top)\b", value)
        and re.search(r"вироб|производ|manufacturer", value)
        and not re.search(r"зарп|\bзп\b|ваканс|обсяг|объем|вируч|выруч|дох[іи]д", value)
    )


def partial_name_candidates(question: str, rows: list[dict]) -> list[dict]:
    words = set(re.findall(r"\w+", fold(question)))
    result = []
    for row in rows:
        name = fold(row["name"]).split(".")[0]
        # Only a distinctive leading token; city mentions inside names do not
        # identify an employer. This produces candidates, never an automatic ID.
        tokens = re.findall(r"\w+", name)
        if not tokens:
            continue
        first = tokens[0]
        if len(first) >= 4 and first not in {"завод", "концерн", "компания", "компанія"}:
            if first in words:
                result.append({"id": row["id"], "name": row["name"]})
    return result


def region_for_city(city: str, regions: list[dict]) -> int | None:
    needle = fold(city)
    matches = [r["region_id"] for r in regions if fold(r["name"]).removeprefix("г. ") == needle]
    return matches[0] if len(matches) == 1 else None
