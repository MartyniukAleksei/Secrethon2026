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
    assert stats["final_run_at"].startswith("2026-10-09")
    assert stats["vacancies"] == 9  # active and unique: the inactive 7 and the repost 9 are out
    # The final label decides: the repost 9 and the excluded 5, 6 are not counted; the agency
    # vacancy 8 is counted apart.
    assert stats["vpk_vacancies"] == 6
    assert stats["confirmed_vacancies"] == 4
    assert stats["on_review_vacancies"] == 2
    # Profiles 1, 2, 5, 6 → cards 1 (КБП: trudvsem + hh), 2, 6 (a branch) → companies 570, 600.
    assert stats["vpk_profiles"] == 4
    assert stats["vpk_employers"] == 3
    assert stats["vpk_legal_entities"] == 2
    assert stats["salary_samples"] == 3  # vacancies 1, 2, 4
    assert stats["agency_employers"] == 1
    assert stats["agency_vacancies"] == 1
    assert stats["foreign_intermediary_decided"] == 1
    assert stats["matched_employers"] == 1
    assert {r["name"] for r in stats["regions_list"]} == {"Тульская область"}
    assert len(stats["monthly"]) == 12


def test_employers_only_vpk(client: TestClient) -> None:
    employers = client.get("/api/employers").json()
    # One card per enterprise: profile 5 is in card 1, the branch 6 is a card of its own; the
    # bakery (no shown vacancies) is excluded.
    assert [e["id"] for e in employers] == [1, 2, 6, 4]
    kbp = employers[0]
    assert kbp["vpk_vacancies"] == 4  # vacancies 1, 2, 3 of profile 1 and 10 of profile 5
    assert kbp["confirmed_vacancies"] == 3
    assert kbp["profiles"] == 2 and kbp["is_branch"] is False
    assert [f["focus"] for f in kbp["focus"]] == ["drone", "missile"]
    assert employers[1]["focus"] == []  # a ВПК company without a focus tag: adjacent
    assert employers[1]["match_conflict"] is True
    assert employers[2]["is_branch"] is True
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
            "address": None,
            "locality": "Тула",
            "lat": None,
            "lng": None,
            "source": "hh",
            "vacancy_id": 10,
            "vacancy_url": "https://hh.ru/vacancy/10",
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
    # The matched company has no GUR card, and the weak match is ignored.
    assert unmatched["gur"] is None
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
    assert profile["updated_at"].startswith("2026-10-07")  # start of the search run
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


def test_company_classification(client: TestClient) -> None:
    kbp = client.get("/api/employers/1").json()
    assert (kbp["company_id"], kbp["company_link"]) == (570, "auto")
    c = kbp["classification"]
    # The latest classification run wins.
    assert (c["vpk_category"], c["vpk_probability"], c["vpk_level"]) == ("vpk", 1.0, "decided")
    assert (c["direction_label"], c["reliability"]) == ("НДДКР", "A1")
    assert (c["sanctions_gur"], c["sanctions_new"]) == (["US", "UA"], ["TW"])
    # Only sanctions backed by a verified fact.
    assert c["sanctions_found"] == [
        {
            "jurisdiction": "TW",
            "list_name": "Taiwan Entity List",
            "listed_raw": "2024-01-05",
            "in_gur": False,
            "url": "https://www.opensanctions.org/entities/kbp",
        }
    ]

    alabuga = client.get("/api/employers/2").json()
    # A confident candidate link to a registry-only company is shown as probable.
    assert (alabuga["company_id"], alabuga["company_link"]) == (600, "candidate")
    assert alabuga["classification"]["vpk_level"] == "review"
    assert alabuga["registry"]["head"].endswith("Иванов Иван Иванович")
    assert alabuga["agency"] is None  # has a legal entity
    rule = client.get("/api/employers/3").json()["classification"]
    assert (rule["vpk_category"], rule["vpk_probability"]) == ("foreign_intermediary", None)


def test_employer_list_carries_classification(client: TestClient) -> None:
    by_id = {e["id"]: e for e in client.get("/api/employers").json()}
    # Same legal entity as the company page: by INN, or through a confident candidate.
    assert by_id[1]["classification"]["direction_label"] == "НДДКР"
    assert "explanation" not in by_id[1]["classification"]  # page-only details
    assert by_id[2]["classification"]["vpk_level"] == "review"
    assert by_id[2]["agency"] is None
    assert by_id[4]["classification"] is None
    assert by_id[4]["agency"]["category"] == "agency_vpk"
    # Cards show the GUR logo, the same as the company page.
    assert by_id[1]["logo_url"] == "https://war-sanctions.gur.gov.ua/logo/kbp.png"
    assert by_id[2]["logo_url"] is None
    assert client.get("/api/employers/1").json()["logo_url"] == by_id[1]["logo_url"]


