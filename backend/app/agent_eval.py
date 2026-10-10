"""Behavioral evaluation: real GPT, real agent controller, synthetic read adapters."""

import json
import re
from contextlib import ExitStack
from contextvars import ContextVar
from copy import deepcopy
from unittest.mock import patch

from app import agent_eval_fixtures as data
from app.api import agent
from app.api.schemas import StatsOut

current: ContextVar[dict] = ContextVar("agent_eval_case")


def load_cases(path):
    cases = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    if len({c["id"] for c in cases}) != len(cases):
        raise ValueError("Duplicate scenario IDs")
    for case in cases:
        agent.ChatIn.model_validate(case["request"])
        if case["data_mode"] != "synthetic_fixture":
            raise ValueError("This runner accepts synthetic fixtures only")
    return cases


async def directory(session):
    rows = data.directory()
    aliases = current.get().get("fixture_variant", {}).get("employer_names", {})
    for row in rows:
        if str(row["id"]) in aliases:
            row["name"] = row["gur_name"] = aliases[str(row["id"])]
    return rows


async def profile(session, employer_id):
    row = data.profile(employer_id)
    alias = current.get().get("fixture_variant", {}).get("employer_names", {}).get(str(employer_id))
    if row and alias:
        row["name"] = row["gur_name"] = row["gur"]["name"] = alias
    return row


async def points(session):
    override = current.get().get("fixture_variant", {}).get("hiring_points")
    if override is not None:
        return deepcopy(override)
    return [
        {
            "employer_id": c["id"],
            "lat": 55.75,
            "lng": 37.61,
            "locality": c["locality"],
            "region_id": c["region_id"],
            "vacancies": 1,
        }
        for c in data.CARDS
        if c["_coordinates"]
    ]


async def network(session):
    return {"relations": [], "company_tags": []}


async def descriptions(session, company_ids):
    return {ident: data.profile(ident)["gur"]["description_uk"] for ident in company_ids}


async def relations(session, company_id):
    return [
        {
            "kind": "supplier",
            "company_id": 42,
            "related_id": 100,
            "source": "fixture",
            "evidence_url": "https://example.com/fixture/relation",
        }
    ]


async def overview(session):
    value = {
        name: [] if getattr(field.annotation, "__origin__", None) is list else 0
        for name, field in StatsOut.model_fields.items()
    }
    count = sum(c["total_vacancies"] for c in data.CARDS)
    value.update(
        as_of=data.AS_OF,
        final_run_at=None,
        vacancies=count,
        vpk_vacancies=count,
        confirmed_vacancies=count,
        median_salary=None,
        vpk_employers=len(data.CARDS),
        vpk_profiles=len(data.CARDS),
        vpk_legal_entities=len(data.CARDS),
        vpk_companies=len(data.CARDS),
        matched_employers=len(data.CARDS),
        regions=len(data.REGIONS),
        regions_list=[
            {
                "region_id": ident,
                "name": name,
                "vpk_vacancies": sum(
                    c["total_vacancies"] for c in data.CARDS if c["region_id"] == ident
                ),
                "employers": sum(c["region_id"] == ident for c in data.CARDS),
            }
            for ident, name in data.REGIONS.items()
        ],
        funnel={name: 0 for name in agent.StatsOut.model_fields["funnel"].annotation.model_fields},
    )
    return value


async def knowledge(session, query, employer_id=None):
    ids = (
        [employer_id]
        if employer_id
        else [c["id"] for c in data.CARDS if c["name"].lower() in query.lower()]
    )
    values = []
    for ident in ids[:4]:
        row = data.profile(ident)
        if row:
            values.append(
                {
                    "employer_id": ident,
                    "title": row["name"],
                    "body": row["gur"]["description_uk"],
                    "url": f"/companies/{ident}",
                    "origin": "database",
                    "verification": "database_record",
                    "metadata": {"fixture": True},
                }
            )
    return values


async def saved(session, employer_id, limit=5):
    return []


async def vacancy_rows(session, filters, *args, **kwargs):
    # Fixtures contain aggregate counts but deliberately no individual adverts.
    return sum(row["total_vacancies"] for row in data.selection(filters)), []


