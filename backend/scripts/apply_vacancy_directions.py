"""Publish a validated complete JEV run without replacing employer or VPK classifications.

--prepare creates empty direction tables and a local backup of existing classifications.
--apply validates current vacancy texts, copies new labels, and publishes in one transaction.
--withdraw-run hides a published run while retaining its rows for audit.
"""

import argparse
import asyncio
import gzip
import hashlib
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.vacancy_all_report import write_summary  # noqa: E402
from app.vacancy_labeling import fingerprint, parse_decisions, vacancy_state  # noqa: E402
from scripts.classify_all_vacancies import records  # noqa: E402
from scripts.classify_vacancies import write_json  # noqa: E402
from scripts.export_vpk_inputs import VPK_IDS_SQL  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DDL = (ROOT / "db/vacancy_directions.sql").read_text(encoding="utf-8")


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def validate_labels(manifest, inputs, labels, responses):
    if manifest.get("scope") not in {"all_raw", "vpk_active_unique"} or manifest.get("limit"):
        raise ValueError("Only complete raw or VPK exports may be published")
    expected = manifest.get("scope_count", manifest["database_inventory"]["total"])
    ids = {r["vacancy_id"] for r in inputs}
    output_ids = {r["vacancy_id"] for r in labels}
    if (
        len(ids) != expected
        or len(inputs) != expected
        or len(labels) != expected
        or ids != output_ids
    ):
        raise ValueError("Incomplete coverage or duplicate IDs")
    if manifest.get("errors") != 0 or manifest.get("success") != expected:
        raise ValueError("Refusing to publish errors or incomplete results")
    input_by_id = {r["vacancy_id"]: r for r in inputs}
    questions = manifest["questions"]
    for row in labels:
        source = input_by_id[row["vacancy_id"]]
        key = fingerprint(source["state"], questions, manifest["model_requested"])
        if row.get("status") != "ok" or row["fingerprint"] != key or source["fingerprint"] != key:
            raise ValueError("Invalid input/label fingerprint or unsuccessful result")
        response = responses[key]
        decisions = parse_decisions(response, questions, manifest["threshold"])
        if decisions != row["decisions"] or response["model"] != row["model"]:
            raise ValueError("Stored label does not match validated provider response")
        if row["review"] != any(d["review"] for d in decisions.values()):
            raise ValueError("Invalid review flag")
    return input_by_id


async def backup(conn, output):
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    directory = output / "backups" / stamp
    directory.mkdir(parents=True, exist_ok=False)
    queries = {
        "vacancy_classification": "SELECT * FROM public.vacancy_classification",
        "company_classification": "SELECT run_id,company_id,vpk_category,vpk_probability,"
        "vpk_level,decided_by,direction_domain,direction_role,direction_probability,"
        "direction_label,direction_secondary FROM public.company_classification",
    }
    if await conn.fetchval("SELECT to_regclass('public.vacancy_direction')"):
        queries["vacancy_direction"] = "SELECT * FROM public.vacancy_direction"
        queries["vacancy_direction_run"] = "SELECT * FROM public.vacancy_direction_run"
    counts = {}
    for name, query in queries.items():
        count = 0
        with gzip.open(directory / f"{name}.jsonl.gz", "wt", encoding="utf-8") as file:
            async for row in conn.cursor(query, prefetch=1000):
                file.write(json.dumps(dict(row), ensure_ascii=False, default=str) + "\n")
                count += 1
        counts[name] = count
    write_json(
        directory / "manifest.json",
        {
            "created_at": stamp,
            "counts": counts,
            "sha256": {p.name: sha256_file(p) for p in directory.glob("*.gz")},
        },
    )
    print(f"Backup saved: {directory}; rows {counts}", flush=True)
    return str(directory)


