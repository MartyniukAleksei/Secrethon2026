"""The site with a `vacancy_final` run: the final label alone decides what is shown and counted."""

import asyncio
from collections.abc import Iterator

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.repository.cache import cache
from tests.conftest import TEST_DATABASE_URL

# Vacancies 1–6 and 8 come from fixtures/sample.sql. Vacancy 9 reposts vacancy 1 and must not count.
FINAL_RUN = """
INSERT INTO classifier_run (run_id, classifier, version, started_at)
VALUES (10, 'vacancy_final', 'test', '2026-10-09T00:00:00Z');
INSERT INTO vacancy (vacancy_id, source, external_id, url, employer_profile_id, employer_name,
                     title, region_id, locality, published_at, first_seen_at, last_seen_at)
VALUES (9, 'hh', 'v9', 'https://hh.ru/vacancy/9', 1, 'АО "КБП"', 'Токарь', 64, 'Тула',
        '2026-09-21T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z');
INSERT INTO vacancy_duplicate (vacancy_id, canonical_id, method, score)
VALUES (9, 1, 'cross_source', 1);
INSERT INTO vacancy_classification (run_id, vacancy_id, level, raw_label, score, category) VALUES
  (10, 1, 'confirmed', 'company_vpk', 1.0, 'vpk'),
  (10, 2, 'confirmed', 'company_vpk', 1.0, 'vpk'),
  (10, 3, 'likely', 'company_vpk_review', 0.62, 'vpk'),
  (10, 4, 'likely', 'text_jev', 0.7, 'vpk'),
  (10, 5, 'no', 'company_civil_sanctioned', 0.9, 'excluded'),
  (10, 6, 'no', 'text_no_signal', NULL, 'excluded'),
  (10, 8, 'confirmed', 'text_jev', 0.95, 'agency'),
  (10, 9, 'confirmed', 'company_vpk', 1.0, 'vpk');
INSERT INTO classification_evidence (run_id, vacancy_id, signal, origin, weight, snippet) VALUES
  (10, 1, 'компания: vpk', 'company_classification', 1.0, 'АО "КБП": НДДКР'),
  (10, 1, 'явные признаки ВПК в тексте', 'hidden_vpk', NULL, 'гостайна'),
  (10, 4, 'JEV по тексту вакансии', 'jev', 0.7, 'vpk 0.70');
"""
CLEANUP = """
DELETE FROM classification_evidence WHERE run_id = 10;
DELETE FROM vacancy_classification WHERE run_id = 10;
DELETE FROM classifier_run WHERE run_id = 10;
DELETE FROM vacancy WHERE vacancy_id = 9;
"""


async def _execute(sql: str) -> None:
    conn = await asyncpg.connect(TEST_DATABASE_URL)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


@pytest.fixture(scope="module")
def final(client: TestClient) -> Iterator[TestClient]:
    asyncio.run(_execute(FINAL_RUN))
    cache.clear()
    try:
        yield client
    finally:
        asyncio.run(_execute(CLEANUP))
        cache.clear()


def test_counters(final: TestClient) -> None:
    stats = final.get("/api/stats").json()
    assert stats["final_run_at"].startswith("2026-10-09")
    assert stats["vpk_vacancies"] == 4  # the repost 9 and the excluded 5, 6 are not counted
    assert stats["confirmed_vacancies"] == 2
    assert stats["on_review_vacancies"] == 2
    assert stats["vpk_employers"] == 2
    assert stats["agency_employers"] == 1
    assert stats["agency_vacancies"] == 1
    assert {(b["category"], b["basis"]): b["vacancies"] for b in stats["by_basis"]} == {
        ("vpk", "company_vpk"): 2,
        ("vpk", "company_vpk_review"): 1,
        ("vpk", "text_jev"): 1,
        ("agency", "text_jev"): 1,
    }


def test_lists(final: TestClient) -> None:
    def ids(**params: object) -> set[int]:
        return {v["id"] for v in final.get("/api/vacancies", params=params).json()["items"]}

    assert ids() == {1, 2, 3, 4}
    assert ids(scope="agency") == {8}
    assert ids(scope="all") == {1, 2, 3, 4, 8}
    assert ids(level="likely") == {3, 4}
    assert ids(markers=True) == {1}
    items = {v["id"]: v for v in final.get("/api/vacancies").json()["items"]}
    assert items[4]["final_basis"] == "text_jev" and items[4]["level"] == "likely"
    assert items[1]["has_markers"] is True


def test_vacancy_detail(final: TestClient) -> None:
    jev = final.get("/api/vacancies/4").json()
    assert jev["classifier_name"] == "vacancy_final" and jev["shown"] is True
    assert [e["signal"] for e in jev["evidence"]] == ["JEV по тексту вакансии"]
    excluded = final.get("/api/vacancies/5").json()
    assert excluded["shown"] is False and excluded["final_category"] == "excluded"
    assert final.get("/api/vacancies/9").status_code == 404  # a repost


def test_employers(final: TestClient) -> None:
    employers = {e["id"]: e for e in final.get("/api/employers").json()}
    assert set(employers) == {1, 2, 4}  # the bakery has no shown vacancy
    assert employers[1]["vpk_vacancies"] == 3
    assert employers[2]["vpk_vacancies"] == 1  # vacancy 5 is excluded
    assert employers[4]["vpk_vacancies"] == 0 and employers[4]["agency_vacancies"] == 1
    agency = final.get("/api/employers/4").json()
    assert agency["professions"][0]["title"] == "Слесарь на оборонный завод"
