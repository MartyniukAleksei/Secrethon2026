"""Read-only JEV pilot (or full export). Writes only local JSONL, CSV and review reports.

From backend: .venv/Scripts/python scripts/classify_vacancies.py --help
API reference: https://docs.typesafe.ai/api
"""

import argparse
import asyncio
import csv
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent_provider import ProviderError  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.repository.sql import CLASSIFICATION_SELECT  # noqa: E402
from app.vacancy_labeling import (  # noqa: E402
    PROMPT_VERSION,
    evaluate,
    fingerprint,
    parse_decisions,
    questions,
    vacancy_state,
)

ROOT = Path(__file__).resolve().parents[2]


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--company-ids", type=int, nargs="+", default=None)
    scope.add_argument(
        "--all", action="store_true", help="All raw vacancies, active/inactive, copies included"
    )
    parser.add_argument(
        "--full-company",
        action="store_true",
        help="All active unique vacancies of --company-ids, without title sampling",
    )
    parser.add_argument(
        "--per-company",
        type=int,
        default=40,
        help="Pilot: 8 most common titles, then reproducible diverse titles",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Optional hard cap on API input records"
    )
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.75,
        help="Provisional review threshold; not validated accuracy",
    )
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument(
        "--export-only", action="store_true", help="Read DB and export input; no JEV calls"
    )
    args = parser.parse_args()
    if args.full_company and (args.all or not args.company_ids):
        parser.error("--full-company requires --company-ids and cannot be combined with --all")
    if (
        args.per_company < 1
        or not 1 <= args.concurrency <= 8
        or not 0 <= args.confidence <= 1
        or (args.limit is not None and args.limit < 1)
        or any(i <= 0 for i in (args.company_ids or []))
    ):
        parser.error("Invalid limits or company IDs")
    args.company_ids = args.company_ids or [4064, 3263, 2054, 5206]
    args.output = args.output or ROOT / "reports" / "jev-vacancy-pilot"
    return args


