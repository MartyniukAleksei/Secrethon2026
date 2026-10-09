"""Full data snapshot: Parquet files, a portable SQL script and a ZIP with everything.

A snapshot is built once per data cutoff (`as_of`) into a temporary directory and reused
until the pipeline loads new data; a lock keeps concurrent requests from building it twice.
"""

import asyncio
import hashlib
import io
import json
import shutil
import tempfile
import zipfile
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from app.export_formats import csv_encoder, json_value
from app.repository import export
from app.repository.export import (
    COVERAGES,
    DATASETS,
    SITE,
    Column,
    ColumnType,
    Dataset,
    Row,
    Variant,
)

ARROW_TYPES: dict[ColumnType, pa.DataType] = {
    "int": pa.int64(),
    "float": pa.float64(),
    "text": pa.string(),
    "bool": pa.bool_(),
    "date": pa.date32(),
    "timestamp": pa.timestamp("us", tz="UTC"),
    "text[]": pa.list_(pa.string()),
}

SQL_TYPES: dict[ColumnType, str] = {
    "int": "bigint",
    "float": "double precision",
    "text": "text",
    "bool": "boolean",
    "date": "date",
    "timestamp": "timestamptz",
    "text[]": "text[]",
}

INSERT_BATCH = 500


def arrow_schema(columns: tuple[Column, ...]) -> pa.Schema:
    return pa.schema(
        [
            pa.field(c.name, ARROW_TYPES[c.type], metadata={"description": c.description})
            for c in columns
        ]
    )


def to_parquet(dataset: Dataset, rows: list[Row]) -> bytes:
    schema = arrow_schema(dataset.columns)
    table = pa.Table.from_pylist(rows, schema=schema).replace_schema_metadata(
        {"dataset": dataset.name, "description": dataset.description}
    )
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    return buf.getvalue()


def _quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int | float):
        return repr(value)
    if isinstance(value, datetime | date):
        return _quote(value.isoformat())
    if isinstance(value, list | tuple):
        return "ARRAY[" + ", ".join(sql_literal(v) for v in value) + "]::text[]"
    return _quote(str(value))


def sql_table(dataset: Dataset, rows: list[Row]) -> Iterable[str]:
    """CREATE TABLE with column comments, then INSERT batches (PostgreSQL)."""
    yield f"\n-- {dataset.title}: {dataset.description}\n"
    yield f"DROP TABLE IF EXISTS {dataset.name};\n"
    cols = ",\n".join(f"    {c.name} {SQL_TYPES[c.type]}" for c in dataset.columns)
    yield f"CREATE TABLE {dataset.name} (\n{cols}\n);\n"
    yield f"COMMENT ON TABLE {dataset.name} IS {_quote(dataset.description)};\n"
    for c in dataset.columns:
        yield f"COMMENT ON COLUMN {dataset.name}.{c.name} IS {_quote(c.description)};\n"
    names = ", ".join(c.name for c in dataset.columns)
    for start in range(0, len(rows), INSERT_BATCH):
        values = ",\n".join(
            "(" + ", ".join(sql_literal(r[c.name]) for c in dataset.columns) + ")"
            for r in rows[start : start + INSERT_BATCH]
        )
        yield f"INSERT INTO {dataset.name} ({names}) VALUES\n{values};\n"


def schema_json(as_of: datetime | None, variant: Variant) -> dict[str, Any]:
    return {
        "as_of": json_value(as_of),
        "coverage": variant.coverage,
        "dedup": variant.dedup,
        "datasets": [
            {
                "name": d.name,
                "title": d.title,
                "description": d.description,
                "row": d.row,
                "key": list(d.key),
                "columns": [
                    {"name": c.name, "type": c.type, "description": c.description}
                    for c in d.columns
                ],
            }
            for d in DATASETS.values()
        ],
    }


