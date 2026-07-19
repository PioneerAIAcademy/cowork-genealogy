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

from . import auth, feedback, sessions, v1
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