async def load_inputs(args):
    async with SessionLocal() as session:
        await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        if args.all:
            await session.execute(text("SET LOCAL statement_timeout = '180s'"))
        readonly = (await session.execute(text("SHOW transaction_read_only"))).scalar_one()
        if readonly != "on":
            raise ValueError("Refusing a database connection without read-only mode")
        inventory = dict(
            (
                await session.execute(
                    text("""
            SELECT count(*) AS total, count(*) FILTER (WHERE is_active) AS active,
                   count(DISTINCT title) AS distinct_titles, max(last_seen_at) AS as_of
            FROM vacancy
        """)
                )
            )
            .mappings()
            .one()
        )
        unique = (
            await session.execute(text("SELECT count(*) FROM vacancy_unique WHERE is_active"))
        ).scalar_one()
        inventory["unique_active"] = unique
        domains = (
            (
                await session.execute(
                    text("""
            SELECT DISTINCT direction_domain FROM company_classification
            WHERE direction_domain IS NOT NULL ORDER BY direction_domain
        """)
                )
            )
            .scalars()
            .all()
        )
        roles = (
            (
                await session.execute(
                    text("""
            SELECT DISTINCT direction_role FROM company_classification
            WHERE direction_role IS NOT NULL ORDER BY direction_role
        """)
                )
            )
            .scalars()
            .all()
        )
        question_set = questions(domains, roles)
        where = "TRUE" if args.all else "v.is_active AND g.group_id = ANY(:ids)"
        table = "vacancy" if args.all else "vacancy_unique"
        # The existing labels are exported for comparison only, never fed to JEV.
        full_records = args.all or args.full_company
        sql = f"""WITH cls AS ({CLASSIFICATION_SELECT}), records AS (
            SELECT v.*, g.group_id AS card_id, g.company_id,
                   coalesce(ep.name, v.employer_name, 'Невідомо') AS company_name,
                   cls.direction_domain AS old_domain, cls.direction_role AS old_role,
                   count(*) OVER (PARTITION BY g.group_id,v.title) AS title_active_count,
                   row_number() OVER (PARTITION BY g.group_id,v.title ORDER BY
                       length(coalesce(v.description,'')) + length(coalesce(v.responsibilities,''))
                       DESC,v.vacancy_id) AS title_row
            FROM {table} v LEFT JOIN employer_group g USING (employer_profile_id)
            LEFT JOIN employer_profile ep ON ep.employer_profile_id = g.group_id
            LEFT JOIN cls ON cls.company_id = g.company_id
            WHERE {where}
        ), representatives AS (
            SELECT *, row_number() OVER (
                PARTITION BY card_id ORDER BY title_active_count DESC,title)
                      AS common_rank FROM records WHERE title_row=1
        ), ranked AS (
            SELECT *, row_number() OVER (PARTITION BY card_id ORDER BY
                CASE WHEN common_rank <= 8 THEN 0 ELSE 1 END,
                CASE WHEN common_rank <= 8 THEN common_rank END,
                md5(title || 'jev-pilot-v1'),vacancy_id) AS sample_rank
            FROM representatives
        ) SELECT * FROM {"records" if full_records else "ranked"}
          {"" if full_records else "WHERE sample_rank <= :per_company"}
          ORDER BY card_id,vacancy_id {"LIMIT :limit" if args.limit else ""}
        """
        params = {"ids": args.company_ids, "per_company": args.per_company}
        if args.limit:
            params["limit"] = args.limit
        if args.all:
            # A full export does not need title ranking or sorting large HTML descriptions.
            sql = f"""WITH cls AS ({CLASSIFICATION_SELECT})
                SELECT v.vacancy_id, v.title, v.url, v.source, v.is_active,
                       v.description, v.responsibilities, v.requirements,
                       v.profession, v.specialisation,
                       coalesce(g.group_id, v.employer_profile_id) AS card_id, g.company_id,
                       coalesce(ep.name, v.employer_name, 'Невідомо') AS company_name,
                       cls.direction_domain AS old_domain, cls.direction_role AS old_role
                FROM vacancy v LEFT JOIN employer_group g USING (employer_profile_id)
                LEFT JOIN employer_profile ep ON ep.employer_profile_id = g.group_id
                LEFT JOIN cls ON cls.company_id = g.company_id
                ORDER BY v.vacancy_id {"LIMIT :limit" if args.limit else ""}"""
        rows = [dict(row) for row in (await session.execute(text(sql), params)).mappings()]
        if args.all:
            counts = Counter((row["card_id"], row["title"]) for row in rows)
            for row in rows:
                row["title_active_count"] = counts[row["card_id"], row["title"]]
            if not args.limit and (
                len(rows) != inventory["total"]
                or len({row["vacancy_id"] for row in rows}) != inventory["total"]
            ):
                raise ValueError("All-vacancy export does not match the database inventory")
        companies = []
        if not args.all:
            companies = [
                dict(row)
                for row in (
                    await session.execute(
                        text("""
                SELECT g.group_id AS card_id, ep.name AS name, count(*) AS unique_active,
                       count(DISTINCT v.title) AS distinct_titles
                FROM vacancy_unique v JOIN employer_group g USING (employer_profile_id)
                JOIN employer_profile ep ON ep.employer_profile_id=g.group_id
                WHERE v.is_active AND g.group_id=ANY(:ids)
                GROUP BY 1,2 ORDER BY 1
            """),
                        {"ids": args.company_ids},
                    )
                ).mappings()
            ]
            if set(args.company_ids) != {row["card_id"] for row in companies}:
                raise ValueError("A requested company has no active unique vacancies; check IDs")
            if args.full_company and not args.limit:
                expected = sum(company["unique_active"] for company in companies)
                if len(rows) != expected or len({row["vacancy_id"] for row in rows}) != expected:
                    raise ValueError("Full-company export does not match the vacancy inventory")
        return rows, question_set, inventory, companies


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def csv_export(path, rows):
    columns = [
        "vacancy_id",
        "card_id",
        "company_name",
        "title",
        "url",
        "old_domain",
        "domain",
        "domain_confidence",
        "domain_probability",
        "old_role",
        "role",
        "role_confidence",
        "review",
        "status",
        "title_active_count",
        "truncated_fields",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            out = {key: row.get(key, "") for key in columns}
            for dimension in ("domain", "role"):
                decision = row.get("decisions", {}).get(dimension, {})
                out[dimension] = decision.get("choice", "")
                out[f"{dimension}_confidence"] = decision.get("confidence", "")
                if dimension == "domain":
                    out["domain_probability"] = decision.get("probability", "")
            # Public vacancy content can still start with spreadsheet formula characters.
            for key, value in out.items():
                if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
                    out[key] = "'" + value
            writer.writerow(out)


async def run(args):
    rows, question_set, inventory, companies = await load_inputs(args)
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "started_at": datetime.now(UTC).isoformat(),
        "scope": "all_raw" if args.all else "company_full_active" if args.full_company else "pilot",
        "limit": args.limit,
        "read_only": True,
        "database_inventory": inventory,
        "companies": companies,
        "selected": len(rows),
        "per_company": args.per_company,
        "threshold": args.confidence,
        "model_requested": settings.jev_model,
        "prompt_version": PROMPT_VERSION,
        "sampling": (
            "All raw vacancy records, including inactive records and copies; "
            "optional limit applies."
            if args.all
            else "All active unique vacancies of the selected companies; no title sampling."
            if args.full_company
            else "One vacancy per title: top 8 frequent titles plus fixed-hash diverse titles. "
            "Unweighted sample; shares do not estimate the whole company."
        ),
        "taxonomy_source": "DISTINCT company_classification.direction_domain/direction_role",
        "questions": question_set,
        "provider_docs": "https://docs.typesafe.ai/api",
    }
    write_json(args.output / "manifest.json", manifest)
    inputs = []
    for row in rows:
        state, truncated = vacancy_state(row)
        inputs.append(
            {
                key: row.get(key)
                for key in (
                    "vacancy_id",
                    "card_id",
                    "company_name",
                    "title",
                    "url",
                    "old_domain",
                    "old_role",
                    "title_active_count",
                    "is_active",
                    "source",
                )
            }
            | {
                "state": state,
                "truncated_fields": truncated,
                "fingerprint": fingerprint(state, question_set, settings.jev_model),
            }
        )
    with (args.output / "inputs.jsonl").open("w", encoding="utf-8") as file:
        for row in inputs:
            file.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
    print(f"Read-only export: {len(inputs)} vacancies; total DB: {inventory['total']}", flush=True)
    if args.export_only:
        return 0
    if not settings.jev_api_key:
        raise ValueError("JEV_API_KEY is not configured")
    results_path = args.output / "results.jsonl"
    cache = {}
    if results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                if record.get("status") == "ok":
                    cache[record["fingerprint"]] = record
    semaphore = asyncio.Semaphore(args.concurrency)
    completed, api_calls, reused = 0, 0, 0
    live_token_usage = Counter()
    results, pending = [], {}

    async def request(state):
        response = await evaluate(state, question_set)
        live_token_usage.update(response.get("usage", {}))
        return response

    async def classify(row):
        nonlocal completed, api_calls, reused
        async with semaphore:
            key = row["fingerprint"]
            if key in cache:
                previous = cache[key]
                decisions = parse_decisions(previous["response"], question_set, args.confidence)
                record = {
                    **row,
                    "status": "ok",
                    "decisions": decisions,
                    "response": previous["response"],
                    "review": any(d["review"] for d in decisions.values()),
                }
                reused += 1
            else:
                try:
                    # Share only exact identical input/criteria; different descriptions are
                    # never labelled merely because their titles or employers match.
                    if key not in pending:
                        api_calls += 1
                        pending[key] = asyncio.create_task(request(row["state"]))
                    else:
                        reused += 1
                    response = await pending[key]
                    decisions = parse_decisions(response, question_set, args.confidence)
                    record = {
                        **row,
                        "status": "ok",
                        "decisions": decisions,
                        "response": response,
                        "review": any(d["review"] for d in decisions.values()),
                    }
                    cache[key] = record
                except (ProviderError, ValueError) as exc:
                    record = {
                        **row,
                        "status": "error",
                        "review": True,
                        "error_type": type(exc).__name__,
                        "http_status": getattr(exc, "status", None),
                    }
            with results_path.open("a", encoding="utf-8") as file:
                file.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
            completed += 1
            results.append(record)
            if completed % 10 == 0 or completed == len(inputs):
                print(
                    f"Completed {completed}/{len(inputs)}; "
                    f"errors {sum(r['status'] == 'error' for r in results)}",
                    flush=True,
                )

    await asyncio.gather(*(classify(row) for row in inputs))
    results.sort(key=lambda row: (row["card_id"] or 0, row["vacancy_id"]))
    write_json(args.output / "results.json", results)
    csv_export(args.output / "vacancies.csv", results)
    manifest.update(
        {
            "finished_at": datetime.now(UTC).isoformat(),
            "api_calls": api_calls,
            "reused": reused,
            "success": sum(r["status"] == "ok" for r in results),
            "errors": sum(r["status"] == "error" for r in results),
            "review": sum(r["review"] for r in results),
            "models_returned": sorted(
                {r["response"]["model"] for r in results if r["status"] == "ok"}
            ),
            "api_token_usage": dict(live_token_usage),
            "result_token_usage_including_cached": dict(
                Counter(
                    {
                        key: sum(
                            r.get("response", {}).get("usage", {}).get(key, 0) for r in results
                        )
                        for key in ("input_tokens", "output_tokens")
                    }
                )
            ),
        }
    )
    write_json(args.output / "manifest.json", manifest)
    from app.vacancy_label_report import write_report

    write_report(args.output, manifest, results)
    print(
        f"Report: {args.output / 'index.html'}; "
        f"success={manifest['success']}, errors={manifest['errors']}",
        flush=True,
    )
    return 1 if manifest["errors"] else 0


async def main():
    try:
        return await run(arguments())
    except Exception as exc:
        # Exception messages may include DB URLs or provider bodies. Never log them.
        original = getattr(exc, "orig", exc)
        print(
            f"Dry run stopped: {type(exc).__name__}; "
            f"cause={type(original).__name__}; sqlstate={getattr(original, 'sqlstate', None)}; "
            "no database writes.",
            file=sys.stderr,
        )
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
