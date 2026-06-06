"""Web feedback intake. Bundles the in-sandbox /project files + agent log into a
zip and POSTs it to the **same Google Apps Script -> Drive endpoint the Electron
viewer uses** (config.feedback_url / FEEDBACK_URL). No local-disk write, so the
control plane scales to >1 instance. The zip structure + feedback.json schema
match the Electron flow so the existing feedback-case triage workflow
(docs/feedback-workflow.md) consumes it unchanged.
"""
from __future__ import annotations

import base64
import io
import json
import zipfile
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
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

FEEDBACK_SCHEMA_VERSION = 1
_MAX_FIELD_CHARS = 10_000


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
    files = [
        {"relativePath": rel, "sizeBytes": len(data), "isMedia": False, "isText": True}
        for rel, data in await _project_files(sandbox)
    ]
    log = await sandbox.read_file("/agent.log")
    return {"files": files, "sessionLogSize": len(log) if log else 0, "hasSessionLog": bool(log)}


def _norm(v: str) -> str:
    v = (v or "").strip()
    if len(v) > _MAX_FIELD_CHARS:
        raise HTTPException(status_code=400, detail=f"A feedback field exceeds {_MAX_FIELD_CHARS} chars")
    return v


def _feedback_markdown(f: dict, submitted_at: str, project_label: str, session_log: bool) -> str:
    parts = [
        "# Feedback",
        "",
        f"- **From:** {f['email']}",
        f"- **When:** {submitted_at}",
        "- **Viewer version:** web-poc",
        f"- **Project:** {project_label}",
        "",
        "## What I asked",
        "",
        f["userPrompt"],
        "",
        "## What the agent did",
        "",
        f["agentDid"],
        "",
        "## What it should have done",
        "",
        f["agentShouldHave"],
    ]
    if f["notes"]:
        parts += ["", "## Notes", "", f["notes"]]
    if session_log:
        parts += ["", "## Session log", "", "See `_feedback/session-log.jsonl`."]
    return "\n".join(parts) + "\n"


@router.post("")
async def submit_feedback(
    body: FeedbackBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> dict:
    project = _owned(session, user, body.sessionId)
    sandbox = await provider.resume(project.sandbox_id)

    fields = {
        "email": _norm(body.email).lower(),
        "userPrompt": _norm(body.userPrompt),
        "agentDid": _norm(body.agentDid),
        "agentShouldHave": _norm(body.agentShouldHave),
        "notes": _norm(body.notes or ""),
    }
    submitted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # session log (the agent runner log is the POC's session-log analog)
    session_log = (await sandbox.read_file("/agent.log")) if body.includeSessionLog else None

    feedback_json = {
        "schema_version": FEEDBACK_SCHEMA_VERSION,
        "submitted_at": submitted_at,
        "viewer_version": "web-poc",
        "platform": "web",
        "email": fields["email"],
        "project_folder_path": body.sessionId,  # web analog of the local folder
        "user_prompt": fields["userPrompt"],
        "agent_did": fields["agentDid"],
        "agent_should_have": fields["agentShouldHave"],
        "notes": fields["notes"],
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, data in await _project_files(sandbox):
            zf.writestr(rel, data)
        zf.writestr("FEEDBACK.md", _feedback_markdown(fields, submitted_at, project.title, bool(session_log)))
        zf.writestr("_feedback/feedback.json", json.dumps(feedback_json, indent=2) + "\n")
        if session_log:
            zf.writestr("_feedback/session-log.jsonl", session_log)

    filename = f"feedback-{submitted_at.replace(':', '-').replace('.', '-')}.zip"
    envelope = {
        "timestamp": submitted_at,
        "email": fields["email"],
        "filename": filename,
        "zipBase64": base64.b64encode(buf.getvalue()).decode("ascii"),
    }

    url = get_settings().feedback_url
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            res = await client.post(url, json=envelope)
            res.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Feedback upload failed: {exc}") from exc

    return {"ok": True, "filename": filename}
