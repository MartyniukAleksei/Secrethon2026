import asyncio
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.agent_scope import Bounds, MapFilters, MapScope, matches_card, scope_ids
from app.api import agent
from app.repository.vacancies import VacancyFilter


def card(ident, name, gur_id=None):
    return {
        "id": ident,
        "name": name,
        "source": "hh",
        "inn": None,
        "ogrn": None,
        "kpp": None,
        "profile_url": None,
        "vpk_vacancies": 1,
        "confirmed_vacancies": 1,
        "on_review_vacancies": 0,
        "agency_vacancies": 0,
        "total_vacancies": 1,
        "new_30d": 0,
        "median_salary": None,
        "category": None,
        "locality": None,
        "region_id": None,
        "region": None,
        "last_published_at": None,
        "gur_company_id": gur_id,
        "gur_name": None,
        "sanctions_count": 0,
        "human_review": None,
    }


def test_viewport_rejects_invalid_or_missing_coordinates():
    for bounds in (
        {"west": -181, "east": 2, "south": 0, "north": 3},
        {"west": 1, "east": 2, "south": 4, "north": 3},
        {"west": float("nan"), "east": 2, "south": 0, "north": 3},
    ):
        with pytest.raises(ValidationError):
            Bounds.model_validate(bounds)
    with pytest.raises(ValidationError):
        MapScope(mode="viewport")
    with pytest.raises(ValidationError):
        MapScope(mode="selection", employer_ids=[])


def test_empty_scopes_and_antimeridian_are_parameterized():
    where, params = VacancyFilter(employer_ids=[], bounds=(170, -10, -170, 10), scope="all").where()
    assert params["scope_ids"] == []
    assert "v.card_id = ANY(:scope_ids)" in where
    assert "(v.lng >= :west OR v.lng <= :east)" in where
    assert params["west"] == 170 and params["east"] == -170
    assert "170" not in where


def test_card_filters_follow_human_review_and_unclassified_focus():
    card = {
        "id": 1,
        "region_id": None,
        "focus": [],
        "category": "производство",
        "classification": {"direction_domain": "uav", "sanctions_gur": ["US"]},
        "human_review": {"sanctions": "not_sanctioned"},
    }
    assert matches_card(card, MapFilters(region=["none"], focus=["other"], domain=["uav"]), {})
    assert not matches_card(card, MapFilters(sanctioned=True), {})
    assert not matches_card(card, MapFilters(hidden_categories=["производство"]), {})
    assert not matches_card(card, MapFilters(focus=["drone"]), {})
    card["name"] = "АО «Калашников»"
    assert matches_card(card, MapFilters(search="Калашніков"), {})
    assert matches_card(card, MapFilters(search="Kalashnikov"), {})


def test_scope_selection_cannot_invent_ids_and_network_walk_is_finite():
    cards = [
        {"id": 1, "gur_company_id": 10},
        {"id": 2, "gur_company_id": 20},
        {"id": 3, "gur_company_id": 30},
        {"id": 4, "gur_company_id": None},
    ]
    network = {
        "company_tags": [],
        "relations": [
            {"company_id": a, "related_id": b, "kind": "supplier"}
            for a, b in [(10, 20), (20, 30), (30, 10)]
        ],
    }
    assert scope_ids(cards, MapScope(mode="selection", employer_ids=[2, 999]), network) == [2]
    selected = MapScope(
        mode="filters", filters=MapFilters(network_company_id=1, network_kinds=["supplier"])
    )
    assert scope_ids(cards, selected, network) == [1, 2, 3]
    selected.filters.network_company_id = 4
    assert scope_ids(cards, selected, network) == [4]


def test_scoped_filters_use_server_ids_and_keep_local_geography(monkeypatch):
    async def scenario():
        monkeypatch.setattr(agent.employers, "list_employers", AsyncMock(return_value=[{"id": 42}]))
        monkeypatch.setattr(
            agent.queries,
            "scope_summary",
            AsyncMock(return_value={"employers": 1, "vacancies": 3, "as_of": "2026-10-09"}),
        )
        run = agent.Run(
            None,
            agent.Context(
                days=90,
                map_scope=MapScope(
                    mode="viewport", bounds=Bounds(west=1, east=2, south=3, north=4)
                ),
            ),
        )
        await run.prepare_scope()
        filters = run.filters(agent.ToolArgs())
        assert filters.employer_ids == [42]
        assert filters.bounds == (1, 3, 2, 4)
        assert filters.days == 90 and filters.scope == "all"
        assert run.scope_totals == {"employers": 1, "vacancies": 3}
        assert run.as_of == "2026-10-09"
        chart = {
            "kind": "donut",
            "title": "Industries",
            "rows": [],
            "as_of": "2026-10-09",
        }
        visualization = AsyncMock(return_value=chart)
        monkeypatch.setattr(agent.agent_charts, "visualization", visualization)
        result = await run.tool("analytics", {"view": "donut"})
        chart_filters = visualization.call_args.args[1]
        assert chart_filters.employer_ids == [42]
        assert chart_filters.bounds == (1, 3, 2, 4)
        assert chart_filters.days == 90 and chart_filters.scope == "all"
        assert result["scope"]["map_scope"]["mode"] == "viewport"
        assert result["scope"]["totals"] == run.scope_totals
        assert len(result["artifact_ids"]) == 2

    asyncio.run(scenario())


