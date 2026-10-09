"""Read saved JEV results, blind-classify then audit through GPT, write local files only."""

import argparse
import asyncio
import csv
import hashlib
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent_provider import ProviderError  # noqa: E402
from app.config import settings  # noqa: E402
from app.vacancy_judge import VERSION, cache_key, parse_response, payload, request  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def export_csv(path, rows):
    fields = [
        "vacancy_id",
        "title",
        "url",
        "status",
        "jev_domain",
        "gpt_domain",
        "domain_verdict",
        "domain_suggestion",
        "domain_reason",
        "domain_evidence",
        "jev_role",
        "gpt_role",
        "role_verdict",
        "role_suggestion",
        "role_reason",
        "role_evidence",
        "jev_review",
        "judge_review",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            out = {k: row.get(k, "") for k in fields}
            for dim in ("domain", "role"):
                out["jev_" + dim] = row["decisions"][dim]["choice"]
                out["gpt_" + dim] = row.get("blind", {}).get(dim, {}).get("choice", "")
                audit = row.get("audit", {}).get(dim, {})
                for key, source in [
                    ("verdict", "verdict"),
                    ("suggestion", "suggested_choice"),
                    ("reason", "reason"),
                    ("evidence", "evidence"),
                ]:
                    out[dim + "_" + key] = audit.get(source, "")
            for key, value in out.items():
                if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
                    out[key] = "'" + value
            writer.writerow(out)


def load_sources(source):
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    rows = json.loads((source / "results.json").read_text(encoding="utf-8"))
    if (
        manifest["scope"] != "company_full_active"
        or manifest.get("limit")
        or len(rows) != manifest["selected"]
        or len({r["vacancy_id"] for r in rows}) != len(rows)
        or any(r["status"] != "ok" or r["card_id"] != 4064 for r in rows)
    ):
        raise ValueError("Expected a complete successful Alabuga full-company export")
    return manifest, rows


async def run(args):
    source_manifest, rows = load_sources(args.source)
    questions = source_manifest["questions"]
    if not settings.gpt_api_key or not settings.gpt_base_url:
        raise ValueError("Configure GPT_BASE_URL and GPT team key")
    args.output.mkdir(parents=True, exist_ok=True)
    groups = {}
    for row in rows:
        candidate = {d: row["decisions"][d]["choice"] for d in ("domain", "role")}
        key = cache_key(payload(row["state"], questions, "blind"))
        groups.setdefault(key, []).append((row, candidate))
    if args.limit:
        groups = dict(list(groups.items())[: args.limit])
    manifest = {
        "started_at": datetime.now(UTC).isoformat(),
        "database_writes": False,
        "source": str(args.source.resolve()),
        "source_scope": source_manifest["scope"],
        "source_sha256": hashlib.sha256((args.source / "results.json").read_bytes()).hexdigest(),
        "source_vacancies": len(rows),
        "selected_unique_texts": len(groups),
        "limit_unique_texts": args.limit,
        "model_requested": settings.gpt_model,
        "base_url": settings.gpt_base_url,
        "judge_version": VERSION,
        "transport_output_reserve": 1500,
        "transport_output_ceiling_on_truncation": 3000,
        "rubric": questions,
        "source_verification": source_manifest.get("post_run_verification"),
        "method": "Blind classification without JEV labels, followed by candidate audit for "
        "every unique text/label pair. Exact duplicate inputs share answers. "
        "Report separately weights individual vacancies and distinct full texts. "
        "This is model judgment, not human-measured accuracy.",
    }
    save(args.output / "manifest.json", manifest)
    cache_path = args.output / "responses.jsonl"
    cache = {}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                item = json.loads(line)
                if item.get("status") == "ok":
                    cache[item["cache_key"]] = item
    semaphore = asyncio.Semaphore(args.concurrency)
    responses, usage = [], Counter()
    stats = Counter()
    results = []

    async def call(request_payload, row, stage, candidate=None):
        key = cache_key(request_payload)
        if key in cache:
            response = cache[key]["response"]
            parsed = parse_response(response, questions, row["state"], stage, candidate)
            stats["reused_calls"] += 1
        else:
            response, parsed = await request(
                request_payload, questions, row["state"], stage, candidate
            )
            stats["new_calls"] += 1
            usage.update(
                {
                    k: response.get("usage", {}).get(k, 0)
                    for k in ("prompt_tokens", "completion_tokens", "total_tokens")
                }
            )
            transport_limit = response.pop("_judge_transport_max_completion_tokens", 3000)
            item = {
                "cache_key": key,
                "stage": stage,
                "status": "ok",
                "response": response,
                "transport_output_limit": transport_limit,
            }
            cache[key] = item
            with cache_path.open("a", encoding="utf-8") as file:
                file.write(json.dumps(item, ensure_ascii=False) + "\n")
        responses.append(response.get("model", "unknown"))
        return parsed

    async def review_group(group_key, members):
        async with semaphore:
            row = members[0][0]
            try:
                blind = await call(payload(row["state"], questions, "blind"), row, "blind")
                audits = {}
                for _, candidate in members:
                    candidate_key = json.dumps(candidate, sort_keys=True)
                    if candidate_key not in audits:
                        audits[candidate_key] = await call(
                            payload(row["state"], questions, "audit", candidate, blind),
                            row,
                            "audit",
                            candidate,
                        )
                for item, candidate in members:
                    audit = audits[json.dumps(candidate, sort_keys=True)]
                    results.append(
                        {
                            **item,
                            "jev_review": item["review"],
                            "status": "ok",
                            "judge_group": group_key,
                            "blind": blind,
                            "audit": audit,
                            "judge_review": any(
                                d["verdict"] != "supported" for d in audit.values()
                            ),
                        }
                    )
            except (ProviderError, ValueError) as exc:
                failure = {
                    "judge_group": group_key,
                    "vacancy_id": row["vacancy_id"],
                    "error_type": type(exc).__name__,
                    "http_status": getattr(exc, "status", None),
                }
                with (args.output / "failures.jsonl").open("a", encoding="utf-8") as file:
                    file.write(json.dumps(failure) + "\n")
                stats[
                    "failure_" + type(exc).__name__ + "_" + str(getattr(exc, "status", None))
                ] += 1
                for item, _ in members:
                    results.append(
                        {
                            **item,
                            "jev_review": item["review"],
                            "status": "error",
                            "judge_group": group_key,
                            "judge_review": True,
                            "error_type": type(exc).__name__,
                            "http_status": getattr(exc, "status", None),
                        }
                    )
                stats["failed_groups"] += 1
                if stats["failed_groups"] <= 3:
                    print(
                        f"Judge failure: {failure['error_type']}, HTTP {failure['http_status']}",
                        flush=True,
                    )
            stats["completed_groups"] += 1
            if stats["completed_groups"] % 25 == 0 or stats["completed_groups"] == len(groups):
                print(
                    f"Reviewed texts {stats['completed_groups']}/{len(groups)}; "
                    f"vacancies {len(results)}; failed groups {stats['failed_groups']}",
                    flush=True,
                )

    print(
        f"GPT judge: {len(groups)} unique texts covering "
        f"{sum(len(v) for v in groups.values())} vacancies",
        flush=True,
    )
    await asyncio.gather(*(review_group(key, members) for key, members in groups.items()))
    results.sort(key=lambda r: r["vacancy_id"])
    expected_ids = {row["vacancy_id"] for group in groups.values() for row, _ in group}
    actual_ids = {row["vacancy_id"] for row in results}
    if actual_ids != expected_ids or len(results) != len(actual_ids):
        raise ValueError("GPT results do not exactly cover the selected vacancy IDs")
    save(args.output / "results.json", results)
    export_csv(args.output / "review.csv", results)
    manifest.update(
        finished_at=datetime.now(UTC).isoformat(),
        stats=dict(stats),
        models_returned=sorted(set(responses)),
        api_token_usage=dict(usage),
        reviewed_vacancies=len(results),
        success=sum(r["status"] == "ok" for r in results),
        errors=sum(r["status"] == "error" for r in results),
        coverage={
            "expected_unique_ids": len(expected_ids),
            "returned_unique_ids": len(actual_ids),
            "missing_ids": sorted(expected_ids - actual_ids),
            "unexpected_ids": sorted(actual_ids - expected_ids),
            "failed_ids": [r["vacancy_id"] for r in results if r["status"] != "ok"],
        },
    )
    save(args.output / "manifest.json", manifest)
    from app.vacancy_judge_report import write_report

    write_report(args.output, manifest, results)
    print(f"Review report: {args.output / 'index.html'}", flush=True)
    return int(bool(manifest["errors"]))


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "reports/jev-alabuga-full")
    parser.add_argument("--output", type=Path, default=ROOT / "reports/jev-alabuga-gpt-review")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--limit", type=int, help="Smoke test: maximum distinct full texts")
    args = parser.parse_args()
    if not 1 <= args.concurrency <= 8 or args.limit is not None and args.limit < 1:
        parser.error("Invalid concurrency or limit")
    if args.source.resolve() == args.output.resolve():
        parser.error("Output must not overwrite the original JEV results")
    return args


async def main():
    try:
        return await run(arguments())
    except Exception as exc:
        print(f"Judge stopped: {type(exc).__name__}; no database writes.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
