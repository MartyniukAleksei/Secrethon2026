"""Select active shown VPK vacancies from an existing complete read-only export."""

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.vacancy_all_report import write_dashboard  # noqa: E402
from scripts.classify_all_vacancies import records  # noqa: E402
from scripts.classify_vacancies import write_json  # noqa: E402

VPK_IDS_SQL = """SELECT v.vacancy_id FROM public.vacancy_unique v
    JOIN public.vacancy_classification vc USING(vacancy_id)
    JOIN public.classifier_run r USING(run_id)
    WHERE v.is_active AND r.classifier='vacancy_final'
      AND vc.category='vpk' AND vc.level IN ('confirmed','likely')
    ORDER BY v.vacancy_id"""


async def run(args):
    source = json.loads((args.source / "manifest.json").read_text(encoding="utf-8"))
    if source["scope"] != "all_raw" or source.get("limit"):
        raise ValueError("Requires an existing complete raw export")
    conn = await asyncpg.connect(
        settings.database_url.replace("postgresql+asyncpg://", "postgresql://"),
        timeout=20,
        server_settings={"default_transaction_read_only": "on", "statement_timeout": "30000"},
    )
    try:
        ids = {r["vacancy_id"] for r in await conn.fetch(VPK_IDS_SQL)}
    finally:
        await conn.close()
    args.output.mkdir(parents=True, exist_ok=True)
    found, keys = set(), set()
    with (args.output / "inputs.jsonl.tmp").open("w", encoding="utf-8") as file:
        for row in records(args.source / "inputs.jsonl"):
            if row["vacancy_id"] in ids:
                if row["vacancy_id"] in found:
                    raise ValueError("Duplicate input ID")
                found.add(row["vacancy_id"])
                keys.add(row["fingerprint"])
                file.write(json.dumps(row, ensure_ascii=False) + "\n")
    if found != ids or not ids:
        raise ValueError("Selected VPK inputs do not match database IDs")
    (args.output / "inputs.jsonl.tmp").replace(args.output / "inputs.jsonl")
    for key in ("success", "errors", "review", "finished_at", "domains", "roles"):
        source.pop(key, None)
    source.update(
        scope="vpk_active_unique",
        selected=len(ids),
        scope_count=len(ids),
        scope_selected_at=datetime.now(UTC).isoformat(),
        distinct_inputs=len(keys),
        limit=None,
        sampling="All active unique vacancies with final_category=vpk and "
        "final_level confirmed/likely. Agencies and screened-out records excluded.",
        backup_directory=str(args.source / "backups"),
    )
    write_json(args.output / "manifest.json", source)
    write_dashboard(args.output)
    print(f"VPK export: {len(ids)} active unique vacancies; {len(keys)} distinct texts", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("../reports/jev-all"))
    parser.add_argument("--output", type=Path, default=Path("../reports/jev-vpk"))
    try:
        asyncio.run(run(parser.parse_args()))
    except Exception as exc:
        print(f"VPK export stopped: {type(exc).__name__}; no database writes", file=sys.stderr)
        sys.exit(1)
