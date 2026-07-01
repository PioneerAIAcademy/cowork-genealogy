"""Web feedback intake. Bundles the in-sandbox /project files + the agent's
conversation transcript into a zip and POSTs it to the **same Google Apps Script
-> Drive endpoint the Electron viewer uses** (config.feedback_url / FEEDBACK_URL).
No local-disk write, so the control plane scales to >1 instance. The zip structure
+ feedback.json schema match the Electron flow so the existing feedback-case
triage workflow (docs/feedback-workflow.md) consumes it unchanged.

The transcript is the Claude Code session JSONL the Agent SDK writes inside the
sandbox; it carries the narration, full tool I/O, and the agent's reasoning that
the persisted /project files do not. See docs/specs/feedback-case-spec.md and the
session-log discussion for why this is the highest-value part of the bundle.
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
from .sandbox.base import HOME_DIR, PROJECT_DIR
from .sessions import _owned, get_provider

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

FEEDBACK_SCHEMA_VERSION = 1
_MAX_FIELD_CHARS = 10_000

# The agent's Claude Code transcript lives under HOME, in a dir slugged from the
# agent's cwd (PROJECT_DIR) the way Claude Code names project dirs: leading "/"
# dropped, remaining "/" -> "-", whole thing prefixed with "-" ("/project" ->
# "-project"). Verified against a live E2B sandbox:
#   /home/user/.claude/projects/-project/<session-id>.jsonl
_CLAUDE_PROJECT_SLUG = "-" + PROJECT_DIR.lstrip("/").replace("/", "-")
_CLAUDE_PROJECTS_DIR = f"{HOME_DIR}/.claude/projects/{_CLAUDE_PROJECT_SLUG}"
# Backstop so a pathological session can't blow past the Drive/Apps Script POST
# limit. The reported failure is ~always at the end, so we keep the newest entries.
_SESSION_LOG_CAP_BYTES = 20 * 1024 * 1024


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


def _filter_transcript(raw: bytes) -> bytes | None:
    """Reduce a raw Claude Code transcript to the conversation: user + assistant
    entries scoped to PROJECT_DIR. Thinking blocks are **kept** — the agent's
    reasoning is the highest-value signal for triage, and it exists nowhere in the
    persisted /project files. Returns filtered JSONL bytes, or None if nothing
    qualifies."""
    kept: list[bytes] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except (ValueError, TypeError):
            continue  # skip malformed lines
        if entry.get("type") not in ("user", "assistant"):
            continue  # drop ai-title / last-prompt / attachment / queue-operation / system / summary
        cwd = entry.get("cwd")
        if cwd and cwd != PROJECT_DIR:
            continue
        kept.append(line)
    if not kept:
        return None
    out = b"\n".join(kept) + b"\n"
    if len(out) <= _SESSION_LOG_CAP_BYTES:
        return out
    # Over cap: keep the most recent entries that fit, with a (valid-JSON) marker
    # line that downstream user/assistant filters harmlessly ignore.
    tail: list[bytes] = []
    size = 0
    for line in reversed(kept):
        if size + len(line) + 1 > _SESSION_LOG_CAP_BYTES:
            break
        tail.append(line)
        size += len(line) + 1
    tail.reverse()
    note = json.dumps(
        {
            "type": "_truncation_note",
            "dropped_leading_entries": len(kept) - len(tail),
            "reason": f"session log exceeded {_SESSION_LOG_CAP_BYTES} bytes; kept newest {len(tail)} entries",
        }
    ).encode("utf-8")
    return note + b"\n" + b"\n".join(tail) + b"\n"


async def _session_log(sandbox) -> bytes | None:
    """The Claude Code conversation transcript for the agent's most recent session,
    filtered for the bundle (see `_filter_transcript`). Prefers the exact session
    id the agent resumes from (`PROJECT_DIR/.agent_session`), falling back to the
    newest `*.jsonl` in the projects dir. Returns None when no transcript exists
    (e.g. mock-mode local runs, or a session that never started the agent)."""
    raw: bytes | None = None
    sid_raw = await sandbox.read_file(f"{PROJECT_DIR}/.agent_session")
    sid = sid_raw.decode("utf-8", "replace").strip() if sid_raw else ""
    if sid:
        raw = await sandbox.read_file(f"{_CLAUDE_PROJECTS_DIR}/{sid}.jsonl")
    if raw is None:
        newest_mtime, newest_path = -1.0, None
        for entry in await sandbox.list_dir(_CLAUDE_PROJECTS_DIR):
            if entry.is_dir or not entry.name.endswith(".jsonl"):
                continue
            mt = await sandbox.file_mtime(entry.path) or 0.0
            if mt > newest_mtime:
                newest_mtime, newest_path = mt, entry.path
        if newest_path is not None:
            raw = await sandbox.read_file(newest_path)
    if not raw:
        return None
    return _filter_transcript(raw)


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
    log = await _session_log(sandbox)
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
        parts += [
            "",
            "## Session log",
            "",
            "See `_feedback/session-log.jsonl` — the full Claude Code conversation "
            "transcript (user turns, tool calls, results, and the agent's reasoning).",
        ]
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

    # The Claude Code conversation transcript (narration + full tool I/O + the
    # agent's reasoning). None when the agent never ran or in mock-mode local runs.
    session_log = (await _session_log(sandbox)) if body.includeSessionLog else None

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
