"""FastAPI control plane — app wiring.

Responsibilities (spec §6): Google auth + allowlist, FamilySearch OAuth +
per-user tokens, session/sandbox orchestration, the viewer/chat WebSocket, the
viewer read API, the image proxy, and feedback intake. Routers are added per
milestone; this file wires them together and owns the SandboxProvider lifecycle.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth, familysearch, feedback, image_proxy, sessions, ws
from .config import get_settings
from .db import init_db
from .sandbox import make_provider


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.provider = make_provider()
    try:
        yield
    finally:
        await app.state.provider.aclose()


app = FastAPI(title="Genealogy Workbench Control Plane", lifespan=lifespan)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.web_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(familysearch.router)
app.include_router(ws.router)
app.include_router(image_proxy.router)
app.include_router(feedback.router)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "agentMode": _settings.agent_mode,
        "provider": _settings.sandbox_provider,
        "realtime": _settings.realtime,
    }
