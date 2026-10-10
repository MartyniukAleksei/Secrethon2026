"""Run real GPT behavioral cases on synthetic adapters, never production DB."""

import argparse
import asyncio
import hashlib
import json
import logging
import sys
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import agent_eval as evaluation  # noqa: E402
from app.agent_eval_fixtures import FixtureSession  # noqa: E402
from app.api.agent import ChatIn, answer  # noqa: E402
from app.config import settings  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


async def run(args):
    dataset = ROOT / args.dataset
    fingerprints = {
        "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "controller_sha256": hashlib.sha256((ROOT / "app/api/agent.py").read_bytes()).hexdigest(),
        "adapter_sha256": hashlib.sha256((ROOT / "app/agent_eval.py").read_bytes()).hexdigest(),
        "grader_sha256": hashlib.sha256((ROOT / "app/agent_eval.py").read_bytes()).hexdigest(),
    }
    cases = evaluation.load_cases(dataset)
    if args.split != "all":
        cases = [c for c in cases if c["split"] == args.split]
    if args.family:
        cases = [c for c in cases if c["family"] in args.family]
    if args.ids:
        cases = [c for c in cases if c["id"] in args.ids.split(",")]
    if args.limit:
        cases = cases[: args.limit]
    if args.validate:
        print(f"Valid scenarios: {len(cases)}; no model requests or DB connections")
        return
    if not args.regrade and (not settings.gpt_api_key or not settings.gpt_base_url):
        raise SystemExit("Configure the existing GPT gateway credentials first")
    output = ROOT / args.output
    output.mkdir(parents=True, exist_ok=True)
    jsonl = output / "results.jsonl"
    completed = {}
    if args.regrade:
        original_path = ROOT / args.regrade
        original_rows = {
            row["id"]: row
            for row in map(json.loads, original_path.read_text(encoding="utf-8").splitlines())
        }
        original_summary = json.loads(
            original_path.with_name("summary.json").read_text(encoding="utf-8")
        )
        if original_summary.get("dataset_sha256") != fingerprints["dataset_sha256"]:
            raise SystemExit("Stored responses use a different dataset")
        fingerprints["controller_sha256"] = original_summary["controller_sha256"]
        fingerprints["adapter_sha256"] = original_summary["adapter_sha256"]
        for case in cases:
            row = original_rows[case["id"]]
            if not row.get("error"):
                previous = row["failures"]
                row["failures"] = evaluation.grade(case, row["response"], row["trace"])
                row["passed"] = not row["failures"]
                if row["failures"] != previous:
                    row["previous_failures"] = previous
            completed[case["id"]] = row
    if args.resume and jsonl.exists():
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            completed[row["id"]] = row
    if not args.resume:
        jsonl.write_text("", encoding="utf-8")
    pending = [c for c in cases if c["id"] not in completed]
    if args.regrade:
        jsonl.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in completed.values()),
            encoding="utf-8",
        )
    semaphore = asyncio.Semaphore(args.concurrency)
    count = 0

    async def one(case):
        nonlocal count
        async with semaphore:
            trace = {
                "tools": [],
                "analytics": [],
                "web_calls": 0,
                "gpt_calls": 0,
                "max_input_bytes": 0,
                "writes": 0,
                "fixture_variant": case.get("fixture_variant", {}),
            }
            token = evaluation.current.set(trace)
            session = FixtureSession()
            started = time.monotonic()
            result = {}
            error = None
            error_details = None
            try:
                result = await asyncio.wait_for(
                    answer(ChatIn.model_validate(case["request"]), session), args.timeout
                )
                trace["writes"] = session.writes
                failures = evaluation.grade(case, result, trace)
            except Exception as exc:
                # No raw exception/headers/provider URLs are written to reports.
                error = type(exc).__name__
                if error == "ProviderError":
                    error_details = {
                        "provider": exc.provider,
                        "status": exc.status,
                        "reason": exc.reason,
                    }
                failures = ["execution_error:" + error]
            finally:
                trace["writes"] = session.writes
                evaluation.current.reset(token)
            record = {
                "id": case["id"],
                "family": case["family"],
                "split": case["split"],
                "passed": not failures,
                "failures": failures,
                "error": error,
                "error_details": error_details,
                "seconds": round(time.monotonic() - started, 2),
                "trace": trace,
                "response": result,
            }
            with jsonl.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, default=str, ensure_ascii=False) + "\n")
            completed[case["id"]] = record
            count += 1
            print(
                f"{count}/{len(pending)} {case['id']}: "
                f"{'PASS' if not failures else ', '.join(failures)}",
                flush=True,
            )

    with evaluation.environment():
        await asyncio.gather(*(one(case) for case in pending))
    rows = [completed[c["id"]] for c in cases if c["id"] in completed]
    stats = {
        "created_at": datetime.now(UTC).isoformat(),
        "model": settings.gpt_model,
        "mode": "real_gpt_synthetic_reads",
        **fingerprints,
        "total": len(rows),
        "passed": sum(r["passed"] for r in rows),
        "failed": sum(not r["passed"] for r in rows),
        "gpt_calls": sum(r["trace"]["gpt_calls"] for r in rows),
        "real_web_calls": 0,
        "database_connections": 0,
        "new_gpt_calls": 0 if args.regrade else sum(r["trace"]["gpt_calls"] for r in rows),
        "regraded_saved_outputs": bool(args.regrade),
        "failure_categories": dict(Counter(f for r in rows for f in r["failures"])),
    }
    (output / "summary.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# Оцінювання агента",
        "",
        f"Пройшли: {stats['passed']}/{stats['total']}.",
        "",
        "Справжня GPT-модель; контрольні синтетичні дані. SQL, реальні ембедінги "
        "та браузер цим прогоном не перевіряються. Звернень до БД і реального Tavily: 0.",
        "",
        "| Сценарій | Питання | Результат |",
        "|---|---|---|",
    ]
    if args.regrade:
        report.insert(
            6, "Повторна оцінка збережених відповідей оновленою перевіркою; нових запитів GPT: 0.\n"
        )
    for case in cases:
        row = completed.get(case["id"])
        if row:
            question = case["request"]["message"].replace("|", "\\|").replace("\n", " ")
            report.append(
                f"| {case['id']} | {question} | "
                f"{'PASS' if row['passed'] else ', '.join(row['failures'])} |"
            )
    (output / "report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("app.api.agent").setLevel(logging.WARNING)
    logging.getLogger("app.agent_provider").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=["all", "development", "heldout"], default="development")
    parser.add_argument("--dataset", default="evals/agent_scenarios.jsonl")
    parser.add_argument("--family", action="append")
    parser.add_argument("--ids")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--concurrency", type=int, choices=[1, 2], default=2)
    parser.add_argument("--timeout", type=int, default=100)
    parser.add_argument("--output", default=".cache/evals/development")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--regrade", help="Regrade stored results.jsonl without model requests")
    parser.add_argument("--validate", action="store_true")
    asyncio.run(run(parser.parse_args()))
