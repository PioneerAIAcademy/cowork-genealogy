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

# Mirrors apps/electron/src/main/feedback.ts so a web case and a desktop case
# unzip to the same shape and the triage workflow consumes them identically.
_MEDIA_EXTS = frozenset(
    {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp",
     ".mp3", ".wav", ".m4a", ".ogg", ".mp4", ".mov", ".avi"}
)
_TEXT_EXTS = frozenset({".json", ".md", ".txt", ".csv", ".tsv", ".yaml", ".yml"})
_INDIVIDUAL_FILE_CAP_BYTES = 25 * 1024 * 1024
_ZIP_CAP_BYTES = 35 * 1024 * 1024


def _ext(name: str) -> str:
    dot = name.rfind(".")
    return name[dot:].lower() if dot > 0 else ""


async def _walk_project(sandbox) -> list[tuple[str, bytes]]:
    """(relativePath, bytes) for every file under PROJECT_DIR, recursively.

    Matches the Electron walker: skips dotfiles and dot-directories, and skips
    any single file over the per-file cap. Previously this returned only
    research.json / tree.gedcomx.json / results/*.json, which meant a web case
    could not reproduce anything touching the rest of the project (uploads,
    CLAUDE.md, images). DirEntry carries no size, so the read is what tells us
    how big a file is — fine for a project folder, which is small by design.
    """
    out: list[tuple[str, bytes]] = []

    async def walk(dir_path: str, prefix: str) -> None:
        for entry in await sandbox.list_dir(dir_path):
            if entry.name.startswith("."):
                continue
            rel = f"{prefix}{entry.name}"
            if entry.is_dir:
                await walk(entry.path, f"{rel}/")
                continue
            raw = await sandbox.read_file(entry.path)
            if raw is None or len(raw) > _INDIVIDUAL_FILE_CAP_BYTES:
                continue
            out.append((rel, raw))

    await walk(PROJECT_DIR, "")
    return out


def _select_files(
    files: list[tuple[str, bytes]], include_media: bool
) -> tuple[list[tuple[str, bytes]], list[str]]:
    """Apply the media toggle and the total-size cap.

    Returns (kept, dropped_relpaths). Over the cap we drop largest-first, which
    preserves the small structured JSON that triage actually reads and sheds the
    big binaries. Whatever gets dropped is named in FEEDBACK.md rather than
    vanishing silently.
    """
    def wanted(rel: str) -> bool:
        return include_media or _ext(rel) not in _MEDIA_EXTS

    kept = [(rel, data) for rel, data in files if wanted(rel)]
    dropped = [rel for rel, _ in files if not wanted(rel)]

    total = sum(len(d) for _, d in kept)
    if total > _ZIP_CAP_BYTES:
        for rel, data in sorted(kept, key=lambda kv: len(kv[1]), reverse=True):
            if total <= _ZIP_CAP_BYTES:
                break
            kept = [kv for kv in kept if kv[0] != rel]
            dropped.append(rel)
            total -= len(data)
    return kept, dropped


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
    # Ground truth, when the agent reached a *wrong conclusion* rather than just
    # working badly. Optional and always shown in the UI — the app can't tell
    # which kind of failure this is, so the tester decides whether to fill it in.
    # This is what lets a case become a test without going back to the submitter.
    correctAnswer: str = ""
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
        {
            "relativePath": rel,
            "sizeBytes": len(data),
            "isMedia": _ext(rel) in _MEDIA_EXTS,
            "isText": _ext(rel) in _TEXT_EXTS,
        }
        for rel, data in await _walk_project(sandbox)
    ]
    log = await _session_log(sandbox)
    return {"files": files, "sessionLogSize": len(log) if log else 0, "hasSessionLog": bool(log)}


def _norm(v: str) -> str:
    v = (v or "").strip()
    if len(v) > _MAX_FIELD_CHARS:
        raise HTTPException(status_code=400, detail=f"A feedback field exceeds {_MAX_FIELD_CHARS} chars")
    return v


def _feedback_markdown(
    f: dict,
    submitted_at: str,
    project_label: str,
    session_log: bool,
    viewer_version: str,
    dropped: list[str] | None = None,
) -> str:
    parts = [
        "# Feedback",
        "",
        f"- **From:** {f['email']}",
        f"- **When:** {submitted_at}",
        f"- **Viewer version:** {viewer_version}",
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
    if f["correctAnswer"]:
        parts += ["", "## The correct answer, and the evidence for it", "", f["correctAnswer"]]
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
    if dropped:
        parts += [
            "",
            "## Files not included",
            "",
            "Left out of this bundle (media excluded, or over the total size cap):",
            "",
            *[f"- `{rel}`" for rel in sorted(dropped)],
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
        "correctAnswer": _norm(body.correctAnswer),
        "notes": _norm(body.notes or ""),
    }
    submitted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # The Claude Code conversation transcript (narration + full tool I/O + the
    # agent's reasoning). None when the agent never ran or in mock-mode local runs.
    session_log = (await _session_log(sandbox)) if body.includeSessionLog else None

    settings = get_settings()
    # Human-readable date first — a triager reading a stack of cases dates one at
    # a glance; the sha is there when they need the exact checkout.
    viewer_version = f"web {settings.build_date} ({settings.git_sha})"

    feedback_json = {
        "schema_version": FEEDBACK_SCHEMA_VERSION,
        "submitted_at": submitted_at,
        "viewer_version": viewer_version,
        "build_date": settings.build_date,
        "git_sha": settings.git_sha,
        "platform": "web",
        "email": fields["email"],
        "project_folder_path": body.sessionId,  # web analog of the local folder
        "user_prompt": fields["userPrompt"],
        "agent_did": fields["agentDid"],
        "agent_should_have": fields["agentShouldHave"],
        "correct_answer": fields["correctAnswer"],
        "notes": fields["notes"],
    }

    project_files, dropped = _select_files(await _walk_project(sandbox), body.includeMedia)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, data in project_files:
            zf.writestr(rel, data)
        zf.writestr(
            "FEEDBACK.md",
            _feedback_markdown(
                fields, submitted_at, project.title, bool(session_log), viewer_version, dropped
            ),
        )
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
