import asyncio
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.pool import NullPool

from app.api import agent
from app.api.agent import ChatIn, Context, Run, ToolArgs
from app.config import settings
from app.db import make_engine
from app.repository.agent_charts import TITLES


def test_all_analytics_views_use_the_same_deduplicated_database_snapshot(client, monkeypatch):
    async def scenario():
        engine = make_engine(settings.database_url, poolclass=NullPool)
        try:
            async with AsyncSession(engine) as session:
                run = Run(session, Context(days=0))
                overview = await run.tool("overview", {})
                assert overview["as_of"]
                assert "source_id" not in overview
                assert run.sources == {}
                results = {view: await run.tool("analytics", {"view": view}) for view in TITLES}
                for view, result in results.items():
                    assert result["stats"]["vacancies"] == 6, view
                    assert result["stats"]["salary_samples"] == 3, view
                    assert result["stats"]["quartiles"] == [67500, 75000, 92500], view
                    assert result["stats"]["confirmed"] == 4, view
                    assert result["stats"]["likely"] == 2, view
                    assert result["scope"]["active_only"] is True
                    ids = result["artifact_ids"]
                    if result["kind"] != "table":
                        assert len(ids) == 2
                        assert run.artifacts[ids[0]]["rows"] == run.artifacts[ids[1]]["rows"]
                        assert run.artifacts[ids[1]]["kind"] == "table"
                for view in ("donut", "line", "stacked", "heatmap", "histogram", "professions"):
                    expected = 3 if view == "histogram" else 6
                    assert sum(row["value"] for row in results[view]["rows"]) == expected
                shares = {r["id"]: r["value"] for r in results["donut"]["rows"]}
                assert shares == {"missiles_space": 5, "uav": 1}
                assert sum(row["share"] for row in results["donut"]["rows"]) == pytest.approx(100)
                salaries = {r["id"]: r["value"] for r in results["bar"]["rows"]}
                assert salaries == {"uav": 110000, "missiles_space": 67500}
                companies = {r["id"]: r for r in results["scatter"]["rows"]}
                assert set(companies) == {1, 2, 6}
                assert companies[1]["value"] == 4  # includes profile 5, excludes duplicate 9
                assert companies[6]["median_salary"] is None
                assert all(r["source_id"] in run.sources for r in companies.values())
                turner = next(r for r in results["professions"]["rows"] if r["label"] == "Токарь")
                assert turner["trend"] == [0, 0, 0, 0, 1, 1]
                assert turner["recent_30d"] == 2
                assert results["signals"]["rows"] == []
                assert {r["id"]: r["value"] for r in results["kpi"]["rows"]} == {
                    "vacancies": 6,
                    "employers": 3,
                    "regions": 1,
                    "salary": 75000,
                }
                # Finish can select the whole dashboard and retain chart evidence even
                # when the model only cites the platform source in its text.
                monkeypatch.setattr(agent, "Run", lambda session, context: run)
                monkeypatch.setattr(
                    agent,
                    "post_json",
                    AsyncMock(
                        return_value={
                            "candidates": [
                                {
                                    "content": {
                                        "role": "model",
                                        "parts": [
                                            {
                                                "functionCall": {
                                                    "name": "finish",
                                                    "args": {
                                                        "text": "## Найм\n\n6 вакансій [s1].",
                                                        "artifact_ids": list(run.artifacts),
                                                    },
                                                },
                                            }
                                        ],
                                    }
                                }
                            ],
                        }
                    ),
                )
                answer = await agent.answer(ChatIn(message="Уся аналітика"), session)
                assert len(answer["artifacts"]) == 19
                assert len(answer["sources"]) == 4  # platform and three company cards
                assert answer["sources"][0]["url"] == "/vacancies"
                assert all(source["title"] != "Огляд платформи" for source in answer["sources"])
                assert "## Найм" in answer["text"]
        finally:
            await engine.dispose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "args, count",
    [
        ({"days": 30}, 5),
        ({"region_id": 64}, 4),
        ({"category": "НИИ/КБ"}, 1),
        ({"employer_ids": [1]}, 4),
        ({"only_sanctioned": True}, 5),
        ({"query": "7105514574"}, 5),
        ({"query": "' OR true --"}, 0),
    ],
)
def test_every_view_applies_filters_and_handles_missing_data(client, args, count):
    async def scenario():
        engine = make_engine(settings.database_url, poolclass=NullPool)
        try:
            async with AsyncSession(engine) as session:
                run = Run(session, Context(days=0))
                for view in TITLES:
                    result = await run.tool("analytics", {"view": view, **args})
                    assert result["stats"]["vacancies"] == count, view
                    if not count:
                        assert result["stats"]["quartiles"] is None
                        assert not result["rows"] or view == "kpi"
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_analytics_rejects_arbitrary_view():
    with pytest.raises(ValidationError):
        ToolArgs.model_validate({"view": "DROP TABLE vacancy"})
