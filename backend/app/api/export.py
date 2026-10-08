import asyncio
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.export_formats import stream_csv, stream_json, stream_jsonl
from app.export_snapshot import snapshots, to_parquet
from app.repository import export
from app.repository.cache import cache
from app.repository.export import DATASETS, Dataset
from app.repository.vacancies import LevelFilter, VacancyFilter

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
        "key": list(d.key),
        "filterable": d.filterable,
        "columns": [
            {"name": c.name, "type": c.type, "description": c.description} for c in d.columns
        ],
    }


def _filename(name: str, as_of: datetime | None, ext: str) -> str:
    return f"{name}_{as_of:%Y-%m-%d}.{ext}" if as_of else f"{name}.{ext}"


def attachment(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{filename}"'}


@router.get("")
async def catalog() -> dict[str, Any]:
    """Каталог датасетів: опис, кількість рядків, дата зрізу та посилання на файли."""

    async def load() -> dict[str, Any]:
        as_of, counts = await export.catalog()
        return {
            "as_of": as_of,
            "formats": list(FORMATS),
            "snapshot": {"zip": "/api/export/snapshot.zip", "sql": "/api/export/snapshot.sql"},
            "datasets": [
                {
                    **_schema(d),
                    "row_count": counts[d.name],
                    "urls": {fmt: f"/api/export/{d.name}.{fmt}" for fmt in FORMATS},
                    "schema_url": f"/api/export/{d.name}/schema",
                }
                for d in DATASETS.values()
            ],
        }

    return await cache.get_or_load("export_catalog", load)


@router.get("/snapshot.zip")
async def snapshot_zip() -> FileResponse:
    """Повний знімок: CSV і Parquet усіх датасетів, snapshot.sql, schema.json, manifest.json."""
    as_of, directory = await snapshots.get()
    return FileResponse(
        directory / "snapshot.zip",
        media_type="application/zip",
        filename=_filename("stayhard_snapshot", as_of, "zip"),
    )


@router.get("/snapshot.sql")
async def snapshot_sql() -> FileResponse:
    """Усі датасети як SQL-скрипт для PostgreSQL (CREATE TABLE, коментарі до колонок, INSERT)."""
    as_of, directory = await snapshots.get()
    return FileResponse(
        directory / "snapshot.sql",
        media_type="application/sql",
        filename=_filename("stayhard_snapshot", as_of, "sql"),
    )


@router.get("/{name}/schema")
async def schema(name: str) -> dict[str, Any]:
    """Словник полів датасету: назва, тип і опис кожної колонки, ключ запису."""
    return _schema(_dataset(name))


@router.get("/{filename}")
async def download(
    filename: str,
    level: LevelFilter = "all",
    employer_id: int | None = None,
    region_id: int | None = None,
    category: str | None = None,
    title: str | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
) -> StreamingResponse:
    """Датасет у форматі csv, json, jsonl або parquet, наприклад `vacancies.csv`.

    Фільтри (level, employer_id, region_id, category, title, q, days) застосовуються лише
    до `vacancies` і мають той самий зміст, що в `/api/vacancies`; без фільтрів — усі активні.
    """
    name, _, fmt = filename.rpartition(".")
    dataset = _dataset(name)
    if fmt not in FORMATS:
        raise HTTPException(404, f"Невідомий формат: {fmt}. Доступні: {', '.join(FORMATS)}")
    f = VacancyFilter(
        level, employer_id, region_id, category, title, (q or "").strip() or None, days
    )
    as_of = await export.snapshot_date()
    rows = export.stream_rows(dataset, f)
    if fmt == "parquet":
        data = await asyncio.to_thread(to_parquet, dataset, [r async for r in rows])
        return Response(data, media_type=PARQUET, headers=attachment(_filename(name, as_of, fmt)))
    if fmt == "csv":
        body = stream_csv(dataset.columns, rows)
    elif fmt == "jsonl":
        body = stream_jsonl(dataset.columns, rows)
    else:
        header = {
            "dataset": dataset.name,
            "as_of": as_of,
            "schema_url": f"/api/export/{name}/schema",
        }
        body = stream_json(header, dataset.columns, rows)
    return StreamingResponse(
        body,
        media_type=STREAM_FORMATS[fmt],
        headers=attachment(_filename(name, as_of, fmt)),
    )