def readme(as_of: datetime | None, counts: dict[str, int], variant: Variant) -> str:
    coverage = COVERAGES[variant.coverage]
    lines = [
        "# Знімок даних StayHard",
        "",
        f"Дата зрізу: {json_value(as_of)}",
        "",
        f"Охоплення: **{coverage['title']}** (`coverage={variant.coverage}`). "
        + coverage["description"],
        "",
        (
            "Без дублів: кожна вакансія і компанія — один раз."
            if variant.dedup
            else "З дублями (`dedup=false`): повтори вакансій позначено `vacancies.duplicate_of`, "
            "дублі компаній — `companies.canonical_id`."
        ),
        "",
        "Кожен датасет є у форматах CSV (UTF-8 з BOM, масиви через «; »), Parquet (zstd) "
        "і в `snapshot.sql` (PostgreSQL: CREATE TABLE + INSERT, коментарі до колонок).",
        "`schema.json` — словник полів, `manifest.json` — кількість рядків і SHA-256 файлів.",
        "",
        "Зв'язки між датасетами:",
        "- `companies.company_id` ← `company_sanctions`, `company_relations` (обидва кінці; "
        "`both_in_dataset` — чи є в наборі обидва), `company_products`, `company_sources`, "
        "`employers.matched_company_id`, `employer_profiles.company_id`;",
        "- `employers.employer_id` ← `vacancies.employer_id`, `employer_profiles.card_id`;",
        "- `employer_profiles.employer_profile_id` ← `vacancies.employer_profile_id`.",
        "",
    ]
    for d in DATASETS.values():
        lines += [
            f"## {d.name} — {d.title} ({counts[d.name]} рядків; один рядок — {d.row})",
            "",
            d.description,
            "",
        ]
        lines += [f"- `{c.name}` ({c.type}): {c.description}" for c in d.columns]
        lines.append("")
    return "\n".join(lines)


async def fetch_all(variant: Variant = SITE) -> tuple[datetime | None, dict[str, list[Row]]]:
    async with export.snapshot_connection() as conn:
        as_of = await export.as_of(conn)
        data = {
            name: [row async for row in export.stream_in(conn, d, variant=variant)]
            for name, d in DATASETS.items()
        }
    return as_of, data


def write_snapshot(
    directory: Path,
    as_of: datetime | None,
    data: dict[str, list[Row]],
    variant: Variant = SITE,
) -> None:
    """Writes snapshot.sql and snapshot.zip (CSV, Parquet, SQL, schema, manifest, README)."""
    counts = {name: len(rows) for name, rows in data.items()}
    files: dict[str, bytes] = {}
    for name, rows in data.items():
        header, encode = csv_encoder(DATASETS[name].columns)
        files[f"{name}.csv"] = (header + "".join(encode(r) for r in rows)).encode()
        files[f"{name}.parquet"] = to_parquet(DATASETS[name], rows)
    sql = [
        f"-- Знімок даних StayHard, дата зрізу {json_value(as_of)}, "
        f"coverage={variant.coverage}, dedup={str(variant.dedup).lower()}\n",
        "BEGIN;\n",
        *(part for name, rows in data.items() for part in sql_table(DATASETS[name], rows)),
        "COMMIT;\n",
    ]
    files["snapshot.sql"] = "".join(sql).encode()
    (directory / "snapshot.sql").write_bytes(files["snapshot.sql"])
    files["schema.json"] = json.dumps(
        schema_json(as_of, variant), ensure_ascii=False, indent=2
    ).encode()
    files["README.md"] = readme(as_of, counts, variant).encode()
    manifest = {
        "as_of": json_value(as_of),
        "coverage": variant.coverage,
        "dedup": variant.dedup,
        "generated_at": datetime.now(UTC).isoformat(),
        "datasets": counts,
        "files": {
            path: {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
            for path, body in files.items()
        },
    }
    files["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    with zipfile.ZipFile(directory / "snapshot.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        for path, body in files.items():
            # Parquet is already compressed.
            kind = zipfile.ZIP_STORED if path.endswith(".parquet") else zipfile.ZIP_DEFLATED
            zf.writestr(path, body, compress_type=kind)


class SnapshotStore:
    """One built snapshot per variant (coverage × dedup), rebuilt when the cutoff changes."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._built: dict[Variant, tuple[datetime | None, Path]] = {}
        self._stale: set[Variant] = set()

    def invalidate(self) -> None:
        """Rebuild on the next request (human reviews change data within one cutoff)."""
        self._stale = set(self._built)

    async def get(self, variant: Variant = SITE) -> tuple[datetime | None, Path]:
        """Directory with snapshot.zip and snapshot.sql of a variant for the current cutoff."""
        current = await export.snapshot_date()
        async with self._lock:
            built = self._built.get(variant)
            if built is None or built[0] != current or variant in self._stale:
                self._stale.discard(variant)
                as_of, data = await fetch_all(variant)
                directory = Path(tempfile.mkdtemp(prefix=f"export-snapshot-{variant.slug}-"))
                await asyncio.to_thread(write_snapshot, directory, as_of, data, variant)
                if built is not None:
                    shutil.rmtree(built[1], ignore_errors=True)
                built = (as_of, directory)
                self._built[variant] = built
            return built

    def clear(self) -> None:
        for _, directory in self._built.values():
            shutil.rmtree(directory, ignore_errors=True)
        self._built.clear()
        self._stale.clear()


snapshots = SnapshotStore()
