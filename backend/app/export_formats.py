"""Streaming serializers for export datasets: CSV, JSON and JSON Lines."""

import csv
import io
import json
from collections.abc import AsyncIterator, Callable, Iterable
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from app.repository.export import Column

# Excel only reads UTF-8 (and so Cyrillic) correctly when the file starts with a BOM.
BOM = "\ufeff"
ARRAY_SEPARATOR = "; "


def json_value(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def csv_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list | tuple):
        return ARRAY_SEPARATOR.join(str(v) for v in value if v is not None)
    return json_value(value)


def csv_encoder(columns: Iterable[Column]) -> tuple[str, Callable[[dict[str, Any]], str]]:
    """CSV header (with BOM) and a function that encodes one row as a CSV line."""
    names = [c.name for c in columns]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")

    def line(values: list[Any]) -> str:
        buf.seek(0)
        buf.truncate()
        writer.writerow(values)
        return buf.getvalue()

    return BOM + line(names), lambda row: line([csv_value(row[n]) for n in names])


async def stream_csv(columns: tuple[Column, ...], rows: AsyncIterator[dict]) -> AsyncIterator[str]:
    header, encode = csv_encoder(columns)
    chunk = [header]
    async for row in rows:
        chunk.append(encode(row))
        if len(chunk) >= 500:
            yield "".join(chunk)
            chunk = []
    yield "".join(chunk)


def _json_row(columns: tuple[Column, ...], row: dict) -> str:
    return json.dumps({c.name: json_value(row[c.name]) for c in columns}, ensure_ascii=False)


async def stream_jsonl(
    columns: tuple[Column, ...], rows: AsyncIterator[dict]
) -> AsyncIterator[str]:
    chunk: list[str] = []
    async for row in rows:
        chunk.append(_json_row(columns, row) + "\n")
        if len(chunk) >= 500:
            yield "".join(chunk)
            chunk = []
    yield "".join(chunk)


async def stream_json(
    header: dict[str, Any], columns: tuple[Column, ...], rows: AsyncIterator[dict]
) -> AsyncIterator[str]:
    """`{...header, "items": [...]}` written incrementally."""
    head = json.dumps(header, ensure_ascii=False, default=json_value)
    yield head[:-1] + ', "items": ['
    first = True
    chunk: list[str] = []
    async for row in rows:
        chunk.append(("" if first else ",\n") + _json_row(columns, row))
        first = False
        if len(chunk) >= 500:
            yield "".join(chunk)
            chunk = []
    chunk.append("]}\n")
    yield "".join(chunk)