def test_company_contacts_only_verified(client: TestClient) -> None:
    contacts = client.get("/api/employers/1").json()["contacts"]
    assert {(c["kind"], c["value"]) for c in contacts} == {
        ("email", "kbkedr@tula.net"),
        ("phone", "+7 (4872) 41-00-68"),
        ("website", "https://kbptula.ru"),
    }
    phone = next(c for c in contacts if c["kind"] == "phone")
    assert (phone["detail"], phone["url"]) == ("приёмная", "https://kbptula.ru/contacts")


def test_recruitment_agency_without_company(client: TestClient) -> None:
    agency = client.get("/api/employers/4").json()
    assert (agency["company_id"], agency["company_link"], agency["classification"]) == (
        None,
        None,
        None,
    )
    assert agency["agency"]["category"] == "agency_vpk"
    assert agency["agency"]["level"] == "review"
    # Contacts found for the employer page itself.
    assert [c["value"] for c in agency["contacts"]] == ["+7 495 000-00-04"]


def test_classification_counters(client: TestClient) -> None:
    stats = client.get("/api/stats").json()
    # 570 (latest run) and 600; the intermediary and agencies are counted apart.
    assert stats["vpk_companies"] == 2
    assert stats["vpk_companies_decided"] == 1
    assert stats["foreign_intermediary_companies"] == 1
    assert stats["agency_vpk_companies"] == 0
    assert stats["agency_employers"] == 1
    assert stats["agency_vacancies"] == 1  # employer 4: vacancy 8


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
    assert page["total"] == 6
    assert [v["id"] for v in page["items"]] == [10, 4]  # newest first
    # hh vacancy without a region inherits it from trudvsem vacancies in the same city
    tula = client.get("/api/vacancies", params={"region_id": 64}).json()
    assert {v["id"] for v in tula["items"]} == {1, 2, 3, 10}
    # Agency vacancies are listed apart; the excluded 5, 6 and the repost 9 never are.
    assert client.get("/api/vacancies", params={"q": "БпЛА"}).json()["total"] == 1
    agency = client.get("/api/vacancies", params={"scope": "agency"}).json()
    assert [v["id"] for v in agency["items"]] == [8]
    assert client.get("/api/vacancies", params={"level": "all"}).json()["total"] == 6
    assert client.get("/api/vacancies", params={"scope": "all"}).json()["total"] == 7
    assert client.get("/api/vacancies", params={"level": "likely"}).json()["total"] == 2
    assert [
        v["id"] for v in client.get("/api/vacancies", params={"markers": True}).json()["items"]
    ] == [1]
    # The card's vacancies come from all its profiles; employer_id is the card.
    card = client.get("/api/vacancies", params={"employer_id": 1}).json()["items"]
    assert {v["id"] for v in card} == {1, 2, 3, 10} and {v["employer_id"] for v in card} == {1}
    by_salary = client.get("/api/vacancies", params={"sort": "salary", "scope": "all"}).json()
    assert by_salary["items"][0]["id"] == 4


def test_vacancy_detail(client: TestClient) -> None:
    vacancy = client.get("/api/vacancies/1").json()
    assert vacancy["description"] == "Обработка деталей"
    assert vacancy["url"] == "https://trudvsem.ru/vacancy/1"
    assert vacancy["shown"] is True and vacancy["final_basis"] == "company_vpk"
    assert [e["signal"] for e in vacancy["evidence"]] == [
        "компания: vpk",
        "явные признаки ВПК в тексте",
    ]
    assert client.get("/api/vacancies/9").status_code == 404  # a repost
    # Not counted, but still reachable by a direct link.
    assert client.get("/api/vacancies/6").json()["shown"] is False
    assert client.get("/api/vacancies/999").status_code == 404


def test_employer_page_without_shown_vacancies(client: TestClient) -> None:
    bakery = client.get("/api/employers/3")
    assert bakery.status_code == 200
    assert bakery.json()["vpk_vacancies"] == 0 and bakery.json()["professions"] == []
    assert client.get("/api/employers/999").status_code == 404


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
    assert detail["classifier_name"] == "vacancy_final"
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
    assert client.get("/api/stats").json()["vpk_vacancies"] == 6


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


def _employer_review(**patch) -> dict:
    return {"vpk": "confirmed", "reviewed_by": "Analyst", **patch}


@pytest.mark.parametrize(
    "patch",
    [
        {"vpk": None},  # nothing reviewed
        {"vpk": "maybe"},
        {"reliability": "G"},
        {"category": "военная служба"},
        {"sanctions": "yes"},
        {"sources": ["telegram"]},
        {"sources": []},
        {"reviewed_by": "  "},
        {"reviewed_by": "x" * 121},
        {"comment": "x" * 2001},
        {"employer_id": 1},
    ],
)
def test_employer_review_validation(client: TestClient, patch: dict) -> None:
    response = client.post("/api/employers/2/reviews", json=_employer_review(**patch))
    assert response.status_code == 422


