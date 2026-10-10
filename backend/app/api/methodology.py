from typing import Any

from fastapi import APIRouter

from app.api.deps import Session
from app.config import settings
from app.mcp_server import public_url
from app.repository import methodology
from app.repository.cache import cache

router = APIRouter(tags=["methodology"])

# The MCP tools as the «Про дані» page lists them (the server registers them in mcp_server.py).
MCP_TOOLS = [
    ("search_employers", "Пошук підприємства за назвою або ІПН, з кандидатами для уточнення"),
    ("company_profile", "Профіль: класифікація, санкції, зв'язки, вакансії за місяцем публікації"),
    ("analytics", "Порівняння, рейтинги, фільтровані підсумки, таблиці та графіки"),
    ("vacancies", "Вакансії з фільтрами та посиланнями на джерела"),
    ("overview", "Загальні показники й дата зрізу бази"),
    ("rating", "Рейтинг важливості підприємств для ВПК і розклад балу підприємства"),
    ("search_mentions", "Кандидати на публічні згадки підприємства у вебпошуку (Tavily)"),
]


@router.get("/methodology")
async def get_methodology(session: Session) -> dict[str, Any]:
    """Дані сторінки «Про дані»: зіставлення й дедуплікація, класи та їхня кількість,
    перевірка рішень (скрипти, LLM as a judge, ручні перевірки), підключення MCP."""
    data = await cache.get_or_load("methodology", lambda: methodology.overview(session))
    # The site sits behind Basic Auth, so whoever sees this page may use the MCP key too.
    mcp = {
        "enabled": settings.mcp_enabled and bool(settings.mcp_api_key),
        "url": public_url() + "/mcp/",
        "key": (settings.mcp_api_key or None) if settings.site_password else None,
        "tools": [{"name": n, "description": d} for n, d in MCP_TOOLS],
    }
    return {**data, "mcp": mcp}
