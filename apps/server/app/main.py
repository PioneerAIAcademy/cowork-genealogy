"""FastAPI control plane — app wiring.

Responsibilities: unified FamilySearch app login + allowlist + per-user tokens,
session/sandbox orchestration, the viewer read API, the image proxy, and feedback
intake. The realtime data path lives in the in-sandbox WS server
(app/sandbox_server.py), which the browser connects to directly via /connect — the
control plane is out of the streaming path (affinity-free on AWS-no-sticky).
"""
from __future__ import annotations

from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

import asyncio
import logging

from sqlmodel import Session, select

from . import anthropic_proxy, auth, feedback, sandbox_heartbeat, sessions
from .config import assert_production_config, get_settings
from .db import get_engine, init_db
from .models import FamilySearchToken, Project, User, utcnow
from .obs import setup_logging
from .sandbox import make_provider

log = logging.getLogger(__name__)

_REVOKE_TIMEOUT = 30.0


async def _revoke_sandboxes(provider) -> None:
    """Destroy active sandboxes belonging to users not on the current allowlist.

    Computed fresh each boot so a failed prior attempt is retried automatically.
    Only runs when FamilySearch OAuth is the login gate (same condition as the
    per-request allowlist check in auth.py). Best-effort: DB or provider errors
    are logged, never crash startup.
    """
    settings = get_settings()
    if not settings.familysearch_configured or not settings.allowlist:
        return
    try:
        with Session(get_engine()) as session:
            provisioned = settings.allowlist
            projects = session.exec(
                select(Project).join(User).where(
                    User.email.not_in(provisioned),  # type: ignore[union-attr]
                    Project.status == "active",
                )
            ).all()
            if not projects:
                return

            succeeded: set[str] = set()

            async def _delete_one(project: Project) -> None:
                try:
                    await asyncio.wait_for(
                        provider.delete(project.sandbox_id), timeout=_REVOKE_TIMEOUT
                    )
                    succeeded.add(project.id)
                    log.info("Revoked sandbox %s for de-provisioned user", project.sandbox_id)
                except Exception:
                    log.warning("Failed to revoke sandbox %s", project.sandbox_id, exc_info=True)

            await asyncio.gather(*(_delete_one(p) for p in projects))

            for project in projects:
                if project.id in succeeded:
                    project.status = "archived"

            now = utcnow()
            for user_id in {p.user_id for p in projects}:
                row = session.get(FamilySearchToken, user_id)
                if row is not None:
                    session.delete(row)
                user = session.get(User, user_id)
                if user is not None:
                    user.sessions_revoked_at = now
                    session.add(user)

            session.commit()
    except Exception:
        log.warning("Sandbox revocation sweep failed", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # FIRST — before logging, the DB or the provider. A production deploy still on
    # the dev-default secrets is refused here rather than coming up and minting
    # forgeable cookies and WS tokens. See config.assert_production_config.
    assert_production_config(get_settings())
    setup_logging()
    init_db()
    app.state.provider = make_provider()
    app.state.anthropic_proxy_client = anthropic_proxy.make_upstream_client()
    await _revoke_sandboxes(app.state.provider)
    # research-as-a-job 1d: keep a live sandbox's continuous-runtime clock running while
    # its agent works. E2B's Hobby ceiling is 3600 s and it clocks RUNTIME, not idleness,
    # so once one user message is a whole research job the session ages out mid-turn --
    # at or before the corpus p90 of 107.9 minutes. See app/sandbox_heartbeat.py for the
    # interval and what a missed beat costs.
    app.state.heartbeat_task = asyncio.create_task(
        sandbox_heartbeat.run_heartbeat(app.state.provider)
    )
    try:
        yield
    finally:
        app.state.heartbeat_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.heartbeat_task
        if hasattr(app.state.anthropic_proxy_client, "aclose"):
            await app.state.anthropic_proxy_client.aclose()
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
app.include_router(anthropic_proxy.router)


@app.get("/api/health")
def health(request: Request) -> dict:
    """Liveness + what this deployment is running.

    `sandboxImageCommit` is the commit baked into the E2B agent image, read off
    the last sandbox this process created. It describes the **sandbox** image,
    NOT this Fly container — `Settings.git_sha` / `build_date` describe that one,
    and the two are built from separate Dockerfiles. Null until this process has
    created its first session, and under any provider that bakes no image.

    Fly polls this route as its health check (`deploy/fly.toml`: every 15s, 5s
    timeout, 20s grace, against the single always-on machine), so it must stay a
    pure in-memory read. It never calls E2B: the provenance is cached at sandbox
    create, and a missing provider attribute degrades to None rather than raising
    a 500 that would take production out of rotation.
    """
    provider = getattr(request.app.state, "provider", None)
    try:
        image_commit = getattr(provider, "sandbox_image_commit", None)
    except Exception:  # noqa: BLE001
        # getattr's default only swallows AttributeError. The base class declares
        # this a plain read, but a provider that computed it in a property would
        # otherwise 500 Fly's health check and pull the machine out of rotation
        # over a field that is purely observability.
        image_commit = None
    return {
        "ok": True,
        "agentMode": _settings.agent_mode,
        "provider": _settings.sandbox_provider,
        "db": "sqlite" if _settings.is_sqlite else "postgres",
        "sandboxImageCommit": image_commit,
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