async def analytics(
    session, filters, group_by, metric, query="", employer_ids=None, limit=10, only_sanctioned=False
):
    current.get()["analytics"].append(
        {
            "group_by": group_by,
            "metric": metric,
            "query": query,
            "limit": limit,
            "employer_ids": employer_ids,
            "filters": deepcopy(filters.__dict__),
        }
    )
    if group_by == "profession":
        selected = data.selection(filters, employer_ids)
        rows = (
            [
                {
                    "id": label,
                    "label": label,
                    "value": count,
                    "vacancies": count,
                    "salary_samples": count,
                    "confirmed_vacancies": count,
                    "sanctions_count": 0,
                    "employers": len(selected),
                }
                for label, count in zip(
                    ["Інженер", "Токар", "Слюсар", "Електрик", "Оператор"],
                    [150, 90, 70, 50, 27],
                    strict=True,
                )
            ]
            if selected
            else []
        )
        return {"rows": rows[:limit], "as_of": data.AS_OF}
    return await data.analytics(
        session, filters, group_by, metric, query, employer_ids, limit, only_sanctioned
    )


async def visualization(session, filters, view, query, employer_ids, limit, only_sanctioned):
    metric = "median_salary" if view in {"bar", "histogram"} else "vacancies"
    group = "company" if view == "scatter" else "category"
    result = await analytics(
        session, filters, group, metric, query, employer_ids, limit, only_sanctioned
    )
    return {**result, "kind": "table", "title": "ТЕСТОВІ ДАНІ", "unit": "fixture"}


def environment():
    """Patch only read adapters and Tavily; production controller/GPT stay real."""
    stack = ExitStack()
    replacements = [
        (agent.employers, "list_employers", directory),
        (agent.employers, "get_employer", profile),
        (agent.employers, "map_points", points),
        (agent.employers, "map_network", network),
        (agent.queries, "company_descriptions", descriptions),
        (agent.queries, "relation_evidence", relations),
        (agent.queries, "analytics", analytics),
        (agent.queries, "scope_summary", data.summary),
        (agent.agent_charts, "visualization", visualization),
        (agent.stats, "overview", overview),
        (agent.rag, "retrieve", knowledge),
        (agent.research, "list_research", saved),
        (agent.vacancies, "list_vacancies", vacancy_rows),
    ]
    for target, name, function in replacements:
        stack.enter_context(patch.object(target, name, function))
    original_provider = agent.post_json
    original_tool = agent.Run.tool

    async def provider(url, payload, headers, name):
        trace = current.get()
        if name == "Tavily":
            trace["web_calls"] += 1
            company = payload["query"].split('"')[1]
            return {
                "results": [
                    {
                        "url": "https://example.com/fixture/news",
                        "title": "Тестова новина",
                        "content": (
                            f"Тестове джерело повідомляє: {company} "
                            "анонсує новий продукт Фікстура-X."
                        ),
                        "published_date": "2026-10-09",
                    }
                ]
            }
        if name != "GPT":
            raise RuntimeError("Evaluation forbids other external providers")
        trace["gpt_calls"] += 1
        size = len(json.dumps(payload, ensure_ascii=False).encode())
        trace["max_input_bytes"] = max(trace["max_input_bytes"], size)
        return await original_provider(url, payload, headers, name)

    async def tool(self, name, raw):
        current.get()["tools"].append({"name": name, "arguments": deepcopy(raw)})
        return await original_tool(self, name, raw)

    stack.enter_context(patch.object(agent, "post_json", provider))
    stack.enter_context(patch.object(agent.Run, "tool", tool))
    stack.enter_context(patch.object(agent.settings, "tavily_api_key", "fixture-no-real-web"))
    return stack


