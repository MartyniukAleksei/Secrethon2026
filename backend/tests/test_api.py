import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
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
    # The app must not be able to write to the pipeline's database.
    async def try_write() -> None:
        engine = make_engine(settings.database_url, poolclass=NullPool)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("CREATE TABLE should_not_exist (id int)"))
        finally:
            await engine.dispose()

    with pytest.raises(DBAPIError, match="read-only"):
        asyncio.run(try_write())
