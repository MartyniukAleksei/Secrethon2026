import asyncio
import csv
import hashlib
import io
import json
import os
import zipfile

import asyncpg
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from app.repository.export import DATASETS


def _csv(client: TestClient, url: str) -> list[dict[str, str]]:
    response = client.get(url)
    assert response.status_code == 200
    assert response.content.startswith("﻿".encode())
    return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))


def test_catalog_lists_every_dataset(client: TestClient) -> None:
    catalog = client.get("/api/export").json()
    assert catalog["as_of"].startswith("2026-10-05T12:00:00")
    counts = {d["name"]: d["row_count"] for d in catalog["datasets"]}
    # Default: as on the site — legal entities behind cards with a shown vacancy (КБП, Алабуга;
    # the Алабуга duplicate row is left out), and only their sanctions, relations, products.
    assert counts == {
        "companies": 2,
        "company_sanctions": 2,
        "company_relations": 1,  # КБП → ВК: one end in the set
        "company_products": 1,
        "company_sources": 0,
        "employers": 4,  # cards: КБП, Алабуга, the КБП branch, the agency
        "employer_profiles": 5,  # КБП on trudvsem and hh, the branch, Алабуга, the agency
        "vacancies": 7,  # shown, active, unique: 1, 2, 3, 4, 8, 10, 11
    }
    vacancies = next(d for d in catalog["datasets"] if d["name"] == "vacancies")
    assert vacancies["urls"]["csv"] == "/api/export/vacancies.csv"
    assert vacancies["filterable"] is True
    assert vacancies["row"] == "одна вакансія"
    assert [c["name"] for c in catalog["coverages"]] == ["site", "vpk", "all"]
    assert catalog["overview"]["coverages"]["site"] == {"companies": 2, "cards": 4, "vacancies": 7}
    assert catalog["overview"]["dedup"]["cross_source"] == 1
    assert catalog["overview"]["dedup"]["site_profiles"] == 5


@pytest.mark.parametrize(
    "query,expected",
    [
        # every ВПК legal entity; Алабуга's excluded vacancy 5 is in, the bakery is not
        ("coverage=vpk", {"companies": 2, "employers": 4, "vacancies": 8, "company_products": 1}),
        # the whole database: the foreign company and the supplier too, every active vacancy
        ("coverage=all", {"companies": 4, "employers": 5, "vacancies": 9, "company_products": 2}),
        # with duplicates: the duplicate company row and the cross-site copy of vacancy 1
        (
            "coverage=all&dedup=false",
            {"companies": 5, "employers": 5, "vacancies": 10, "company_products": 2},
        ),
        ("dedup=false", {"companies": 3, "employers": 4, "vacancies": 8, "company_products": 1}),
    ],
)
def test_catalog_variants(client: TestClient, query: str, expected: dict[str, int]) -> None:
    catalog = client.get(f"/api/export?{query}").json()
    counts = {d["name"]: d["row_count"] for d in catalog["datasets"]}
    assert {k: counts[k] for k in expected} == expected
    companies = next(d for d in catalog["datasets"] if d["name"] == "companies")
    assert companies["urls"]["csv"] == f"/api/export/companies.csv?{query}"
    assert catalog["snapshot"]["zip"] == f"/api/export/snapshot.zip?{query}"
    items = client.get(f"/api/export/companies.json?{query}").json()["items"]
    assert len(items) == counts["companies"]


def test_duplicates_are_marked(client: TestClient) -> None:
    rows = client.get("/api/export/vacancies.json?dedup=false").json()["items"]
    copy = next(r for r in rows if r["vacancy_id"] == 9)
    assert copy["duplicate_of"] == 1 and copy["duplicate_method"] == "cross_source"
    assert copy["level"] == "confirmed"  # the label of the canonical vacancy
    assert all(r["duplicate_of"] is None for r in rows if r["vacancy_id"] != 9)
    companies = client.get("/api/export/companies.json?dedup=false").json()["items"]
    assert {c["company_id"]: c["canonical_id"] for c in companies} == {
        570: None,
        600: None,
        601: 600,
    }
    response = client.get("/api/export/vacancies.csv?coverage=all&dedup=false")
    assert 'filename="vacancies_all_raw_2026-10-05.csv"' in response.headers["content-disposition"]


def test_employer_profiles_map_to_cards(client: TestClient) -> None:
    rows = client.get("/api/export/employer_profiles.json").json()["items"]
    by_id = {r["employer_profile_id"]: r for r in rows}
    assert by_id[5]["card_id"] == 1 and not by_id[5]["is_head"]
    assert by_id[5]["match_status"] == "candidate" and by_id[5]["match_confidence"] == 0.9
    assert by_id[1]["match_method"] == "inn_kpp"
    assert by_id[6]["is_branch"] and by_id[6]["card_id"] == 6
    cards = {e["employer_id"] for e in client.get("/api/export/employers.json").json()["items"]}
    assert {r["card_id"] for r in rows} <= cards


