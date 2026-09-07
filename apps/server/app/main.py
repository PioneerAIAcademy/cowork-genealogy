"""FastAPI control plane — app wiring.

Responsibilities: unified FamilySearch app login + allowlist + per-user tokens,
session/sandbox orchestration, the viewer read API, the image proxy, and feedback
intake. The realtime data path lives in the in-sandbox WS server
(app/sandbox_server.py), which the browser connects to directly via /connect — the
control plane is out of the streaming path (affinity-free on AWS-no-sticky).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import logging

from . import auth, feedback, sessions, v1
from .config import assert_production_config, get_settings
from .db import init_db
from .obs import setup_logging
from .sandbox import make_provider

log = logging.getLogger(__name__)


async def _revoke_sandboxes(removed_emails: set[str], provider) -> None:
    """Destroy active sandboxes belonging to de-provisioned users."""
    if not removed_emails:
        return
    from sqlmodel import Session, select
    from .db import get_engine
    from .models import Project, User

    with Session(get_engine()) as session:
        users = session.exec(
            select(User).where(User.email.in_(removed_emails))  # type: ignore[union-attr]
        ).all()
        if not users:
            return
        user_ids = [u.id for u in users]
        projects = session.exec(
            select(Project).where(
                Project.user_id.in_(user_ids),  # type: ignore[union-attr]
                Project.status == "active",
            )
        ).all()
    for project in projects:
        try:
            await provider.delete(project.sandbox_id)
            log.info("Revoked sandbox %s for de-provisioned user", project.sandbox_id)
        except Exception:
            log.warning(
                "Failed to revoke sandbox %s", project.sandbox_id, exc_info=True
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # FIRST — before logging, the DB or the provider. A production deploy still on
    # the dev-default secrets is refused here rather than coming up and minting
    # forgeable cookies and WS tokens. See config.assert_production_config.
    assert_production_config(get_settings())
    setup_logging()
    removed = init_db()
    app.state.provider = make_provider()
    await _revoke_sandboxes(removed, app.state.provider)
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
app.include_router(auth.callback_router)  # top-level /callback (reuses the FS desktop registration)
app.include_router(sessions.router)
app.include_router(feedback.router)
app.include_router(v1.router)


# ── /v1 error envelope ───────────────────────────────────────────
# The public API speaks one shape for every error: {"error":{code,message}}.
# These must be APP-level (not router-scoped): the 401 is raised inside the bearer
# dependency and the 422 is FastAPI's RequestValidationError — both fire before/
# outside a router's handlers. Key on the /v1 path prefix so /api/* shapes are
# untouched (fall through to FastAPI's defaults).
_V1_CODE_BY_STATUS = {
    400: "validation_error", 401: "unauthorized", 403: "forbidden",
    404: "session_not_found", 409: "session_busy", 422: "validation_error",
    500: "internal_error", 504: "turn_timeout",
}


@app.exception_handler(StarletteHTTPException)
async def _v1_http_exception_handler(request, exc: StarletteHTTPException):
    if not request.url.path.startswith("/v1"):
        return await http_exception_handler(request, exc)
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        error = {"code": detail["code"], "message": detail.get("message", "")}
    else:
        error = {
            "code": _V1_CODE_BY_STATUS.get(exc.status_code, "internal_error"),
            "message": detail if isinstance(detail, str) else "Request failed",
        }
    return JSONResponse(
        status_code=exc.status_code, content={"error": error},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def _v1_validation_exception_handler(request, exc: RequestValidationError):
    if not request.url.path.startswith("/v1"):
        return await request_validation_exception_handler(request, exc)
    errors = exc.errors()
    message = errors[0].get("msg", "Invalid request") if errors else "Invalid request"
    return JSONResponse(
        status_code=422, content={"error": {"code": "validation_error", "message": message}},
    )


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "agentMode": _settings.agent_mode,
        "provider": _settings.sandbox_provider,
        "db": "sqlite" if _settings.is_sqlite else "postgres",
    }


# Production single-origin serving: when WEB_DIST_DIR points at the built web
# client, serve it at "/" (mounted LAST so the API/auth routes win). Inert in
# local dev, where Vite serves the client and proxies the API.
if _settings.web_dist_dir and _settings.web_dist_dir.is_dir():
    from starlette.staticfiles import StaticFiles

    class _SpaStaticFiles(StaticFiles):
        """Serve index.html with `Cache-Control: no-cache` so a redeploy's new
        (content-hashed) asset references are picked up on the next load. Without
        it a browser serves a cached index.html pointing at the OLD bundle and the
        UI looks stale until a hard refresh. The /assets/* files are content-hashed
        (immutable), so they stay fully cacheable under StaticFiles' defaults."""

        async def get_response(self, path: str, scope):
            resp = await super().get_response(path, scope)
            if path in ("", ".", "index.html") or path.endswith(".html"):
                resp.headers["Cache-Control"] = "no-cache"
            return resp

    app.mount("/", _SpaStaticFiles(directory=str(_settings.web_dist_dir), html=True), name="web")
