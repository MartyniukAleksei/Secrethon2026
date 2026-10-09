import asyncio
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.api.vacancies import filter_params
from app.export_formats import stream_csv, stream_json, stream_jsonl
from app.export_snapshot import snapshots, to_parquet
from app.repository import export
from app.repository.cache import cache
from app.repository.export import COVERAGES, DATASETS, SITE, Coverage, Dataset, Variant
from app.repository.vacancies import VacancyFilter

router = APIRouter(prefix="/export", tags=["export"])

STREAM_FORMATS = {
    "csv": "text/csv; charset=utf-8",
    "json": "application/json",
    "jsonl": "application/x-ndjson",
}
PARQUET = "application/vnd.apache.parquet"
FORMATS = (*STREAM_FORMATS, "parquet")


def _dataset(name: str) -> Dataset:
    dataset = DATASETS.get(name)
    if dataset is None:
        raise HTTPException(404, f"Невідомий датасет: {name}")
    return dataset


def _schema(d: Dataset) -> dict[str, Any]:
    return {
        "name": d.name,
        "title": d.title,
        "description": d.description,
        "row": d.row,
        "key": list(d.key),
        "filterable": d.filterable,
        "columns": [
            {"name": c.name, "type": c.type, "description": c.description} for c in d.columns
        ],
    }


def _filename(name: str, as_of: datetime | None, ext: str) -> str:
    return f"{name}_{as_of:%Y-%m-%d}.{ext}" if as_of else f"{name}.{ext}"


def _variant_query(variant: Variant) -> str:
    """Query string of a non-default variant, for links."""
    params = []
    if variant.coverage != "site":
        params.append(f"coverage={variant.coverage}")
    if not variant.dedup:
        params.append("dedup=false")
    return "?" + "&".join(params) if params else ""


def _file_stem(name: str, variant: Variant) -> str:
    return name if variant == SITE else f"{name}_{variant.slug}"


def attachment(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{filename}"'}


@router.get("")
async def catalog(coverage: Coverage = "site", dedup: bool = True) -> dict[str, Any]:
    """Каталог датасетів для варіанта (охоплення `coverage`: site, vpk, all; `dedup`): опис,
    кількість рядків, дата зрізу, посилання на файли; `overview` — що містить кожне охоплення
    і що прибирає дедуплікація."""
    variant = Variant(coverage=coverage, dedup=dedup)
    q = _variant_query(variant)

    async def load() -> dict[str, Any]:
        as_of, counts = await export.catalog(variant)
        return {
            "as_of": as_of,
            "coverage": coverage,
            "dedup": dedup,
            "coverages": [{"name": k, **v} for k, v in COVERAGES.items()],
            "formats": list(FORMATS),
            "snapshot": {
                "zip": f"/api/export/snapshot.zip{q}",
                "sql": f"/api/export/snapshot.sql{q}",
            },
            "datasets": [
                {
                    **_schema(d),
                    "row_count": counts[d.name],
                    "urls": {fmt: f"/api/export/{d.name}.{fmt}{q}" for fmt in FORMATS},
                    "schema_url": f"/api/export/{d.name}/schema",
                }
                for d in DATASETS.values()
            ],
            "overview": await cache.get_or_load("export_overview", export.overview),
        }

    return await cache.get_or_load(f"export_catalog:{variant.slug}", load)


@router.get("/snapshot.zip")
async def snapshot_zip(coverage: Coverage = "site", dedup: bool = True) -> FileResponse:
    """Повний знімок варіанта: CSV і Parquet усіх датасетів, snapshot.sql, schema.json,
    manifest.json, README.md."""
    variant = Variant(coverage=coverage, dedup=dedup)
    as_of, directory = await snapshots.get(variant)
    return FileResponse(
        directory / "snapshot.zip",
        media_type="application/zip",
        filename=_filename(_file_stem("stayhard_snapshot", variant), as_of, "zip"),
    )


@router.get("/snapshot.sql")
async def snapshot_sql(coverage: Coverage = "site", dedup: bool = True) -> FileResponse:
    """Усі датасети варіанта як SQL-скрипт для PostgreSQL (CREATE TABLE, коментарі, INSERT)."""
    variant = Variant(coverage=coverage, dedup=dedup)
    as_of, directory = await snapshots.get(variant)
    return FileResponse(
        directory / "snapshot.sql",
        media_type="application/sql",
        filename=_filename(_file_stem("stayhard_snapshot", variant), as_of, "sql"),
    )


@router.get("/{name}/schema")
async def schema(name: str) -> dict[str, Any]:
    """Словник полів датасету: назва, тип і опис кожної колонки, ключ запису."""
    return _schema(_dataset(name))


@router.get("/{filename}")
async def download(
    filename: str,
    f: Annotated[VacancyFilter, Depends(filter_params(default_scope="all"))],
    coverage: Coverage = "site",
    dedup: bool = True,
) -> StreamingResponse:
    """Датасет у форматі csv, json, jsonl або parquet, наприклад `vacancies.csv`.

    `coverage` (site — як на сайті, vpk — усі підприємства ВПК, all — уся база) і `dedup`
    (false — з дублями, позначеними duplicate_of / canonical_id) діють для всіх датасетів.
    Фільтри (scope, level, markers, focus, domain, role, employer_id, region_id, category, title,
    q, days, source, experience, schedule, employment, salary_min, salary_max, with_salary)
    застосовуються лише до `vacancies` і мають той самий зміст, що в `/api/vacancies`.
    """
    variant = Variant(coverage=coverage, dedup=dedup)
    name, _, fmt = filename.rpartition(".")
    dataset = _dataset(name)
    if fmt not in FORMATS:
        raise HTTPException(404, f"Невідомий формат: {fmt}. Доступні: {', '.join(FORMATS)}")
    as_of = await export.snapshot_date()
    rows = export.stream_rows(dataset, f, variant)
    stem = _file_stem(name, variant)
    if fmt == "parquet":
        data = await asyncio.to_thread(to_parquet, dataset, [r async for r in rows])
        return Response(data, media_type=PARQUET, headers=attachment(_filename(stem, as_of, fmt)))
    if fmt == "csv":
        body = stream_csv(dataset.columns, rows)
    elif fmt == "jsonl":
        body = stream_jsonl(dataset.columns, rows)
    else:
        header = {
            "dataset": dataset.name,
            "coverage": coverage,
            "dedup": dedup,
            "as_of": as_of,
            "schema_url": f"/api/export/{name}/schema",
        }
        body = stream_json(header, dataset.columns, rows)
    return StreamingResponse(
        body,
        media_type=STREAM_FORMATS[fmt],
        headers=attachment(_filename(stem, as_of, fmt)),
    )