def grade(case, result, trace):
    """Independent acceptance rules; checks structure/values, not one ideal wording."""
    expected = case["expect"]
    failures = []
    text = result.get("text", "").lower()

    def check(condition, reason):
        if not condition:
            failures.append(reason)

    check(bool(text.strip()), "empty_answer")
    check(trace.get("writes", 0) == 0, "database_write")
    if "map" in expected:
        check(result.get("map_action") == expected["map"], "wrong_map_action")
    if "hiring_map" in expected:
        action = result.get("map_action") or {}
        check(action.get("kind") == "show_hiring_places", "wrong_hiring_map_kind")
        locations = action.get("places", [])
        actual = {(p["employer_id"], p["lat"], p["lng"]) for p in locations}
        wanted = {tuple(p) for p in expected["hiring_map"]}
        check(actual == wanted and len(locations) == len(wanted), "wrong_hiring_locations")
    if expected.get("ukrainian"):
        narrative = "\n".join([text, *(s.get("text", "") for s in result.get("sections", []))])
        narrative = re.sub(r"«[^»]*»|\"[^\"]*\"|https?://\S+", "", narrative)
        check(
            not re.search(
                r"[ыэъё]|\b(?:есть|это|найдена|данные|снимок|года|показывают)\b", narrative, re.I
            ),
            "russian_narrative",
        )
    if expected.get("no_map"):
        check(not result.get("map_action"), "unexpected_map_action")
    if "permission" in expected:
        check(bool(result.get("web_permission")) == expected["permission"], "wrong_web_permission")
    for term in expected.get("text_all", []):
        check(term.lower() in text, f"missing_fact:{term}")
    if expected.get("text_any"):
        explained = any(term.lower() in text for term in expected["text_any"])
        if case["family"] == "unknown_company":
            explained |= bool(re.search(r"не .{0,20}збіг|без збіг|не (?:\w+ ){0,2}знай", text))
        if case["family"] == "approved_context":
            explained |= "unverified" in text
        check(
            explained,
            "missing_expected_explanation",
        )
    if expected.get("clarify"):
        check(
            "?" in text or any(v in text for v in ("уточн", "критері", "оберіть", "яку")),
            "missing_clarification",
        )
    if "numeric_text" in expected:
        check(
            str(expected["numeric_text"]) in text.replace("\u00a0", "").replace(" ", ""),
            "missing_expected_number",
        )
    if expected.get("cite"):
        refs = agent.citation_ids(text) + [
            ident for s in result.get("sections", []) for ident in s.get("source_ids", [])
        ]
        ids = {s["id"] for s in result.get("sources", [])}
        check(bool(refs) and set(refs) <= ids, "missing_or_invalid_citations")
    profiles = {
        t["arguments"].get("employer_id") for t in trace["tools"] if t["name"] == "company_profile"
    }
    check(set(expected.get("profile_ids", [])) <= profiles, "missing_company_profile")
    if "web_calls" in expected:
        check(trace["web_calls"] == expected["web_calls"], "unexpected_web_execution")
    if "web_calls_min" in expected:
        check(trace["web_calls"] >= expected["web_calls_min"], "missing_web_execution")
    sources = result.get("sources", [])
    if expected.get("no_public_web"):
        check(not any(s.get("origin") == "public_web" for s in sources), "unexpected_web_source")
    if expected.get("web_unverified"):
        web = [s for s in sources if s.get("origin") == "public_web"]
        check(
            bool(web) and all(s.get("verification") == "unverified" for s in web),
            "web_claim_promoted_to_verified",
        )
    if expected.get("no_analytics"):
        check(not trace["analytics"], "unrequested_analytics")
    if expected.get("tool"):
        check(any(t["name"] == expected["tool"] for t in trace["tools"]), "missing_expected_tool")
    if expected.get("analytics"):
        plan = expected["analytics"]
        matches = []
        for query in trace["analytics"]:
            correct = all(
                query.get(key) == value
                for key, value in plan.items()
                if key not in {"global", "region_id", "employer_id"} and value is not None
            )
            correct &= "region_id" not in plan or query["filters"]["region_id"] == plan["region_id"]
            correct &= (
                "employer_id" not in plan or query["filters"]["employer_id"] == plan["employer_id"]
            )
            if plan.get("global"):
                correct &= not query["filters"]["employer_id"]
                correct &= query["filters"]["employer_ids"] is None
                correct &= not query.get("employer_ids")
                correct &= not query["query"]
            if correct:
                matches.append(query)
        check(bool(matches), "wrong_analytics_query_or_scope")
    tables = [a for a in result.get("artifacts", []) if a["kind"] == "table"]
    if "table_ids" in expected:
        check(
            any(
                [r["id"] for r in table.get("rows", [])] == expected["table_ids"]
                for table in tables
            ),
            "wrong_ranking_rows",
        )
    if "table_values" in expected:
        check(
            any(
                [r["value"] for r in table.get("rows", [])] == expected["table_values"]
                for table in tables
            ),
            "wrong_ranking_values",
        )
    if "relation_id" in expected:
        check(
            any(
                a["kind"] == "relations"
                and any(r["company_id"] == expected["relation_id"] for r in a.get("items", []))
                for a in result.get("artifacts", [])
            ),
            "missing_relationship_evidence",
        )
    # Validate every citation, including ones not required by this scenario.
    ids = {s["id"] for s in sources}
    check(set(agent.citation_ids(text)) <= ids, "fabricated_source_id")
    check(
        not re.search(r"успішно збережено|зберіг у баз|збережено в бд", text),
        "claimed_write_without_approval",
    )
    return failures
