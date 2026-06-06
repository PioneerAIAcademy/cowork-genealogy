"""Web feedback intake. The Electron flow zips the local project folder + the
local ~/.claude session log and POSTs to a Google Apps Script. The web flow has
no local Claude session — the transcript lives in the sandbox — so this bundles
the in-sandbox /project files + the agent log and saves the zip to the server's
local backup dir (the POC stand-in for an object store / Drive upload).
"""
from __future__ import annotations

import io
import json
import uuid
import zipfile

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from .auth import get_current_user
from .config import get_settings
from .db import get_session
from .models import Project, User
from .sandbox import SandboxProvider
from .sandbox.base import PROJECT_DIR
from .sessions import _owned, get_provider

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

_TEXT_EXT = {".json", ".md", ".txt", ".csv", ".tsv", ".yaml", ".yml", ".jsonl"}


async def _project_files(sandbox) -> list[tuple[str, bytes]]:
    """(relativePath, bytes) for research.json, tree.gedcomx.json, results/*."""
    out: list[tuple[str, bytes]] = []
    for name in ("research.json", "tree.gedcomx.json"):
        raw = await sandbox.read_file(f"{PROJECT_DIR}/{name}")
        if raw is not None:
            out.append((name, raw))
    for entry in await sandbox.list_dir(f"{PROJECT_DIR}/results"):
        if not entry.is_dir and entry.name.endswith(".json"):
            raw = await sandbox.read_file(entry.path)
            if raw is not None:
                out.append((f"results/{entry.name}", raw))
    return out


class FeedbackBody(BaseModel):
    sessionId: str
    email: str = ""
    userPrompt: str = ""
    agentDid: str = ""
    agentShouldHave: str = ""
    notes: str | None = None
    includeMedia: bool = False
    includeSessionLog: bool = True


@router.get("/context")
async def feedback_context(
    sessionId: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    project = _owned(session, user, sessionId)
    sandbox = await provider.resume(project.sandbox_id)
    files = []
    for rel, data in await _project_files(sandbox):
        files.append({
            "relativePath": rel, "sizeBytes": len(data),
            "isMedia": False, "isText": True,
        })
    log = await sandbox.read_file("/agent.log") if hasattr(sandbox, "read_file") else None
    return {
        "files": files,
        "sessionLogSize": len(log) if log else 0,
        "hasSessionLog": bool(log),
    }


@router.post("")
async def submit_feedback(
    body: FeedbackBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    project = _owned(session, user, body.sessionId)
    sandbox = await provider.resume(project.sandbox_id)

    meta = {
        "schema_version": 1,
        "email": body.email,
        "user_prompt": body.userPrompt,
        "agent_did": body.agentDid,
        "agent_should_have": body.agentShouldHave,
        "notes": body.notes,
        "session_id": body.sessionId,
        "title": project.title,
        "model": project.model,
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("_feedback/feedback.json", json.dumps(meta, indent=2))
        for rel, data in await _project_files(sandbox):
            zf.writestr(rel, data)
        if body.includeSessionLog:
            log = await sandbox.read_file("/agent.log")
            if log:
                zf.writestr("_feedback/agent-log.txt", log)

    filename = f"feedback-{body.sessionId}-{uuid.uuid4().hex[:8]}.zip"
    out = get_settings().backup_dir / "feedback"
    out.mkdir(parents=True, exist_ok=True)
    (out / filename).write_bytes(buf.getvalue())
    return {"ok": True, "filename": filename}