def test_origin_mismatch_is_rejected_before_answer_is_returned(monkeypatch):
    from test_agent import response

    async def scenario():
        async def data(run, name, raw):
            run.source("Матеріал", "https://example.com/news", origin="public_web", excerpt="Заява")
            return {"items": []}

        monkeypatch.setattr(agent.Run, "tool", data)
        provider = AsyncMock(
            side_effect=[
                response("search_mentions", {"employer_id": 1}),
                response(
                    "finish",
                    {
                        "text": "Факт [s1]",
                        "sections": [
                            {"kind": "database", "text": "Факт [s1]", "source_ids": ["s1"]}
                        ],
                    },
                ),
                response(
                    "finish",
                    {
                        "text": "Заява джерела [s1]",
                        "sections": [
                            {
                                "kind": "public_web",
                                "text": "Заява джерела [s1]",
                                "source_ids": ["s1"],
                            }
                        ],
                    },
                ),
            ]
        )
        monkeypatch.setattr(agent, "post_json", provider)
        result = await agent.answer(
            agent.ChatIn(message="Знайди згадки", web_access="allowed"), None
        )
        assert provider.await_count == 3
        assert result["sections"][0]["kind"] == "public_web"
        assert result["sources"][0]["verification"] == "unverified"
        assert result["sources"][0]["excerpt"] == "Заява"
        assert result["evidence"][0]["tool"] == "search_mentions"

    asyncio.run(scenario())


def test_identity_search_handles_ukrainian_and_description_associations(monkeypatch):
    async def scenario():
        monkeypatch.setattr(
            agent.employers,
            "list_employers",
            AsyncMock(
                return_value=[
                    card(41, "Алабуга. Эксплуатация объектов", 10),
                    card(42, "Алабуга Девелопмент", 20),
                    card(43, "Калашников"),
                ]
            ),
        )
        descriptions = AsyncMock(
            return_value={
                10: "На території ОЕЗ діє освітній заклад «Алабуга Политех».",
                20: "Будівельна компанія Алабуга Девелопмент.",
            }
        )
        monkeypatch.setattr(agent.queries, "company_descriptions", descriptions)
        run = agent.Run(None, agent.Context())
        for query in ["Калашніков", "Kalashnikov"]:
            result = await run.tool("search_employers", {"query": query})
            assert [r["id"] for r in result["candidates"]] == [43]
        result = await run.tool("search_employers", {"query": "Алабуга політех"})
        assert [r["id"] for r in result["candidates"]] == [41]
        assert "association" in result["candidates"][0]["matched_in"]
        assert "Политех" in result["candidates"][0]["matching_excerpt"]
        assert descriptions.call_args.args[1] == [10, 20]
        assert run.map_action is None
        result = await run.tool("search_employers", {"query": "Алабуга"})
        assert result["total_matches"] == 2 and run.map_action is None
        result = await run.tool("search_employers", {"query": "Алабуга невідома"})
        assert result["total_matches"] == 2 and result["partial_match"] is True

    asyncio.run(scenario())


def test_map_navigation_rejects_unverified_ids_and_missing_coordinates(monkeypatch):
    async def scenario():
        points = AsyncMock(return_value=[])
        monkeypatch.setattr(agent.employers, "map_points", points)
        run = agent.Run(None, agent.Context(page="map"))
        assert "error" in await run.tool("show_on_map", {"employer_id": 999})
        assert points.await_count == 0 and run.map_action is None
        run.profiles[41] = {"id": 41, "name": "Алабуга"}
        assert "error" in await run.tool("show_on_map", {"employer_id": 41})
        assert run.map_action is None
        points.return_value = [{"employer_id": 41, "lat": 55.8, "lng": 52.1}]
        # Another company may be the last profile inspected; the requested root must win.
        run.profile_id = 99
        run.profiles[99] = {"id": 99, "name": "Інша компанія"}
        result = await run.tool(
            "show_on_map",
            {
                "employer_id": 41,
                "map_mode": "show_relations",
            },
        )
        assert result["map_action"] == {"kind": "show_relations", "employer_id": 41}
        assert result["hiring_places"] == 1
        with pytest.raises(ValidationError):
            await run.tool("show_on_map", {"employer_id": 41, "map_mode": "open_url"})

    asyncio.run(scenario())


