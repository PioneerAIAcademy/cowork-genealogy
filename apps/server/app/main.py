"""FastAPI control plane — app wiring.

Responsibilities (spec §6): Google auth + allowlist, FamilySearch OAuth +
per-user tokens, session/sandbox orchestration, the viewer/chat WebSocket, the
viewer read API, the image proxy, and feedback intake. Routers are added per
milestone; this file wires them together and owns the SandboxProvider lifecycle.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from starlette.middleware.sessions import SessionMiddleware

from . import auth, familysearch, feedback, image_proxy, realtime_routes, sessions, ws
from .config import get_settings
from .db import get_engine, init_db
from .live_session import SessionManager
from .models import Project, utcnow
from .obs import log, setup_logging
from .realtime import make_realtime
from .sandbox import make_provider


async def _idle_suspend_loop(app: FastAPI) -> None:
    """Suspend sandboxes whose session is idle AND has no live WebSocket."""
    settings = get_settings()
    while True:
        await asyncio.sleep(120)
        cutoff = utcnow() - timedelta(seconds=settings.idle_suspend_seconds)
        try:
            with Session(get_engine()) as db:
                stale = db.exec(select(Project).where(Project.last_active < cutoff)).all()
            for p in stale:
                if app.state.realtime.has_local_subscribers(p.id):
                    continue  # a live WebSocket is open — never suspend under it
                # Ably / disconnected: pings stopped → tear down the live session
                # (agent + watch) and suspend the sandbox.
                if p.id in app.state.session_manager.sessions:
                    await app.state.session_manager.dispose(p.id)
                await app.state.provider.suspend(p.sandbox_id)
                log.info("idle_suspend session=%s sandbox=%s", p.id, p.sandbox_id)
        except Exception as exc:  # never let the loop die
            log.warning("idle_suspend_loop error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    init_db()
    app.state.provider = make_provider()
    app.state.realtime = make_realtime()
    app.state.active_sessions = set()
    app.state.session_manager = SessionManager(app)
    idle_task = asyncio.create_task(_idle_suspend_loop(app))
    try:
        yield
    finally:
        idle_task.cancel()
        await app.state.realtime.aclose()
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
# Authlib stores the OAuth state/nonce in this signed session (Google flow).
app.add_middleware(
    SessionMiddleware,
    secret_key=_settings.session_secret,
    same_site="lax",
    https_only=bool(_settings.session_cookie_secure),
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(realtime_routes.router)
app.include_router(familysearch.router)
app.include_router(familysearch.callback_router)  # top-level /callback (reuses the FS desktop registration)
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


# Production single-origin serving: when WEB_DIST_DIR points at the built web
# client, serve it at "/" (mounted LAST so the API/auth/ws routes win). Inert in
# local dev, where Vite serves the client and proxies the API.
if _settings.web_dist_dir and _settings.web_dist_dir.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=str(_settings.web_dist_dir), html=True), name="web")
