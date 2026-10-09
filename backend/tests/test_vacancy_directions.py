import asyncio
import copy
import json
from datetime import UTC, datetime
from types import SimpleNamespace

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.pool import NullPool

from app.config import settings
from app.db import make_engine
from app.repository import agent_charts, vacancies
from app.vacancy_labeling import fingerprint, parse_decisions, questions, vacancy_state
from scripts.apply_vacancy_directions import apply, validate_labels
from scripts.export_vpk_inputs import VPK_IDS_SQL


def response(question_set, domain="civil_other", role="services"):
    return {
        "model": "jev-test",
        "answers": {
            dim: {
                "type": "choice",
                "choice": value,
                "confidence": 0.9,
                "probabilities": {
                    key: float(key == value) for key in question_set[dim]["criteria"]
                },
            }
            for dim, value in [("domain", domain), ("role", role)]
        },
    }


def sample():
    rubric = questions(["civil_other", "uav"], ["manufacturer", "services"])
    state = {"title": "HR"}
    key = fingerprint(state, rubric, "jev-test")
    original = {"vacancy_id": 1, "state": state, "fingerprint": key}
    raw = response(rubric)
    result = {
        **original,
        "status": "ok",
        "model": "jev-test",
        "review": False,
        "decisions": parse_decisions(raw, rubric, 0.75),
    }
    manifest = {
        "scope": "all_raw",
        "limit": None,
        "success": 1,
        "errors": 0,
        "database_inventory": {"total": 1},
        "questions": rubric,
        "model_requested": "jev-test",
        "threshold": 0.75,
    }
    return manifest, [original], [result], {key: raw}


@pytest.mark.parametrize(
    "corruption", ["missing", "duplicate", "error", "fingerprint", "label", "review", "limited"]
)
def test_incomplete_or_tampered_labels_cannot_be_published(corruption):
    manifest, inputs, labels, responses = copy.deepcopy(sample())
    if corruption == "missing":
        labels.clear()
    elif corruption == "duplicate":
        labels *= 2
    elif corruption == "error":
        labels[0]["status"] = "error"
    elif corruption == "fingerprint":
        labels[0]["fingerprint"] = "other"
    elif corruption == "label":
        labels[0]["decisions"]["domain"]["choice"] = "uav"
    elif corruption == "review":
        labels[0]["review"] = True
    else:
        manifest["limit"] = 1
    with pytest.raises(ValueError):
        validate_labels(manifest, inputs, labels, responses)


@pytest.mark.parametrize("scope", ["all_raw", "vpk_active_unique"])
def test_complete_run_is_published_once_and_drives_charts_and_filters(client, tmp_path, scope):
    async def scenario():
        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        )
        engine = make_engine(settings.database_url, poolclass=NullPool)
        run_id = None
        try:
            total_inventory = await conn.fetchval("SELECT count(*) FROM vacancy")
            raw_inputs = await conn.fetch("SELECT * FROM vacancy ORDER BY vacancy_id")
            if scope == "vpk_active_unique":
                eligible = {row["vacancy_id"] for row in await conn.fetch(VPK_IDS_SQL)}
                raw_inputs = [row for row in raw_inputs if row["vacancy_id"] in eligible]
            rubric = questions(["civil_other", "uav"], ["manufacturer", "services"])
            inputs, labels, cached = [], [], {}
            for vacancy in raw_inputs:
                state, _ = vacancy_state(dict(vacancy))
                key = fingerprint(state, rubric, "jev-test")
                original = {"vacancy_id": vacancy["vacancy_id"], "state": state, "fingerprint": key}
                raw = response(
                    rubric, domain="none" if vacancy["vacancy_id"] == 4 else "civil_other"
                )
                cached[key] = raw
                decisions = parse_decisions(raw, rubric, 0.75)
                inputs.append(original)
                labels.append(
                    {
                        **original,
                        "status": "ok",
                        "model": "jev-test",
                        "review": any(d["review"] for d in decisions.values()),
                        "decisions": decisions,
                    }
                )
            manifest = {
                "scope": scope,
                "limit": None,
                "success": len(inputs),
                "errors": 0,
                "database_inventory": {"total": total_inventory},
                "scope_count": len(inputs),
                "questions": rubric,
                "model_requested": "jev-test",
                "models_returned": ["jev-test"],
                "threshold": 0.75,
                "prompt_version": "test",
                "started_at": datetime.now(UTC).isoformat(),
                "selected": len(inputs),
                "distinct_inputs": len(cached),
                "review": sum(row["review"] for row in labels),
            }
            (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            for name, rows in [
                ("inputs", inputs),
                ("labels", labels),
                (
                    "responses",
                    [
                        {"fingerprint": key, "status": "ok", "response": raw}
                        for key, raw in cached.items()
                    ],
                ),
            ]:
                (tmp_path / f"{name}.jsonl").write_text(
                    "\n".join(json.dumps(row) for row in rows), encoding="utf-8"
                )
            await apply(conn, SimpleNamespace(source=tmp_path))
            receipt = json.loads((tmp_path / "import_receipt.json").read_text())
            run_id = await conn.fetchval("SELECT run_id FROM vacancy_direction_run")
            assert receipt["imported"] == len(inputs)
            assert receipt["prior_classification_counts_unchanged"]
            if scope == "vpk_active_unique":
                assert (
                    await conn.fetchval("SELECT count(*) FROM vacancy_direction WHERE vacancy_id=8")
                    == 0
                )
            await apply(conn, SimpleNamespace(source=tmp_path))
            assert await conn.fetchval("SELECT count(*) FROM vacancy_direction_run") == 1
            async with AsyncSession(engine) as session:
                filters = vacancies.VacancyFilter()
                donut = await agent_charts.visualization(session, filters, "donut")
                shares = {r["id"]: r["value"] for r in donut["rows"]}
                assert shares == {"civil_other": 5, "none": 1}
                # Unknown duties do not inherit the employer's UAV label.
                assert (await vacancies.get_vacancy(session, 4))["direction_domain"] == "none"
                where, params = vacancies.VacancyFilter(domain="none").where()
                assert params["domain"] == ["none"] and "v.direction_domain" in where
                count, rows = await vacancies.list_vacancies(
                    session, vacancies.VacancyFilter(domain="none"), "confirmed", 20, 0
                )
                assert count == 1 and rows[0]["id"] == 4
                facets = await vacancies.facets(session, filters)
                assert {r["value"]: r["vacancies"] for r in facets["domain"]} == shares
            # Withdrawing a run restores the employer fallback, retaining audit rows.
            await conn.execute("UPDATE vacancy_direction_run SET status='withdrawn'")
            async with AsyncSession(engine) as session:
                assert (await vacancies.get_vacancy(session, 4))["direction_domain"] == "uav"
            assert await conn.fetchval("SELECT count(*) FROM vacancy_direction") == len(inputs)
        finally:
            if run_id is not None:
                await conn.execute("DELETE FROM vacancy_direction WHERE run_id=$1", run_id)
                await conn.execute("DELETE FROM vacancy_direction_run WHERE run_id=$1", run_id)
            await engine.dispose()
            await conn.close()

    asyncio.run(scenario())
