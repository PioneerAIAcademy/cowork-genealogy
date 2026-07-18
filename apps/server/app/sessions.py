"""Session REST. session == project == sandbox, 1:1. The landing-screen list,
plus create / resume / delete. Creating a session provisions a sandbox via the
SandboxProvider and records the user→sandbox map in `projects`.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import fs_oauth
from .auth import get_current_user
from .config import get_settings
from .db import get_session
from .models import FamilySearchToken, Project, User, utcnow
from .sandbox import SandboxProvider, SandboxSpec
from .sandbox.base import PROJECT_DIR, SANDBOX_WS_PORT
from .ws_token import mint_token
from .seed import seed_sample_project

# Sidecar log ids are filenames; constrain them so a crafted id can't escape the
# results dir (the validate_research_schema path-traversal concern, spec §13).
_LOG_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
# Persisted source scans: images/<sanitized-key>.jpg (engine image-store.ts).
# Rejects subdirectories, traversal, and any other extension.
_IMAGE_REF_RE = re.compile(r"^images/[A-Za-z0-9._-]+\.jpg$")
# Researcher uploads land in <project>/uploads/ — inside the project folder, so
# the agent reads them with a relative path and they ride along in a feedback
# bundle. The name is taken as a basename and constrained; no subdirectories.
_UPLOAD_DIR = "uploads"
_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
_UPLOAD_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$")

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def get_provider(request: Request) -> SandboxProvider:
    return request.app.state.provider


class ProjectOut(BaseModel):
    id: str
    title: str
    model: str
    status: str
    sandbox_id: str
    agent_session_id: str | None
    created: datetime
    updated: datetime
    last_active: datetime

    @classmethod
    def of(cls, p: Project) -> "ProjectOut":
        return cls(
            id=p.id, title=p.title, model=p.model, status=p.status,
            sandbox_id=p.sandbox_id, agent_session_id=p.agent_session_id,
            created=p.created, updated=p.updated, last_active=p.last_active,
        )


class FsTokenIn(BaseModel):
    """A FamilySearch token bundle a `/v1` client supplies at session create. Unlike
    the browser path (whose token comes from the FS app-login row), `/v1` clients never
    run FS OAuth, so they pass the token here; it is injected straight into the sandbox
    and **never persisted** to the control-plane DB.

    Include `refresh_token` (OAuth `offline_access`) so the in-sandbox MCP can
    self-refresh: with it the session lasts as long as the sandbox; without it the
    session works only until the access token expires (FS access tokens last ~1h, so a
    multi-hour session needs the refresh token)."""
    access_token: str = Field(min_length=1)
    refresh_token: str | None = None
    expires_in: int | None = None  # seconds from now; defaults to 3600 (FS default)


class CreateSessionBody(BaseModel):
    title: str | None = None
    model: str | None = None
    # Seed a ready-made sample project so the viewer renders immediately
    # (useful before the agent path is wired / for demoing the viewer).
    sample: bool = False


class PatchSessionBody(BaseModel):
    title: str | None = None
    model: str | None = None


def _owned(session: Session, user: User, session_id: str) -> Project:
    project = session.get(Project, session_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    return project


_DEFAULT_TITLE = "New research session"


def _derive_title_from_objective(objective: str | None) -> str | None:
    """A concise, Claude-style session title from the agent's research objective.
    Genealogy objectives lead with the subject clause ("Identify the parents of
    Mary Sullivan, born ca. 1860 …"), so take the text before the first comma,
    then cap at a word boundary."""
    if not objective:
        return None
    head = objective.strip().split(",", 1)[0].strip()
    if not head:
        return None
    if len(head) > 60:
        head = head[:60].rsplit(" ", 1)[0].rstrip() + "…"
    return head


def _maybe_backfill_title(session: Session, project: Project, research: object) -> None:
    """Fallback session naming for a still-default session. The browser relays
    the agent-written project.title live (the primary path); this backstops the
    cases with no browser relaying (e.g. the /v1 API). Prefer the agent's title;
    derive from the objective only for legacy projects without one. One-time,
    persisted — keeps the list from being a wall of 'New research session'."""
    if project.title != _DEFAULT_TITLE or not isinstance(research, dict):
        return
    proj = research.get("project") if isinstance(research.get("project"), dict) else {}
    title = proj.get("title") or _derive_title_from_objective(proj.get("objective"))
    if title and title != project.title:
        project.title = title
        project.updated = utcnow()
        session.add(project)
        session.commit()
        session.refresh(project)


async def create_project(
    *,
    session: Session,
    provider: SandboxProvider,
    user: User,
    title: str | None = None,
    model: str | None = None,
    sample: bool = False,
    fs_token: FsTokenIn | None = None,
) -> Project:
    """Provision a sandbox + record the user→sandbox map. Shared by the browser
    `create_session` route and the public `/v1` create route.

    `fs_token`, when given, is a caller-supplied FamilySearch token (the `/v1` path)
    that takes precedence over the user's stored row and is injected but not persisted.
    """
    import uuid

    settings = get_settings()
    model = model or settings.default_model
    sandbox = await provider.create(
        SandboxSpec(template=settings.e2b_template, labels={"user_id": user.id}, model=model)
    )
    # Inject the FamilySearch token so the in-sandbox MCP is authenticated without an
    # interactive login (which it cannot run). Two sources, explicit wins:
    #   • /v1: the caller supplies the token in the create request (no DB row exists —
    #     /v1 clients authenticate by bearer key, never via FS OAuth).
    #   • browser: the user's row, persisted at FS app login (the front door).
    # The offline/dev-login (mock-agent) path has neither and needs none — mock mode
    # never reads it. In create_project (not the route) so the /v1 path injects too.
    if fs_token is not None:
        token_json = {"expires_in": fs_token.expires_in} if fs_token.expires_in is not None else {}
        await fs_oauth.write_tokens(
            sandbox, fs_token.access_token, fs_token.refresh_token,
            fs_oauth.expires_at_from(token_json),
        )
    else:
        row = session.get(FamilySearchToken, user.id)
        if row is not None:
            await fs_oauth.write_tokens(
                sandbox, row.access_token, row.refresh_token, row.expires_at
            )
    # Provision the OpenRouter key into the sandbox's ~/.familysearch-mcp/config.json
    # so the in-sandbox image_transcribe tool can OCR scans. Config-only (the MCP
    # server never reads env); see image-transcribe-tool-spec.md §6.5.
    if settings.openrouter_api_key:
        await fs_oauth.write_config(
            sandbox, {"openRouterApiKey": settings.openrouter_api_key}
        )
    if sample:
        await seed_sample_project(sandbox)

    project = Project(
        id="prj_" + uuid.uuid4().hex[:16],
        user_id=user.id,
        sandbox_id=sandbox.id,
        title=title or ("Sample research project" if sample else "New research session"),
        model=model,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.get("", response_model=list[ProjectOut])
def list_sessions(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[ProjectOut]:
    # Titles are kept current by the client relay (browser → patchSession the
    # moment the agent names the project) with a free backfill in /state as a
    # fallback, so the list just reads the DB — no per-row sandbox reads here.
    rows = session.exec(
        select(Project).where(Project.user_id == user.id, Project.status == "active")
        .order_by(Project.last_active.desc())
    ).all()
    return [ProjectOut.of(p) for p in rows]


@router.post("", response_model=ProjectOut)
async def create_session(
    body: CreateSessionBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> ProjectOut:
    project = await create_project(
        session=session, provider=provider, user=user,
        title=body.title, model=body.model, sample=body.sample,
    )
    return ProjectOut.of(project)


@router.get("/{session_id}", response_model=ProjectOut)
def get_session_detail(
    session_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ProjectOut:
    return ProjectOut.of(_owned(session, user, session_id))


@router.patch("/{session_id}", response_model=ProjectOut)
def patch_session(
    session_id: str,
    body: PatchSessionBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ProjectOut:
    project = _owned(session, user, session_id)
    if body.title is not None:
        project.title = body.title
    if body.model is not None:
        project.model = body.model
    project.updated = utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return ProjectOut.of(project)


@router.post("/{session_id}/resume", response_model=ProjectOut)
async def resume_session(
    session_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> ProjectOut:
    project = _owned(session, user, session_id)
    await provider.resume(project.sandbox_id)
    project.last_active = utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return ProjectOut.of(project)


def _safe_parse(raw: str | None):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


@router.get("/{session_id}/state")
async def session_state(
    session_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    """Viewer hydration: the current project snapshot (research + gedcomx +
    sidecar pointers). Served from the sandbox FS; available whenever the
    session resumes."""
    project = _owned(session, user, session_id)
    sandbox = await provider.resume(project.sandbox_id)
    snap = await sandbox.read_project_snapshot()
    research = _safe_parse(snap["research"])
    _maybe_backfill_title(session, project, research)  # name the session from its objective
    return {
        "label": project.title,
        "research": research,
        "gedcomx": _safe_parse(snap["gedcomx"]),
        "sidecars": snap["sidecars"],
    }


@router.get("/{session_id}/sidecar/{log_id}")
async def session_sidecar(
    session_id: str,
    log_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    if not _LOG_ID_RE.match(log_id) or ".." in log_id:
        raise HTTPException(status_code=400, detail="Invalid sidecar id")
    project = _owned(session, user, session_id)
    sandbox = await provider.get(project.sandbox_id)
    path = f"{PROJECT_DIR}/results/{log_id}.json"
    raw = await sandbox.read_file(path)
    if raw is None:
        raise HTTPException(status_code=404, detail="Sidecar not found")
    mtime = await sandbox.file_mtime(path) or 0
    return {"raw": raw.decode("utf-8"), "mtime": mtime}


@router.get("/{session_id}/image")
async def session_image(
    session_id: str,
    filename: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> Response:
    """Serve a persisted source page scan (images/<key>.jpg) from the session's
    sandbox project folder, so the web viewer can show it beside a transcription
    (§8.5). `filename` is validated to the images/<key>.jpg shape — no traversal,
    no other path — mirroring the engine + Electron readers."""
    if not _IMAGE_REF_RE.match(filename) or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid image filename")
    project = _owned(session, user, session_id)
    sandbox = await provider.get(project.sandbox_id)
    raw = await sandbox.read_file(f"{PROJECT_DIR}/{filename}")
    if raw is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(content=raw, media_type="image/jpeg")


@router.post("/{session_id}/files")
async def upload_session_file(
    session_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    """Write a researcher-supplied document/image into <project>/uploads/.

    This is the only way bytes get into a session. The FamilySearch tools reach
    FS-hosted record images, but a scan from another site, a county PDF, or a
    photo of a family bible has no path in without it — the researcher could
    only describe it. The agent reads the result with a relative path
    ("uploads/<name>"), and because it lives in the project folder it is also
    captured in any feedback bundle.
    """
    project = _owned(session, user, session_id)

    # Basename only: a client-supplied name may carry a path (some browsers send
    # one for directory uploads) and must never steer the write.
    raw_name = (file.filename or "").replace("\\", "/").split("/")[-1].strip()
    if not _UPLOAD_NAME_RE.match(raw_name) or ".." in raw_name:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid filename. Use letters, numbers, spaces, dots, dashes or "
                "underscores (max 120 characters)."
            ),
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")
    if len(data) > _UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"That file is larger than the {_UPLOAD_MAX_BYTES // (1024 * 1024)} MB limit.",
        )

    sandbox = await provider.resume(project.sandbox_id)
    rel = f"{_UPLOAD_DIR}/{raw_name}"
    await sandbox.write_file(f"{PROJECT_DIR}/{rel}", data)
    return {"path": rel, "sizeBytes": len(data)}


@router.get("/{session_id}/logs")
async def session_logs(
    session_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    """Debug: tail the in-sandbox logs. /tmp/ws.log = WS server lifecycle (spawn,
    client connect/disconnect, agent exit + code); /tmp/agent.log = agent_runner
    stderr / tracebacks. Last ~20 KB each. Empty under the local_ws backend."""
    project = _owned(session, user, session_id)
    sandbox = await provider.get(project.sandbox_id)
    out: dict[str, str] = {}
    for name, p in (("ws", "/tmp/ws.log"), ("agent", "/tmp/agent.log")):
        raw = await sandbox.read_file(p)
        out[name] = raw.decode("utf-8", "replace")[-20000:] if raw else ""
    return out


@router.post("/{session_id}/connect")
async def connect_session(
    session_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    """Make a session live + tell the client how to reach it: resume the sandbox,
    start/expose its in-sandbox WS server, and mint a per-sandbox handshake token.
    The browser then connects ONE WSS directly to the sandbox — control plane out
    of the streaming path. Identical for both providers (E2B microVM / local
    subprocess); each returns its own wss:// or ws:// URL."""
    project = _owned(session, user, session_id)
    sandbox = await provider.resume(project.sandbox_id)
    conn = await sandbox.expose_port(SANDBOX_WS_PORT)
    token = mint_token(project.sandbox_id)
    project.last_active = utcnow()
    session.add(project)
    session.commit()
    return {"wssUrl": conn.url, "token": token}


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    project = _owned(session, user, session_id)
    await provider.delete(project.sandbox_id)
    session.delete(project)
    session.commit()
    return {"ok": True}
