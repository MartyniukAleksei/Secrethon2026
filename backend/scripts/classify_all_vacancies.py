"""Classify a complete read-only export, checkpointing once per distinct input.

Does not write to the database. Publication uses apply_vacancy_directions.py separately.
"""

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent_provider import ProviderError  # noqa: E402
from app.config import settings  # noqa: E402
from app.vacancy_all_report import write_summary  # noqa: E402
from app.vacancy_labeling import evaluate, fingerprint, parse_decisions  # noqa: E402
from scripts.classify_vacancies import csv_export, write_json  # noqa: E402


def records(path):
    with path.open(encoding="utf-8") as file:
        for line in file:
            if line.strip():
                yield json.loads(line)


async def run(args):
    manifest = json.loads((args.output / "manifest.json").read_text(encoding="utf-8"))
    if manifest["scope"] not in {"all_raw", "vpk_active_unique"} or manifest.get("limit"):
        raise ValueError("Requires a complete raw or VPK export without a limit")
    questions = manifest["questions"]
    model = manifest["model_requested"]
    if settings.jev_model != model or not settings.jev_api_key:
        raise ValueError("Export model must match configured JEV_MODEL; key required")
    inputs = list(records(args.output / "inputs.jsonl"))
    ids = {r["vacancy_id"] for r in inputs}
    expected = manifest.get("scope_count", manifest["database_inventory"]["total"])
    if len(ids) != len(inputs) or len(inputs) != expected:
        raise ValueError("Incomplete or duplicate input IDs")
    groups = {}
    for row in inputs:
        key = fingerprint(row["state"], questions, model)
        if row["fingerprint"] != key:
            raise ValueError("Input fingerprint does not match exported rubric/model")
        groups.setdefault(key, row)
    cache = {}
    cache_path = args.output / "responses.jsonl"
    for directory in [*args.cache_dirs, args.output]:
        path = directory / "responses.jsonl"
        if not path.exists() and directory != args.output:
            path = directory / "results.jsonl"
        if not path.exists():
            continue
        for previous in records(path):
            key = previous.get("fingerprint")
            if key not in groups or key in cache or previous.get("status") != "ok":
                continue
            response = previous.get("response")
            parse_decisions(response, questions, manifest["threshold"])
            cache[key] = response
    # Save imported successful responses before sending new requests.
    with cache_path.open("w", encoding="utf-8") as file:
        for key, response in cache.items():
            file.write(
                json.dumps(
                    {"fingerprint": key, "status": "ok", "response": response}, ensure_ascii=False
                )
                + "\n"
            )
    initial_cached = len(cache)
    weights = Counter(row["fingerprint"] for row in inputs)
    success_records = sum(weights[key] for key in cache)
    pending = [key for key in groups if key not in cache]
    usage = Counter()
    started = time.monotonic()
    failures = {}
    new_requests = 0
    manifest.update(
        distinct_inputs=len(groups),
        cached_inputs=initial_cached,
        classification_started_at=datetime.now(UTC).isoformat(),
    )
    write_json(args.output / "manifest.json", manifest)

    def progress():
        data = {
            "scope": manifest["scope"],
            "updated_at": datetime.now(UTC).isoformat(),
            "selected": len(inputs),
            "distinct_inputs": len(groups),
            "completed_inputs": len(cache),
            "success": success_records,
            "pending_records": len(inputs) - success_records,
            "failed_inputs": len(failures),
            "new_requests": new_requests,
            "cached_inputs": initial_cached,
            "seconds": round(time.monotonic() - started),
            "api_token_usage": dict(usage),
            "database_written": False,
        }
        write_json(args.output / "progress.json", data)
        print(
            f"JEV {len(cache)}/{len(groups)} texts; "
            f"{success_records}/{len(inputs)} vacancies; failed {len(failures)}",
            flush=True,
        )

    progress()
    for wave in range(6):
        if not pending:
            break
        queue = asyncio.Queue()
        for key in pending:
            queue.put_nowait(key)

        async def worker(queue=queue):
            nonlocal new_requests, success_records
            while not queue.empty():
                key = queue.get_nowait()
                try:
                    new_requests += 1
                    response = await evaluate(groups[key]["state"], questions)
                    parse_decisions(response, questions, manifest["threshold"])
                    cache[key] = response
                    success_records += weights[key]
                    failures.pop(key, None)
                    usage.update(response.get("usage", {}))
                    with cache_path.open("a", encoding="utf-8") as file:
                        file.write(
                            json.dumps(
                                {"fingerprint": key, "status": "ok", "response": response},
                                ensure_ascii=False,
                            )
                            + "\n"
                        )
                except (ProviderError, ValueError) as exc:
                    failures[key] = {
                        "error_type": type(exc).__name__,
                        "http_status": getattr(exc, "status", None),
                    }
                    if getattr(exc, "status", None) in {401, 403}:
                        raise ValueError("JEV credentials rejected") from None
                finally:
                    queue.task_done()
                if (len(cache) + len(failures)) % 25 == 0:
                    progress()

        await asyncio.gather(*(worker() for _ in range(args.concurrency)))
        pending = [key for key in groups if key not in cache]
        write_json(args.output / "failures.json", failures)
        progress()
        if pending and wave < 5:
            await asyncio.sleep(min(15 * (wave + 1), 60))
    parsed = {
        key: parse_decisions(raw, questions, manifest["threshold"]) for key, raw in cache.items()
    }
    domains, roles = Counter(), Counter()

    def results():
        for row in inputs:
            compact = {key: value for key, value in row.items() if key != "state"}
            response = cache.get(row["fingerprint"])
            if response is None:
                yield {
                    **compact,
                    "status": "error",
                    "review": True,
                    **failures.get(row["fingerprint"], {}),
                }
            else:
                decisions = parsed[row["fingerprint"]]
                yield {
                    **compact,
                    "status": "ok",
                    "decisions": decisions,
                    "model": response["model"],
                    "review": any(d["review"] for d in decisions.values()),
                }

    review = 0
    with (args.output / "labels.jsonl.tmp").open("w", encoding="utf-8") as file:
        for row in results():
            file.write(json.dumps(row, ensure_ascii=False) + "\n")
            review += row["review"]
            if row["status"] == "ok":
                domains[row["decisions"]["domain"]["choice"]] += 1
                roles[row["decisions"]["role"]["choice"]] += 1
    (args.output / "labels.jsonl.tmp").replace(args.output / "labels.jsonl")
    csv_export(args.output / "vacancies.csv", results())
    manifest.update(
        finished_at=datetime.now(UTC).isoformat(),
        success=success_records,
        errors=len(inputs) - success_records,
        review=review,
        models_returned=sorted({r["model"] for r in cache.values()}),
        domains=dict(domains),
        roles=dict(roles),
        api_token_usage=dict(usage),
        coverage={
            "expected_ids": len(ids),
            "result_ids": len(inputs),
            "missing_ids": [],
            "unexpected_ids": [],
        },
    )
    write_json(args.output / "manifest.json", manifest)
    write_summary(args.output, manifest, results())
    progress()
    return 1 if manifest["errors"] else 0


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("../reports/jev-vpk"))
    parser.add_argument("--cache-dirs", type=Path, nargs="*", default=[])
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.concurrency <= 32:
        parser.error("Concurrency must be between 1 and 32")
    return args


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(run(arguments())))
    except Exception as exc:
        print(
            f"Stopped: {type(exc).__name__}; checkpoint kept; database not written.",
            file=sys.stderr,
        )
        sys.exit(1)