@pytest.mark.parametrize("name", list(DATASETS))
def test_files_follow_the_field_dictionary(client: TestClient, name: str) -> None:
    columns = [c["name"] for c in client.get(f"/api/export/{name}/schema").json()["columns"]]
    assert columns == [c.name for c in DATASETS[name].columns]

    response = client.get(f"/api/export/{name}.csv")
    header = next(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert header == columns
    assert (
        response.headers["content-disposition"] == f'attachment; filename="{name}_2026-10-05.csv"'
    )

    body = client.get(f"/api/export/{name}.json").json()
    assert body["dataset"] == name
    lines = client.get(f"/api/export/{name}.jsonl").text.splitlines()
    assert len(lines) == len(body["items"])
    for item in body["items"]:
        assert list(item) == columns


def test_companies_values(client: TestClient) -> None:
    kbp = next(r for r in _csv(client, "/api/export/companies.csv") if r["company_id"] == "570")
    assert kbp["on_gur_portal"] == "true"
    assert kbp["name_short_uk"] == 'АТ "КБП"'
    assert kbp["country"] == "російська федерація"
    assert kbp["sanctions_count"] == "2"
    assert kbp["vpk_category"] == "vpk" and kbp["vpk_level"] == "decided"
    assert kbp["direction_label"] == "НДДКР"
    assert kbp["sanctions_all"] == "TW; UA; US"
    assert kbp["on_site"] == "true"
    assert set(kbp["card_ids"].split("; ")) == {"1", "6"}


def test_employers_link_to_companies(client: TestClient) -> None:
    items = client.get("/api/export/employers.json").json()["items"]
    by_id = {e["employer_id"]: e for e in items}
    assert by_id[1]["matched_company_id"] == 570 and by_id[1]["match_method"] == "inn"
    # confident name candidate through a duplicate resolves to the canonical company
    assert by_id[2]["matched_company_id"] == 600 and by_id[2]["match_method"] == "name"
    assert by_id[1]["median_salary"] == 67500


def test_products_union(client: TestClient) -> None:
    items = client.get("/api/export/company_products.json?coverage=all").json()["items"]
    assert {(i["company_id"], i["product_type"], i["product_id"]) for i in items} == {
        (570, "weapon", "test-weapon"),
        (522, "uav", "1"),
    }


def test_vacancy_filters_match_the_list(client: TestClient) -> None:
    # The export defaults to every shown vacancy (scope=all); the list to ВПК ones.
    for params in (
        "scope=vpk&level=vpk",
        "scope=vpk&level=vpk&region_id=64",
        "scope=vpk&level=confirmed",
        "scope=agency",
        "scope=all&q=Токарь",
    ):
        listed = client.get(f"/api/vacancies?{params}").json()["total"]
        exported = client.get(f"/api/export/vacancies.json?{params}").json()["items"]
        assert len(exported) == listed, params
    rows = _csv(client, "/api/export/vacancies.csv?level=vpk&region_id=64")
    assert {r["vacancy_id"] for r in rows} == {"1", "2", "3", "10"}
    assert rows[0]["salary_from"] == "70000.0"


def test_unknown_dataset_or_format(client: TestClient) -> None:
    assert client.get("/api/export/nope.csv").status_code == 404
    assert client.get("/api/export/nope/schema").status_code == 404
    assert client.get("/api/export/companies.xml").status_code == 404


def test_parquet_follows_the_field_dictionary(client: TestClient) -> None:
    response = client.get("/api/export/vacancies.parquet?scope=vpk")
    assert response.status_code == 200
    assert "content-encoding" not in response.headers
    table = pq.read_table(io.BytesIO(response.content))
    assert table.schema.names == [c.name for c in DATASETS["vacancies"].columns]
    assert str(table.schema.field("published_at").type) == "timestamp[us, tz=UTC]"
    assert table.num_rows == client.get("/api/vacancies?scope=vpk").json()["total"]
    companies = pq.read_table(io.BytesIO(client.get("/api/export/companies.parquet").content))
    assert companies.schema.field("products_uk").type == pa.list_(pa.string())


def test_snapshot_zip_manifest_matches_files(client: TestClient) -> None:
    response = client.get("/api/export/snapshot.zip")
    assert response.status_code == 200
    assert 'filename="stayhard_snapshot_2026-10-05.zip"' in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        catalog = client.get("/api/export").json()
        assert manifest["datasets"] == {d["name"]: d["row_count"] for d in catalog["datasets"]}
        for path, meta in manifest["files"].items():
            assert hashlib.sha256(zf.read(path)).hexdigest() == meta["sha256"], path
        assert {f"{n}.{ext}" for n in DATASETS for ext in ("csv", "parquet")} <= set(zf.namelist())
        assert {"snapshot.sql", "schema.json", "README.md"} <= set(zf.namelist())


def test_snapshot_sql_loads_into_postgres(client: TestClient) -> None:
    script = client.get("/api/export/snapshot.sql").text
    counts = {d["name"]: d["row_count"] for d in client.get("/api/export").json()["datasets"]}

    async def load() -> dict[str, int]:
        conn = await asyncpg.connect(os.environ["DATABASE_URL"])  # set by conftest
        try:
            await conn.execute(
                "DROP SCHEMA IF EXISTS export_check CASCADE; CREATE SCHEMA export_check"
            )
            await conn.execute("SET search_path = export_check")
            await conn.execute(script)
            return {n: await conn.fetchval(f"SELECT count(*) FROM {n}") for n in DATASETS}
        finally:
            await conn.execute("DROP SCHEMA IF EXISTS export_check CASCADE")
            await conn.close()

    assert asyncio.run(load()) == counts


def test_snapshots_per_variant(client: TestClient) -> None:
    response = client.get("/api/export/snapshot.zip?coverage=all&dedup=false")
    assert (
        'filename="stayhard_snapshot_all_raw_2026-10-05.zip"'
        in response.headers["content-disposition"]
    )
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["coverage"] == "all" and manifest["dedup"] is False
        assert manifest["datasets"]["vacancies"] == 10
        assert "Уся база" in zf.read("README.md").decode()
    with zipfile.ZipFile(io.BytesIO(client.get("/api/export/snapshot.zip").content)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["coverage"] == "site" and manifest["datasets"]["vacancies"] == 7
    assert client.get("/api/export?coverage=nope").status_code == 422
