import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.pool import NullPool

from app.config import settings
from app.db import make_engine


def test_stats(client: TestClient) -> None:
    stats = client.get("/api/stats").json()
    assert stats["vacancies"] == 6
    # confirmed + likely; vacancy 3 counts as likely because the latest run wins
    assert stats["vpk_vacancies"] == 5
    assert stats["confirmed_vacancies"] == 1
    assert stats["vpk_employers"] == 2
    assert stats["matched_employers"] == 1
    assert {r["name"] for r in stats["regions_list"]} == {"Тульская область", "Город Москва"}
    assert len(stats["monthly"]) == 12


def test_employers_only_vpk(client: TestClient) -> None:
    employers = client.get("/api/employers").json()
    assert [e["id"] for e in employers] == [1, 2]  # bakery (no ВПК vacancies) is excluded
    kbp = employers[0]
    assert kbp["vpk_vacancies"] == 3
    assert kbp["confirmed_vacancies"] == 1
    assert kbp["region"] == "Тульская область"
    assert kbp["category"] == "производство"
    assert kbp["gur_company_id"] == 570
    assert kbp["sanctions_count"] == 2
    assert kbp["ogrn"] == "1117154036911"
    assert kbp["kpp"] == "710501001"
    # monthly RUB salaries: 75 000 (midpoint) and 60 000; the hh vacancy has no salary
    assert kbp["median_salary"] == 67500


def test_employer_detail_with_gur_card(client: TestClient) -> None:
    detail = client.get("/api/employers/1").json()
    assert detail["professions"][0] == {
        "title": "Токарь",
        "vacancies": 2,
        "employers": None,
        "median_salary": 75000.0,
        "category": None,
    }
    gur = detail["gur"]
    # Tags belong to this company, not its UAV-producing parent.
    assert gur["activity_tags"] == ["Озброєння"]
    assert gur["gur_url"].endswith("/rostec/1921")
    assert {s["jurisdiction"] for s in gur["sanctions"]} == {"US", "UA"}
    assert gur["relations"] == [
        {
            "kind": "parent",
            "direction": "out",
            "company_id": 522,
            "name": 'АТ "ВК"',
            "inn": "7704721192",
            "sanctions_count": 1,
            "employer_id": None,
        }
    ]


def test_hiring_locations_are_separate_from_company_address(client: TestClient) -> None:
    detail = client.get("/api/employers/1").json()
    assert detail["gur"]["address_uk"] == "м. Тула"
    assert detail["hiring_locations"] == [
        {
            "address": None,
            "locality": "Тула",
            "lat": 54.2,
            "lng": 37.63,
            "source": "hh",
            "vacancy_id": 3,
            "vacancy_url": "https://hh.ru/vacancy/3",
        },
        {
            "address": "Тула, ул. Найма, 1",
            "locality": "Тула",
            "lat": 54.193,
            "lng": 37.617,
            "source": "trudvsem",
            "vacancy_id": 1,
            "vacancy_url": "https://trudvsem.ru/vacancy/1",
        },
    ]  # same place is deduplicated, latest vacancy supplies the source link
    unmatched = client.get("/api/employers/2").json()
    assert unmatched["gur"] is None  # the matched company has no GUR card; the weak match is ignored
    assert len(unmatched["hiring_locations"]) == 1  # blank locations are omitted
    assert unmatched["hiring_locations"][0]["lat"] is None  # invalid coordinates
    assert client.get("/api/employers/3").json()["hiring_locations"] == []  # non-VPK


def test_open_source_profile(client: TestClient) -> None:
    kbp = client.get("/api/employers/1").json()
    assert kbp["gur"]["match"] == "inn"
    assert kbp["profile"] is None  # only a draft exists

    profile = client.get("/api/employers/2").json()["profile"]
    # Latest published profile of the canonical company; drafts and older runs are skipped.
    assert profile["company_id"] == 600
    assert profile["origin"] == "exa_llm"
    assert profile["activity_tags"] == ["БпЛА"]
    assert profile["products_ru"] == ["Дроны «Герань»"]
    assert profile["description_ru"] == "Завод в Елабуге [1][2][3]."
    # Only verified facts of the same run.
    assert profile["sources"] == [
        {
            "n": 1,
            "url": "https://example.com/site",
            "quote": "Завод в Елабуге",
            "claim": "Завод в Елабуге",
            "source_type": "official_site",
            "grade": "B",
        }
    ]


def test_probable_gur_match_by_name(client: TestClient) -> None:
    gur = client.get("/api/employers/3").json()["gur"]
    assert gur["company_id"] == 522
    assert gur["match"] == "name"


def test_map_points(client: TestClient) -> None:
    response = client.get("/api/employers/map-points")
    assert response.status_code == 200
    assert response.json() == [
        {
            "employer_id": 1,
            "lat": 54.193,
            "lng": 37.617,
            "locality": "Тула",
            "region_id": 64,
            "vacancies": 2,
        },
        {
            "employer_id": 1,
            "lat": 54.2,
            "lng": 37.63,
            "locality": "Тула",
            "region_id": 64,
            "vacancies": 1,
        },
    ]


def test_employer_missing(client: TestClient) -> None:
    assert client.get("/api/employers/999").status_code == 404


