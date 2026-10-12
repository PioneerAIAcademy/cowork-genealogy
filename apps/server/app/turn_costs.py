"""Per-turn agent cost, reported by the sandbox after each turn.

The control plane is out of the streaming path, so only the sandbox sees a turn's
cost (the SDK's ResultMessage). It authenticates with the proxy token it already
holds for the Anthropic proxy, which names its sandbox and so its project.
"""
from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .anthropic_proxy import verify_proxy_token
from .db import get_engine
from .models import Project, TurnCost

router = APIRouter()


class TurnCostIn(BaseModel):
    cost_usd: float = Field(ge=0)
    model: str | None = Field(default=None, max_length=100)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    build: str | None = Field(default=None, max_length=64)
    continuations: int | None = Field(default=None, ge=0)


@router.post("/api/turn-cost")
def record_turn_cost(body: TurnCostIn, request: Request) -> Response:
    sandbox_id = verify_proxy_token(request.headers.get("x-api-key") or "")
    if sandbox_id is None:
        return Response(status_code=401)
    with Session(get_engine()) as session:
        project = session.exec(select(Project).where(Project.sandbox_id == sandbox_id)).first()
        if project is None:
            return Response(status_code=404)
        session.add(TurnCost(project_id=project.id, user_id=project.user_id, **body.model_dump()))
        session.commit()
    return Response(status_code=204)
