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
from app.repository.export import DATASETS, Column, ColumnType, Dataset, Row

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


def schema_json(as_of: datetime | None) -> dict[str, Any]:
    return {
        "as_of": json_value(as_of),
        "datasets": [
            {
                "name": d.name,
                "title": d.title,
                "description": d.description,
                "key": list(d.key),
                "columns": [
                    {"name": c.name, "type": c.type, "description": c.description}
                    for c in d.columns
                ],
            }
            for d in DATASETS.values()
        ],
    }


def readme(as_of: datetime | None, counts: dict[str, int]) -> str:
    lines = [
        "# Знімок даних StayHard",
        "",
        f"Дата зрізу: {json_value(as_of)}",
        "",
        "Кожен датасет є у форматах CSV (UTF-8 з BOM, масиви через «; »), Parquet (zstd) "
        "і в `snapshot.sql` (PostgreSQL: CREATE TABLE + INSERT, коментарі до колонок).",
        "`schema.json` — словник полів, `manifest.json` — кількість рядків і SHA-256 файлів.",
        "",
        "Зв'язки між датасетами:",
        "- `companies.company_id` ← `company_sanctions`, `company_relations` (обидва кінці), "
        "`company_products`, `company_sources`, `employers.matched_company_id`;",
        "- `employers.employer_id` ← `vacancies.employer_id`.",
        "",
    ]
    for d in DATASETS.values():
        lines += [f"## {d.name} — {d.title} ({counts[d.name]} рядків)", "", d.description, ""]
        lines += [f"- `{c.name}` ({c.type}): {c.description}" for c in d.columns]
        lines.append("")
    return "\n".join(lines)


async def fetch_all() -> tuple[datetime | None, dict[str, list[Row]]]:
    async with export.snapshot_connection() as conn:
        as_of = await export.as_of(conn)
        data = {
            name: [row async for row in export.stream_in(conn, d)] for name, d in DATASETS.items()
        }
    return as_of, data


def write_snapshot(directory: Path, as_of: datetime | None, data: dict[str, list[Row]]) -> None:
    """Writes snapshot.sql and snapshot.zip (CSV, Parquet, SQL, schema, manifest, README)."""
    counts = {name: len(rows) for name, rows in data.items()}
    files: dict[str, bytes] = {}
    for name, rows in data.items():
        header, encode = csv_encoder(DATASETS[name].columns)
        files[f"{name}.csv"] = (header + "".join(encode(r) for r in rows)).encode()
        files[f"{name}.parquet"] = to_parquet(DATASETS[name], rows)
    sql = [
        f"-- Знімок даних StayHard, дата зрізу {json_value(as_of)}\n",
        "BEGIN;\n",
        *(part for name, rows in data.items() for part in sql_table(DATASETS[name], rows)),
        "COMMIT;\n",
    ]
    files["snapshot.sql"] = "".join(sql).encode()
    (directory / "snapshot.sql").write_bytes(files["snapshot.sql"])
    files["schema.json"] = json.dumps(schema_json(as_of), ensure_ascii=False, indent=2).encode()
    files["README.md"] = readme(as_of, counts).encode()
    manifest = {
        "as_of": json_value(as_of),
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
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._as_of: datetime | None = None
        self._dir: Path | None = None

    async def get(self) -> tuple[datetime | None, Path]:
        """Directory with snapshot.zip and snapshot.sql for the current data cutoff."""
        current = await export.snapshot_date()
        async with self._lock:
            if self._dir is None or self._as_of != current:
                as_of, data = await fetch_all()
                directory = Path(tempfile.mkdtemp(prefix="export-snapshot-"))
                await asyncio.to_thread(write_snapshot, directory, as_of, data)
                if self._dir is not None:
                    shutil.rmtree(self._dir, ignore_errors=True)
                self._as_of, self._dir = as_of, directory
            return self._as_of, self._dir

    def clear(self) -> None:
        if self._dir is not None:
            shutil.rmtree(self._dir, ignore_errors=True)
        self._as_of, self._dir = None, None


snapshots = SnapshotStore()
