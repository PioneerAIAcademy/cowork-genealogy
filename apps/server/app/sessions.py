"""Session REST. session == project == sandbox, 1:1. The landing-screen list,
plus create / resume / delete. Creating a session provisions a sandbox via the
SandboxProvider and records the user→sandbox map in `projects`.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from .auth import get_current_user
from .config import get_settings
from .db import get_session
from .models import Project, User, utcnow
from .sandbox import SandboxProvider, SandboxSpec
from .sandbox.base import PROJECT_DIR
from .seed import seed_sample_project

# Sidecar log ids are filenames; constrain them so a crafted id can't escape the
# results dir (the validate_research_schema path-traversal concern, spec §13).
_LOG_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")

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


@router.get("", response_model=list[ProjectOut])
def list_sessions(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[ProjectOut]:
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
    import uuid

    settings = get_settings()
    model = body.model or settings.default_model
    sandbox = await provider.create(
        SandboxSpec(template=settings.e2b_template, labels={"user_id": user.id}, model=model)
    )
    if body.sample:
        await seed_sample_project(sandbox)

    project = Project(
        id="prj_" + uuid.uuid4().hex[:16],
        user_id=user.id,
        sandbox_id=sandbox.id,
        title=body.title or ("Sample research project" if body.sample else "New research session"),
        model=model,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
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
    return {
        "label": project.title,
        "research": _safe_parse(snap["research"]),
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