async def apply(conn, args):
    manifest = json.loads((args.source / "manifest.json").read_text(encoding="utf-8"))
    inputs = list(records(args.source / "inputs.jsonl"))
    labels = list(records(args.source / "labels.jsonl"))
    responses = {
        r["fingerprint"]: r["response"]
        for r in records(args.source / "responses.jsonl")
        if r.get("status") == "ok"
    }
    input_by_id = validate_labels(manifest, inputs, labels, responses)
    source_sha = sha256_file(args.source / "labels.jsonl")
    existing = await conn.fetchrow(
        "SELECT run_id,status FROM public.vacancy_direction_run WHERE source_sha256=$1 "
        "ORDER BY created_at DESC LIMIT 1",
        source_sha,
    )
    if existing and existing["status"] == "published":
        print(f"Already published: {existing['run_id']}", flush=True)
        return
    run_id = uuid.uuid4()
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(20261009, 2)")
        await conn.execute("SET LOCAL lock_timeout='15s'")
        # Prevent input edits/removals only for the final validation/copy transaction.
        await conn.execute("LOCK TABLE public.vacancy IN SHARE MODE")
        if manifest["scope"] == "vpk_active_unique":
            await conn.execute(
                "LOCK TABLE public.vacancy_classification, "
                "public.classifier_run, public.vacancy_duplicate IN SHARE MODE"
            )
        current_ids = set()
        changed = []
        if manifest["scope"] == "vpk_active_unique":
            eligible_ids = {r["vacancy_id"] for r in await conn.fetch(VPK_IDS_SQL)}
            if eligible_ids != set(input_by_id):
                raise ValueError("Eligible VPK vacancy IDs changed since export")
        query = (
            "SELECT vacancy_id,title,description,responsibilities,requirements,"
            "profession,specialisation FROM public.vacancy ORDER BY vacancy_id"
        )
        if manifest["scope"] == "vpk_active_unique":
            query = query.replace(
                "ORDER BY vacancy_id", "WHERE vacancy_id=ANY($1) ORDER BY vacancy_id"
            )
        query_args = [list(input_by_id)] if manifest["scope"] == "vpk_active_unique" else []
        async for row in conn.cursor(query, *query_args, prefetch=500):
            ident = row["vacancy_id"]
            current_ids.add(ident)
            original = input_by_id.get(ident)
            state, _ = vacancy_state(dict(row))
            if original is None or state != original["state"]:
                changed.append(ident)
        if current_ids != set(input_by_id) or changed:
            write_json(
                args.source / "stale_inputs.json",
                {
                    "changed_or_new_ids": changed,
                    "removed_ids": sorted(set(input_by_id) - current_ids),
                },
            )
            raise ValueError("Vacancy texts or inventory changed; refresh classification first")
        before_counts = dict(
            await conn.fetchrow(
                "SELECT (SELECT count(*) FROM vacancy_classification) AS vacancy_classification,"
                "(SELECT count(*) FROM company_classification) AS company_classification"
            )
        )
        await conn.execute(
            "INSERT INTO public.vacancy_direction_run "
            "(run_id,status,model_requested,models_returned,prompt_version,input_count,"
            "source_sha256,metadata) VALUES ($1,'staging',$2,$3,$4,$5,$6,$7::jsonb)",
            run_id,
            manifest["model_requested"],
            manifest["models_returned"],
            manifest["prompt_version"],
            len(labels),
            source_sha,
            json.dumps(
                {
                    "questions": manifest["questions"],
                    "threshold": manifest["threshold"],
                    "database_inventory": manifest["database_inventory"],
                    "source_started_at": manifest["started_at"],
                    "scope": manifest["scope"],
                }
            ),
        )
        columns = (
            "run_id",
            "vacancy_id",
            "domain",
            "role",
            "domain_confidence",
            "role_confidence",
            "review",
            "model",
            "input_fingerprint",
            "decisions",
        )
        payload = [
            (
                run_id,
                r["vacancy_id"],
                r["decisions"]["domain"]["choice"],
                r["decisions"]["role"]["choice"],
                r["decisions"]["domain"]["confidence"],
                r["decisions"]["role"]["confidence"],
                r["review"],
                r["model"],
                r["fingerprint"],
                json.dumps(r["decisions"]),
            )
            for r in labels
        ]
        await conn.copy_records_to_table(
            "vacancy_direction", schema_name="public", columns=columns, records=payload
        )
        count = await conn.fetchval(
            "SELECT count(*) FROM public.vacancy_direction WHERE run_id=$1", run_id
        )
        if count != len(labels):
            raise ValueError("Imported count does not match expected coverage")
        await conn.execute(
            "UPDATE public.vacancy_direction_run "
            "SET status='published',published_at=now() WHERE run_id=$1",
            run_id,
        )
        visible = await conn.fetchval("SELECT count(*) FROM public.vacancy_direction_latest")
        after_counts = dict(
            await conn.fetchrow(
                "SELECT (SELECT count(*) FROM vacancy_classification) AS vacancy_classification,"
                "(SELECT count(*) FROM company_classification) AS company_classification"
            )
        )
        if visible != len(labels) or before_counts != after_counts:
            raise ValueError("Publication coverage or existing classifications changed")
    receipt = {
        "scope": manifest["scope"],
        "run_id": str(run_id),
        "published_at": datetime.now(UTC).isoformat(),
        "imported": count,
        "source_sha256": source_sha,
        "prior_classification_counts_unchanged": before_counts == after_counts,
        "withdraw_command": f".venv/Scripts/python.exe scripts/apply_vacancy_directions.py "
        f"--withdraw-run {run_id}",
    }
    write_json(args.source / "import_receipt.json", receipt)
    write_summary(args.source, manifest, labels, receipt)
    progress_path = args.source / "progress.json"
    if progress_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        progress.update(
            database_written=True,
            imported=count,
            run_id=str(run_id),
            updated_at=datetime.now(UTC).isoformat(),
        )
        write_json(progress_path, progress)
    print(json.dumps(receipt), flush=True)


async def run(args):
    conn = await asyncpg.connect(
        settings.database_url.replace("postgresql+asyncpg://", "postgresql://"),
        timeout=20,
        server_settings={
            "statement_timeout": "300000",
            "application_name": "jev-vacancy-publication",
        },
    )
    try:
        if args.prepare:
            async with conn.transaction(isolation="repeatable_read"):
                await backup(conn, args.source)
                await conn.execute(DDL)
            print("Direction schema ready; no labels published.", flush=True)
        elif args.withdraw_run:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(20261009, 2)")
                result = await conn.execute(
                    "UPDATE public.vacancy_direction_run "
                    "SET status='withdrawn' WHERE run_id=$1 AND status='published'",
                    uuid.UUID(args.withdraw_run),
                )
                print(result, flush=True)
        else:
            await apply(conn, args)
    finally:
        await conn.close()


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("../reports/jev-vpk"))
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--apply", action="store_true")
    action.add_argument("--withdraw-run")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        asyncio.run(run(arguments()))
    except Exception as exc:
        original = getattr(exc, "orig", exc)
        print(
            f"Publication stopped: {type(exc).__name__}; "
            f"sqlstate={getattr(original, 'sqlstate', None)}; "
            "check the publication receipt and run status before retrying.",
            file=sys.stderr,
        )
        sys.exit(1)
