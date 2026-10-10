"""Citable RAG documents; pipeline data is read only, approvals keep provenance."""

import hashlib
import json
import re
from dataclasses import dataclass, field

from sqlalchemy import text

from app.repository import employers


@dataclass(frozen=True)
class Document:
    key: str
    employer_id: int | None
    title: str
    body: str
    url: str
    origin: str = "database"
    verification: str = "database_record"
    metadata: dict = field(default_factory=dict)

    @property
    def fingerprint(self):
        value = json.dumps(self.__dict__, ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.sha256(value.encode()).hexdigest()


def chunks(body: str, size: int = 900, overlap: int = 120) -> list[str]:
    """Bound chunks without deleting source text; prefer sentence/word boundaries."""
    if not 0 <= overlap < size:
        raise ValueError("Chunk overlap must be smaller than its size")
    body = body.strip()
    result, start = [], 0
    while start < len(body):
        end = min(start + size, len(body))
        if end < len(body):
            boundary = max(
                body.rfind("\n", start + size // 2, end),
                body.rfind(". ", start + size // 2, end),
                body.rfind(" ", start + size // 2, end),
            )
            if boundary > start:
                end = boundary + 1
        value = body[start:end].strip()
        if value:
            result.append(value)
        if end == len(body):
            break
        start = max(start + 1, end - overlap)
    return result


def profile_document(employer_id: int, name: str, row: dict, kind: str) -> Document | None:
    description = row.get("description_uk") or row.get("description_ru") or ""
    products = row.get("products_uk") or row.get("products_ru") or []
    tags = row.get("activity_tags") or []
    lines = [name, description]
    if products:
        lines.append("Продукція: " + "; ".join(products))
    if tags:
        lines.append("Діяльність: " + "; ".join(tags))
    if not description and not products and not tags:
        return None
    return Document(
        key=f"{kind}:{employer_id}",
        employer_id=employer_id,
        title=name + " — " + kind,
        body="\n".join(v for v in lines if v),
        url=f"/companies/{employer_id}",
        metadata={
            "kind": kind,
            "updated_at": row.get("updated_at"),
            "evidence_url": row.get("gur_url"),
        },
    )


def research_documents(record: dict) -> list[Document]:
    response = record.get("approved_info", record.get("response", {}))
    if isinstance(response, str):
        response = json.loads(response)
    sources = {source["id"]: source for source in response.get("sources", [])}
    sections = response.get("sections") or [{"kind": "analysis", "text": response["text"]}]
    result = []
    for index, section in enumerate(sections):
        cited = set(section.get("source_ids", []))
        for group in re.findall(r"\[(s\d+(?:\s*,\s*s\d+)*)\]", section["text"]):
            cited.update(re.findall(r"s\d+", group))
        refs = [source for ident, source in sources.items() if ident in cited]
        # Uncited synthesis is not an evidence document. Mixed synthesis cannot
        # safely become a single-origin source, so keep it in saved chat only.
        if not refs or section["kind"] == "analysis":
            continue
        origin = section["kind"]
        if origin == "database":
            verification = "database_record"
        else:
            verification = (
                "user_verified"
                if refs and all(source["verification"] == "user_verified" for source in refs)
                else "unverified"
            )
        # Store the conclusion with all its original citations. Approval alone is
        # never treated as factual verification, including uncited analysis.
        result.append(
            Document(
                key=f"research:{record['id']}:{index}",
                employer_id=record.get("employer_id"),
                title=record["title"],
                body=section["text"],
                url=refs[0]["url"]
                if refs
                else (f"/companies/{record['employer_id']}" if record.get("employer_id") else "/"),
                origin=origin,
                verification=verification,
                metadata={
                    "kind": "approved_research",
                    "research_id": str(record["id"]),
                    "approved_at": str(record.get("approved_at", "")),
                    "sources": refs,
                    "section_kind": section["kind"],
                },
            )
        )
    return result


async def load_documents(session, employer_ids: list[int] | None = None) -> list[Document]:
    cards = await employers.list_employers(session)
    if employer_ids is not None:
        cards = [row for row in cards if row["id"] in employer_ids]
    ids = [row["id"] for row in cards]
    result = []
    if ids:
        groups = await session.execute(
            text(
                "SELECT employer_profile_id, company_id FROM employer_group "
                "WHERE employer_profile_id = ANY(:ids)"
            ),
            {"ids": ids},
        )
        group_ids = {row.employer_profile_id: row.company_id for row in groups}
        company_by_card = {
            row["id"]: group_ids.get(row["id"]) or row.get("gur_company_id") for row in cards
        }
        cids = sorted({cid for cid in company_by_card.values() if cid is not None})
        companies = await session.execute(
            text("""
            SELECT c.company_id, c.description_uk, c.products_uk,
                   (SELECT s.url_uk FROM company_section s WHERE s.company_id = c.company_id
                    ORDER BY s.section LIMIT 1) AS gur_url
            FROM company c WHERE c.company_id = ANY(:ids)
        """),
            {"ids": cids},
        )
        company_rows = {row["company_id"]: dict(row) for row in companies.mappings()}
        profiles = await session.execute(
            text("""
            SELECT DISTINCT ON (p.company_id) p.company_id, p.activity_tags,
                   p.products_uk, p.products_ru, p.description_uk, p.description_ru,
                   p.run_id, er.started_at AS updated_at
            FROM company_profile p JOIN enrichment_run er USING (run_id)
            WHERE p.company_id = ANY(:ids) AND p.status = 'published'
            ORDER BY p.company_id, er.started_at DESC, p.run_id DESC
        """),
            {"ids": cids},
        )
        profile_rows = {row["company_id"]: dict(row) for row in profiles.mappings()}
        facts = await session.execute(
            text("""
            SELECT f.company_id, f.run_id, f.local_id, f.claim_ru, f.quote, f.url, f.grade
            FROM company_fact f WHERE f.company_id = ANY(:ids) AND f.quote_verified
            ORDER BY f.company_id, f.local_id
        """),
            {"ids": cids},
        )
        fact_rows = {}
        for fact in facts.mappings():
            if profile_rows.get(fact["company_id"], {}).get("run_id") == fact["run_id"]:
                fact_rows.setdefault(fact["company_id"], []).append(dict(fact))
        for card in cards:
            cid = company_by_card[card["id"]]
            for kind, rows in (("gur", company_rows), ("published_profile", profile_rows)):
                document = profile_document(card["id"], card["name"], rows.get(cid, {}), kind)
                if document:
                    result.append(document)
            for fact in fact_rows.get(cid, []):
                result.append(
                    Document(
                        key=f"fact:{card['id']}:{fact['run_id']}:{fact['local_id']}",
                        employer_id=card["id"],
                        title=card["name"] + " — джерело",
                        body=card["name"] + "\n" + fact["claim_ru"] + "\nЦитата: " + fact["quote"],
                        url=f"/companies/{card['id']}",
                        metadata={
                            "kind": "published_fact",
                            "evidence_url": fact["url"],
                            "quote_verified": True,
                            "grade": fact["grade"],
                        },
                    )
                )
    if await session.scalar(text("SELECT to_regclass('web_reviews.agent_research')")):
        records = await session.execute(
            text("""
            SELECT id, employer_id, title, approved_info, approved_at
            FROM web_reviews.agent_research
            WHERE (CAST(:ids AS bigint[]) IS NULL OR employer_id = ANY(:ids))
            ORDER BY approved_at DESC LIMIT 10000
        """),
            {"ids": employer_ids},
        )
        for record in records.mappings():
            result.extend(research_documents(dict(record)))
    return result