def test_employer_human_review_overrides_and_keeps_history(client: TestClient) -> None:
    before = client.get("/api/employers/2").json()
    assert before["human_review"] is None and before["human_reviews"] == []
    assert (
        next(e for e in client.get("/api/employers").json() if e["id"] == 2)["human_review"] is None
    )

    first = client.post(
        "/api/employers/2/reviews",
        json={
            "sources": ["registry", "media", "registry"],
            "reliability": "B",
            "category": "ремонт",
            "sanctions": "sanctioned",
            "vpk": "confirmed",
            "reviewed_by": " Analyst ",
            "comment": " Found in the registry ",
        },
    )
    assert first.status_code == 201
    saved = first.json()
    assert saved["employer_id"] == 2
    assert saved["sources"] == ["registry", "media"]
    assert saved["reviewed_by"] == "Analyst" and saved["comment"] == "Found in the registry"

    second = client.post("/api/employers/2/reviews", json=_employer_review(vpk="no"))
    assert second.status_code == 201

    # Cached list and detail are refreshed right away; the latest revision is in effect.
    listed = next(e for e in client.get("/api/employers").json() if e["id"] == 2)
    assert listed["human_review"]["vpk"] == "no"
    assert listed["human_review"]["category"] is None  # a revision is a full snapshot
    detail = client.get("/api/employers/2").json()
    assert detail["human_review"]["review_id"] == second.json()["review_id"]
    assert [r["vpk"] for r in detail["human_reviews"]] == ["no", "confirmed"]
    # Automatic values stay as collected.
    assert detail["category"] == before["category"]
    assert detail["sanctions_count"] == before["sanctions_count"]
    assert detail["confirmed_vacancies"] == before["confirmed_vacancies"]
    assert client.get("/api/employers/1").json()["human_reviews"] == []

    exported = {
        e["employer_id"]: e for e in client.get("/api/export/employers.json").json()["items"]
    }
    assert exported[2]["human_vpk"] == "no" and exported[2]["human_reviewed_by"] == "Analyst"
    assert exported[1]["human_vpk"] is None


def test_employer_review_requires_existing_employer(client: TestClient) -> None:
    assert client.post("/api/employers/999/reviews", json=_employer_review()).status_code == 404


def test_failed_employer_review_does_not_report_success(client: TestClient, monkeypatch) -> None:
    from app import reviews

    async def fail(*args, **kwargs):
        raise SQLAlchemyError("storage unavailable")

    monkeypatch.setattr(reviews, "save_employer_review", fail)
    response = client.post("/api/employers/1/reviews", json=_employer_review())
    assert response.status_code == 503
    assert client.get("/api/employers/1").json()["human_reviews"] == []


def test_one_card_per_enterprise(client: TestClient) -> None:
    # Any profile of the group opens its card; the site page moves there with a 301.
    card = client.get("/api/employers/5").json()
    assert card["id"] == 1 and card["vpk_vacancies"] == 4
    redirect = client.get("/companies/5/vacancies", follow_redirects=False)
    assert redirect.status_code == 301
    assert redirect.headers["location"] == "/companies/1/vacancies"
    assert client.get("/companies/1", follow_redirects=False).status_code != 301
    assert [(s["employer_profile_id"], s["source"], s["vacancies"]) for s in card["sources"]] == [
        (1, "trudvsem", 3),
        (5, "hh", 1),
    ]
    # The hh profile has a weak link, but the card's main profile is linked by INN.
    assert card["company_link"] == "auto" and card["inn"] == "7105514574"
    assert {f["focus"]: f["basis"] for f in card["focus"]} == {
        "drone": "vacancies",
        "missile": "gur_weapon",
    }
    assert card["classification"]["direction_domain"] == "missiles_space"
    branch = client.get("/api/employers/6").json()
    assert branch["is_branch"] is True and branch["parent_card_id"] == 1
    # The branch has no INN of its own on hh: it takes its legal entity's.
    assert branch["inn"] == "7105514574"


def test_match_conflicts(client: TestClient) -> None:
    conflicts = client.get("/api/employers/2").json()["match_conflicts"]
    assert [(c["kind"], c["evidence"]["other_inn"]) for c in conflicts] == [
        ("different_inn", "7704721192")
    ]
    assert client.get("/api/employers/1").json()["match_conflicts"] == []


def test_focus_and_direction_filters(client: TestClient) -> None:
    def ids(**params: object) -> set[int]:
        return {v["id"] for v in client.get("/api/vacancies", params=params).json()["items"]}

    assert ids(focus="missile") == {1, 2, 3, 10, 11}  # КБП and its branch
    assert ids(focus="kab") == set()
    assert ids(focus="other") == {4}  # Алабуга: ВПК without a focus tag
    assert ids(domain="uav") == {4}
    assert ids(role="manufacturer") == {1, 2, 3, 4, 10, 11}
    assert client.get("/api/vacancies", params={"focus": "nope"}).status_code == 422