def test_map_action_supports_registry_only_coordinates_and_rejects_coarse_sites(monkeypatch):
    async def scenario():
        monkeypatch.setattr(agent.employers, "map_points", AsyncMock(return_value=[]))
        run = agent.Run(None, agent.Context(page="map"))
        run.profiles[41] = {
            "id": 41,
            "name": "Адреса з реєстру",
            "sites": [{"lat": 55.8, "lng": 52.1, "geo_qc": 1}],
        }
        result = await run.tool("show_on_map", {"employer_id": 41})
        assert result["map_action"] == {"kind": "focus_company", "employer_id": 41}
        assert result["hiring_places"] == 0 and result["registry_sites"] == 1
        run.profiles[41]["sites"][0]["geo_qc"] = 5
        run.map_action = None
        result = await run.tool("show_on_map", {"employer_id": 41})
        assert "error" in result and run.map_action is None

    asyncio.run(scenario())


def test_tool_loop_returns_verified_map_command(monkeypatch):
    from test_agent import response

    async def scenario():
        original = agent.Run.tool

        async def tools(run, name, raw):
            if name == "company_profile":
                run.profiles[41] = {"id": 41, "name": "Алабуга"}
                run.profile_id = 99  # An unrelated profile was also inspected during this answer.
                run.source("Алабуга", "/companies/41")
                return {"profile": run.profiles[41]}
            return await original(run, name, raw)

        monkeypatch.setattr(agent.Run, "tool", tools)
        monkeypatch.setattr(
            agent.employers,
            "map_points",
            AsyncMock(
                return_value=[
                    {"employer_id": 41, "lat": 55.8, "lng": 52.1},
                ]
            ),
        )
        monkeypatch.setattr(
            agent,
            "post_json",
            AsyncMock(
                side_effect=[
                    response("company_profile", {"employer_id": 41}),
                    response("show_on_map", {"employer_id": 41, "map_mode": "focus_company"}),
                    response(
                        "finish",
                        {
                            "text": "Алабуга [s1]",
                            "sections": [
                                {"kind": "database", "text": "Алабуга [s1]", "source_ids": ["s1"]},
                            ],
                        },
                    ),
                ]
            ),
        )
        result = await agent.answer(
            agent.ChatIn(message="Покажи Алабугу", context=agent.Context(page="map")), None
        )
        assert result["map_action"] == {"kind": "focus_company", "employer_id": 41}
        assert {"kind": "show_relations", "employer_id": 41} in result["actions"]
        assert result["evidence"][1]["tool"] == "show_on_map"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("page", "referenced", "has_coordinates", "expected"),
    [
        ("map", [41], True, {"kind": "focus_company", "employer_id": 41}),
        ("map", [41, 99], True, None),
        ("map", [], True, None),
        ("map", [41], False, None),
        ("other", [41], True, None),
    ],
)
def test_named_company_focuses_map_when_model_omits_command(
    monkeypatch, page, referenced, has_coordinates, expected
):
    from test_agent import response

    async def scenario():
        original = agent.Run.tool

        async def tools(run, name, raw):
            if name == "company_profile":
                # The currently selected company and last inspected profile differ
                # from the company cited in the answer.
                run.profiles = {41: {"id": 41, "name": "Алабуга"}, 99: {"id": 99, "name": "Інша"}}
                run.profile_id = 99
                for ident, profile in run.profiles.items():
                    run.source(profile["name"], f"/companies/{ident}")
                return {"profile": run.profiles[41]}
            return await original(run, name, raw)

        monkeypatch.setattr(agent.Run, "tool", tools)
        points = AsyncMock(
            return_value=[{"employer_id": 41, "lat": 55.8, "lng": 52.1}] if has_coordinates else []
        )
        monkeypatch.setattr(agent.employers, "map_points", points)
        refs = ["s1" if ident == 41 else "s2" for ident in referenced]
        monkeypatch.setattr(
            agent,
            "post_json",
            AsyncMock(
                side_effect=[
                    response("company_profile", {"employer_id": 41}),
                    response(
                        "finish",
                        {
                            "text": "Відповідь про підприємство",
                            "sections": [
                                {
                                    "kind": "database" if refs else "analysis",
                                    "text": "Відповідь про підприємство",
                                    "source_ids": refs,
                                }
                            ],
                        },
                    ),
                ]
            ),
        )
        result = await agent.answer(
            agent.ChatIn(
                message="Розкажи про Алабугу", context=agent.Context(page=page, company_id=99)
            ),
            None,
        )
        assert result["map_action"] == expected
        if expected:
            assert result["evidence"][-1]["arguments"] == {
                "employer_id": 41,
                "map_mode": "focus_company",
            }
        if page == "other" or len(referenced) != 1:
            points.assert_not_awaited()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "question",
    [
        "Покажи зв'язки Алабуги",
        "Покажи зв’язки Алабуги",
        "покажи звязки алабуги",
        "Покажи связи Алабуги",
        "Покажи постачальників Алабуги",
        "Покажи її холдинг",
    ],
)
def test_relation_requests_select_network_mode(question):
    assert agent.requests_relation_map(
        agent.ChatIn(message=question, context=agent.Context(page="map"))
    )


