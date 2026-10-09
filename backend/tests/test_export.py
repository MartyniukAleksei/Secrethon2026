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
    assert counts == {
        "companies": 5,
        "company_sanctions": 3,
        "company_relations": 2,
        "company_products": 2,
        "company_sources": 0,
        "employers": 4,  # cards: КБП, Алабуга, the КБП branch, the agency
        "vacancies": 7,  # shown, active, unique: 1, 2, 3, 4, 8, 10, 11
    }
    vacancies = next(d for d in catalog["datasets"] if d["name"] == "vacancies")
    assert vacancies["urls"]["csv"] == "/api/export/vacancies.csv"
    assert vacancies["filterable"] is True


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


def test_employers_link_to_companies(client: TestClient) -> None:
    items = client.get("/api/export/employers.json").json()["items"]
    by_id = {e["employer_id"]: e for e in items}
    assert by_id[1]["matched_company_id"] == 570 and by_id[1]["match_method"] == "inn"
    # confident name candidate through a duplicate resolves to the canonical company
    assert by_id[2]["matched_company_id"] == 600 and by_id[2]["match_method"] == "name"
    assert by_id[1]["median_salary"] == 67500


def test_products_union(client: TestClient) -> None:
    items = client.get("/api/export/company_products.json").json()["items"]
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
