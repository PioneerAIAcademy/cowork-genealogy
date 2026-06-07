"""FastAPI control plane — app wiring.

Responsibilities: Google auth + allowlist, FamilySearch OAuth + per-user tokens,
session/sandbox orchestration, the viewer read API, the image proxy, and feedback
intake. The realtime data path lives in the in-sandbox WS server
(app/sandbox_server.py), which the browser connects to directly via /connect — the
control plane is out of the streaming path (affinity-free on AWS-no-sticky).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from . import auth, familysearch, feedback, image_proxy, sessions
from .config import get_settings
from .db import init_db
from .obs import setup_logging
from .sandbox import make_provider


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
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
# Authlib stores the OAuth state/nonce in this signed session (Google flow).
app.add_middleware(
    SessionMiddleware,
    secret_key=_settings.session_secret,
    same_site="lax",
    https_only=bool(_settings.session_cookie_secure),
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(familysearch.router)
app.include_router(familysearch.callback_router)  # top-level /callback (reuses the FS desktop registration)
app.include_router(image_proxy.router)
app.include_router(feedback.router)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "agentMode": _settings.agent_mode,
        "provider": _settings.sandbox_provider,
    }


# Production single-origin serving: when WEB_DIST_DIR points at the built web
# client, serve it at "/" (mounted LAST so the API/auth routes win). Inert in
# local dev, where Vite serves the client and proxies the API.
if _settings.web_dist_dir and _settings.web_dist_dir.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=str(_settings.web_dist_dir), html=True), name="web")