@pytest.mark.parametrize(
    "question",
    [
        "Покажи розташування Алабуги",
        "Не показуй зв'язки, покажи її розташування",
        "Покажи Алабугу без зв'язків",
    ],
)
def test_location_requests_do_not_force_network(question):
    assert not agent.requests_relation_map(
        agent.ChatIn(message=question, context=agent.Context(page="map"))
    )


def test_related_network_scope_contains_root_neighbours_without_expanding_unrelated_chains():
    cards = [card(1, "Корінь", 10), card(2, "Пов'язана", 20), card(3, "Її сусід", 30)]
    scope = MapScope(
        mode="filters", filters=MapFilters(network_company_id=1, network_kinds=["related"])
    )
    network = {
        "relations": [
            {"company_id": 10, "related_id": 20, "kind": "related"},
            {"company_id": 20, "related_id": 30, "kind": "related"},
        ],
        "company_tags": [],
    }
    assert scope_ids(cards, scope, network) == [1, 2]


def test_relation_intent_uses_current_question_and_explicit_map_request():
    assert not agent.requests_relation_map(agent.ChatIn(message="Поясни зв'язки Алабуги"))
    assert agent.requests_relation_map(agent.ChatIn(message="Покажи зв'язки Алабуги на карті"))
    assert not agent.requests_relation_map(
        agent.ChatIn(
            message="Покажи її розташування",
            context=agent.Context(page="map"),
            history=[agent.History(role="user", text="Покажи зв'язки Алабуги")],
        )
    )


@pytest.mark.parametrize("model_calls_map", [True, False])
def test_relation_request_repairs_location_mode_or_uses_selected_diagram_root(
    monkeypatch, model_calls_map
):
    from test_agent import response

    async def scenario():
        original = agent.Run.tool

        async def tools(run, name, raw):
            if name == "company_profile":
                run.profiles[41] = {"id": 41, "name": "Алабуга"}
                run.profiles[99] = {"id": 99, "name": "Інша компанія"}
                run.profile_id = 99
                run.source("Алабуга", "/companies/41")
                run.artifact(
                    {"kind": "relations", "employer_id": 41, "company": "Алабуга", "items": []}
                )
                return {"profile": run.profiles[41], "artifact_ids": ["a1"]}
            return await original(run, name, raw)

        monkeypatch.setattr(agent.Run, "tool", tools)
        monkeypatch.setattr(
            agent.employers,
            "map_points",
            AsyncMock(return_value=[{"employer_id": 41, "lat": 55.8, "lng": 52.1}]),
        )
        replies = [response("company_profile", {"employer_id": 41})]
        if model_calls_map:
            replies.extend(
                [
                    response("show_on_map", {"employer_id": 41, "map_mode": "focus_company"}),
                    response("show_on_map", {"employer_id": 41}),
                ]
            )
        replies.append(
            response(
                "finish",
                {
                    "text": "Зв'язки Алабуги [s1]",
                    "artifact_ids": ["a1"],
                    "sections": [
                        {"kind": "database", "text": "Зв'язки Алабуги [s1]", "source_ids": ["s1"]}
                    ],
                },
            )
        )
        provider = AsyncMock(side_effect=replies)
        monkeypatch.setattr(agent, "post_json", provider)
        result = await agent.answer(
            agent.ChatIn(
                message="Покажи звязки алабуги", context=agent.Context(page="map", company_id=99)
            ),
            None,
        )
        assert result["map_action"] == {"kind": "show_relations", "employer_id": 41}
        assert {"kind": "show_relations", "employer_id": 41} in result["actions"]
        assert result["evidence"][-1]["result"]["map_action"]["kind"] == "show_relations"

    asyncio.run(scenario())
