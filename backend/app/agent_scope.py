"""Validated map context and the same card filters used by the map UI."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.search import fold, variants


class Bounds(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)

    @model_validator(mode="after")
    def ordered_latitudes(self):
        if self.south > self.north:
            raise ValueError("South must not exceed north")
        return self


class MapFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    region: list[str] = Field(default_factory=list, max_length=100)
    focus: list[str] = Field(default_factory=list, max_length=10)
    domain: list[str] = Field(default_factory=list, max_length=30)
    role: list[str] = Field(default_factory=list, max_length=20)
    search: str = Field(default="", max_length=200)
    sanctioned: bool = False
    specialization: Literal["all", "uav", "weapons"] = "all"
    hidden_categories: list[str] = Field(default_factory=list, max_length=10)
    layers: list[Literal["supplier", "parent"]] = Field(default_factory=list, max_length=2)
    network_company_id: int | None = Field(default=None, gt=0)
    network_kinds: list[Literal["supplier", "parent", "related", "bank", "successor", "branch"]] = (
        Field(default_factory=list, max_length=6)
    )
    result_ids: list[int] = Field(default_factory=list, max_length=30)


class MapScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["viewport", "filters", "selection"]
    bounds: Bounds | None = None
    filters: MapFilters = Field(default_factory=MapFilters)
    employer_ids: list[int] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def required_selection(self):
        if self.mode == "viewport" and self.bounds is None:
            raise ValueError("Viewport bounds required")
        if self.mode == "selection" and not self.employer_ids:
            raise ValueError("Select at least one employer")
        if any(i <= 0 for i in self.employer_ids):
            raise ValueError("Employer IDs must be positive")
        return self


def matches_card(card: dict, filters: MapFilters, tags: dict) -> bool:
    """Match legal-entity filters at card level, as FiltersProvider and MapSlot do."""
    cls = card.get("classification") or {}
    review = card.get("human_review") or {}
    focus = card.get("focus")
    focus_keys = [] if focus is None else [f["focus"] for f in focus] or ["other"]
    values = {
        "region": [str(card["region_id"]) if card.get("region_id") is not None else "none"],
        "focus": focus_keys,
        "domain": [cls.get("direction_domain") or "none"],
        "role": [cls.get("direction_role") or "none"],
    }
    if any(
        selected and not set(selected).intersection(values[key])
        for key in values
        if (selected := getattr(filters, key))
    ):
        return False
    if filters.search:
        haystack = fold(
            " ".join(
                str(card.get(k) or "") for k in ("name", "gur_name", "locality", "region", "inn")
            )
        )
        if variants(filters.search) and not any(v in haystack for v in variants(filters.search)):
            return False
    gur = cls.get("sanctions_gur") or []
    extra = cls.get("sanctions_new") or []
    sanctioned = (
        bool(set(gur + extra)) if card.get("classification") else bool(card.get("sanctions_count"))
    )
    if review.get("sanctions"):
        sanctioned = review["sanctions"] == "sanctioned"
    if filters.sanctioned and not sanctioned:
        return False
    category = review.get("category") or card.get("category")
    category = category if category in {"производство", "НИИ/КБ", "ремонт"} else "none"
    if category in filters.hidden_categories:
        return False
    if filters.specialization != "all":
        return bool(tags.get(card.get("gur_company_id"), {}).get(filters.specialization))
    return True


def scope_ids(cards: list[dict], scope: MapScope, network: dict) -> list[int]:
    if scope.mode == "selection":
        chosen = set(scope.employer_ids)
        return [c["id"] for c in cards if c["id"] in chosen]
    f = scope.filters
    if f.network_company_id and f.network_kinds:
        root = next((c for c in cards if c["id"] == f.network_company_id), None)
        company = root.get("gur_company_id") if root else None
        connected = {company} if company is not None else set()
        edges = [
            e
            for e in network["relations"]
            if e["kind"] in f.network_kinds
            and (
                e["kind"] in {"supplier", "parent"} or company in {e["company_id"], e["related_id"]}
            )
        ]
        adjacency: dict[int, set[int]] = {}
        for edge in edges:
            a, b = edge["company_id"], edge["related_id"]
            adjacency.setdefault(a, set()).add(b)
            adjacency.setdefault(b, set()).add(a)
        pending = list(connected)
        while pending:
            for other in adjacency.get(pending.pop(), set()) - connected:
                connected.add(other)
                pending.append(other)
        return [
            c["id"]
            for c in cards
            if c["id"] == f.network_company_id or c.get("gur_company_id") in connected
        ]
    tags = {t["company_id"]: t for t in network["company_tags"]}
    return [
        c["id"]
        for c in cards
        if (not f.result_ids or c["id"] in f.result_ids) and matches_card(c, f, tags)
    ]