def test_map_network_preserves_relationships_and_sources(client: TestClient) -> None:
    response = client.get("/api/employers/map-network")
    assert response.status_code == 200  # must not be handled as an employer ID
    data = response.json()
    assert data["relations"] == [
        {
            "company_id": 570,
            "related_id": 522,
            "kind": "parent",
            "company_name": 'АТ "КБП"',
            "related_name": 'АТ "ВК"',
            "source": "profile",
            "label": None,
            "evidence_url": None,
            "profile_url": "https://war-sanctions.gur.gov.ua/rostec/1921",
        },
        {
            "company_id": 522,
            "related_id": 523,
            "kind": "supplier",
            "company_name": 'АТ "ВК"',
            "related_name": "Постачальник без координат",
            "source": "vpk_atlas",
            "label": "Оптичні матеріали",
            "evidence_url": "https://example.com/supplier-evidence",
            "profile_url": None,
        },
    ]
    assert data["company_tags"] == [
        {"company_id": 522, "uav": True, "weapons": False},
        {"company_id": 570, "uav": False, "weapons": True},
    ]


def test_vacancies_paging_and_filters(client: TestClient) -> None:
    page = client.get("/api/vacancies", params={"limit": 2}).json()
    assert page["total"] == 5
    assert [v["id"] for v in page["items"]] == [4, 3]  # newest first
    # hh vacancy without a region inherits it from trudvsem vacancies in the same city
    tula = client.get("/api/vacancies", params={"region_id": 64}).json()
    assert {v["id"] for v in tula["items"]} == {1, 2, 3}
    assert client.get("/api/vacancies", params={"q": "БпЛА"}).json()["total"] == 1
    assert client.get("/api/vacancies", params={"level": "all"}).json()["total"] == 6
    by_salary = client.get("/api/vacancies", params={"sort": "salary"}).json()["items"]
    assert by_salary[0]["id"] == 4


def test_vacancy_detail(client: TestClient) -> None:
    vacancy = client.get("/api/vacancies/1").json()
    assert vacancy["description"] == "Обработка деталей"
    assert vacancy["url"] == "https://trudvsem.ru/vacancy/1"
    assert client.get("/api/vacancies/999").status_code == 404


def test_professions(client: TestClient) -> None:
    professions = client.get("/api/professions").json()
    assert professions[0]["title"] == "Токарь"
    assert professions[0]["vacancies"] == 2
    assert professions[0]["employers"] == 1


def test_connection_is_read_only(client: TestClient) -> None:
    # Pipeline sessions stay read-only; reviews use a separate schema/connection.
    async def try_write() -> None:
        engine = make_engine(settings.database_url, poolclass=NullPool)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("CREATE TABLE should_not_exist (id int)"))
        finally:
            await engine.dispose()

    with pytest.raises(DBAPIError, match="read-only"):
        asyncio.run(try_write())


def test_vacancy_review_sources_start_empty(client: TestClient) -> None:
    detail = client.get("/api/vacancies/1").json()
    assert detail["classifier_name"] == "trudvsem_vpk_rules"
    assert detail["classifier_version"] == "test"
    assert detail["reviews"] == []


@pytest.mark.parametrize(
    "patch",
    [
        {"confidence": "certain"},
        {"source": "rules"},
        {"reviewed_by": "  "},
        {"reviewed_by": "x" * 121},
        {"comment": "x" * 2001},
        {"review_id": 5},
    ],
)
def test_review_validation(client: TestClient, patch: dict) -> None:
    review = {"source": "human", "confidence": "high", "reviewed_by": "Analyst", **patch}
    assert client.post("/api/vacancies/1/reviews", json=review).status_code == 422


def test_human_and_llm_reviews_are_independent_and_persistent(client: TestClient) -> None:
    human = client.post(
        "/api/vacancies/1/reviews",
        json={
            "source": "human",
            "confidence": "high",
            "reviewed_by": " Analyst ",
            "comment": " Checked company products ",
        },
    )
    assert human.status_code == 201
    assert human.json()["reviewed_by"] == "Analyst"
    assert human.json()["comment"] == "Checked company products"
    assert human.json()["reviewed_at"]
    llm = client.post(
        "/api/vacancies/1/reviews",
        json={"source": "llm", "confidence": "medium", "reviewed_by": "test-model-v1"},
    )
    assert llm.status_code == 201
    detail = client.get("/api/vacancies/1").json()
    assert [(r["source"], r["confidence"]) for r in detail["reviews"]] == [
        ("llm", "medium"),
        ("human", "high"),
    ]
    # Adding a revision retains the old human review and the independent LLM result.
    revision = client.post(
        "/api/vacancies/1/reviews",
        json={"source": "human", "confidence": "low", "reviewed_by": "Second analyst"},
    )
    assert revision.status_code == 201
    detail = client.get("/api/vacancies/1").json()
    assert [(r["source"], r["confidence"]) for r in detail["reviews"]] == [
        ("human", "low"),
        ("llm", "medium"),
        ("human", "high"),
    ]
    assert detail["level"] == "confirmed"  # Pipeline classification is preserved.
    assert client.get("/api/vacancies/2").json()["reviews"] == []
    assert client.get("/api/stats").json()["vpk_vacancies"] == 5


def test_review_requires_existing_active_vacancy(client: TestClient) -> None:
    for vacancy_id in (99999, 7):
        response = client.post(
            f"/api/vacancies/{vacancy_id}/reviews",
            json={"source": "human", "confidence": "high", "reviewed_by": "Analyst"},
        )
        assert response.status_code == 404


def test_failed_review_does_not_report_success(client: TestClient, monkeypatch) -> None:
    from app import reviews

    async def fail(*args, **kwargs):
        raise SQLAlchemyError("storage unavailable")

    monkeypatch.setattr(reviews, "save_review", fail)
    response = client.post(
        "/api/vacancies/2/reviews",
        json={"source": "human", "confidence": "high", "reviewed_by": "Analyst"},
    )
    assert response.status_code == 503
    assert client.get("/api/vacancies/2").json()["reviews"] == []
