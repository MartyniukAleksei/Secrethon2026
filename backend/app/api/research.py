from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.exc import SQLAlchemyError

from app import rag, research
from app.api.agent import Context, EvidenceSection, citation_ids, safe_url
from app.api.deps import Session
from app.repository import employers

router = APIRouter(prefix="/agent/research", tags=["agent"])


class ApprovedSource(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(pattern=r"^s\d+$")
    title: str = Field(min_length=1, max_length=1000)
    url: str = Field(max_length=4000)
    origin: Literal["database", "public_web"]
    verification: Literal["database_record", "unverified", "user_verified"]
    excerpt: str | None = Field(default=None, max_length=8000)
    published_at: str | None = Field(default=None, max_length=100)
    retrieved_at: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def validate_source(self):
        if not safe_url(self.url):
            raise ValueError("Invalid source URL")
        if self.origin == "public_web" and (
            self.verification == "database_record"
            or not self.url.startswith(("https://", "http://"))
        ):
            raise ValueError("Web sources require an explicit user verification decision")
        if self.origin == "database" and self.verification != "database_record":
            raise ValueError("Database sources retain their provenance")
        return self


class ApprovedResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str = Field(min_length=1, max_length=24000)
    sources: list[ApprovedSource] = Field(max_length=60)
    sections: list[EvidenceSection] = Field(default_factory=list, max_length=3)
    artifacts: list[dict] = Field(default_factory=list, max_length=40)
    tools_used: list[str] = Field(default_factory=list, max_length=30)
    as_of: str | None = None
    generated_at: str | None = None

    @model_validator(mode="after")
    def validate_citations(self):
        ids = {source.id for source in self.sources}
        if len(ids) != len(self.sources):
            raise ValueError("Duplicate source IDs")
        cited = citation_ids(self.text)
        for section in self.sections:
            cited.extend(section.source_ids + citation_ids(section.text))
            if section.kind != "analysis" and any(
                source.origin != section.kind
                for source in self.sources
                if source.id in section.source_ids + citation_ids(section.text)
            ):
                raise ValueError("Section must retain source provenance")
        if any(ident not in ids for ident in cited):
            raise ValueError("Missing cited source")
        for artifact in self.artifacts:
            if artifact.get("kind") not in {
                "mentions",
                "relations",
                "table",
                "bar",
                "line",
                "donut",
                "stacked",
                "heatmap",
                "scatter",
                "histogram",
                "kpi",
                "signals",
            }:
                raise ValueError("Unknown artifact kind")
            entries = artifact.get(
                "items" if artifact["kind"] in {"mentions", "relations"} else "rows"
            )
            if not isinstance(entries, list) or len(entries) > 500:
                raise ValueError("Invalid artifact entries")
            for entry in entries:
                if not isinstance(entry, dict):
                    raise ValueError("Invalid artifact entry")
                if entry.get("source_id") and entry["source_id"] not in ids:
                    raise ValueError("Missing artifact source")
            if artifact.get("kind") == "mentions":
                for item in artifact.get("items", []):
                    if item.get("source_id") not in ids or not safe_url(item.get("url")):
                        raise ValueError("Invalid mention source")
        return self


class ResearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    title: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=4000)
    employer_id: int | None = Field(default=None, gt=0)
    parent_id: UUID | None = None
    context: Context
    response: ApprovedResponse
    approved: Literal[True]

    @field_validator("title", "question")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def bounded_payload(self):
        if len(self.model_dump_json().encode()) > 300000:
            raise ValueError("Research exceeds storage limit")
        return self


@router.get("")
async def list_saved(session: Session, employer_id: int | None = Query(default=None, gt=0)):
    try:
        return jsonable_encoder(await research.list_research(session, employer_id))
    except (SQLAlchemyError, OSError):
        raise HTTPException(503, "Не вдалося завантажити дослідження з БД.") from None


@router.post("", status_code=201)
async def approve(payload: ResearchIn, session: Session, background_tasks: BackgroundTasks):
    employer_id = payload.employer_id
    try:
        if employer_id is not None:
            employer_id = await employers.card_of(session, employer_id)
            if employer_id is None:
                raise HTTPException(404, "Підприємство не знайдено.")
        saved = await research.save_research(
                {
                    "id": payload.id,
                    "title": payload.title,
                    "question": payload.question,
                    "employer_id": employer_id,
                    "parent_id": payload.parent_id,
                    "context": payload.context.model_dump(mode="json"),
                    "approved_info": payload.response.model_dump(mode="json"),
                }
            )
        background_tasks.add_task(rag.index_approved, saved)
        return jsonable_encoder(saved)
    except (SQLAlchemyError, OSError):
        raise HTTPException(503, "Не вдалося зберегти в БД. Повторіть спробу.") from None
