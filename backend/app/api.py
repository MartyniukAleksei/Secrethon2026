from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Item

router = APIRouter(prefix="/api")

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/health")
async def health(session: Session) -> dict[str, str]:
    try:
        await session.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError) as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok"}


class ItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    created_at: datetime


@router.get("/items")
async def list_items(session: Session) -> list[ItemOut]:
    items = await session.scalars(select(Item).order_by(Item.id))
    return [ItemOut.model_validate(item) for item in items]


@router.post("/items", status_code=201)
async def create_item(payload: ItemCreate, session: Session) -> ItemOut:
    item = Item(title=payload.title)
    session.add(item)
    await session.commit()
    return ItemOut.model_validate(item)
