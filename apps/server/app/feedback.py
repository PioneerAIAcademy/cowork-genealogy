"""Web feedback intake. Bundles the in-sandbox /project files + the agent's
conversation transcript into a zip and POSTs it to the **same Google Apps Script
-> Drive endpoint the Electron viewer uses** (config.feedback_url / FEEDBACK_URL).
No local-disk write, so the control plane scales to >1 instance. The zip structure
+ feedback.json schema match the Electron flow so the existing feedback-case
triage workflow (docs/alpha-feedback-guide.md) consumes it unchanged.

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


TREE_FILENAME = "tree.gedcomx.json"
STARTING_TREE_FILENAME = "starting-tree.gedcomx.json"
# Both tree-shaped files a project folder can hold. starting-tree.gedcomx.json is
# the write-once completion-gate baseline (issue #1490); it carries the same
# living persons as tree.gedcomx.json and is bundled by the same non-media walk,
# so it must be redacted too or a feedback bundle would ship living details
# FamilySearch's terms forbid sharing.
_REDACTED_TREE_FILENAMES = frozenset({TREE_FILENAME, STARTING_TREE_FILENAME})
LIVING_GIVEN = "Living"
LIVING_SURNAME_FALLBACK = "Unknown"


def _is_living(person: dict) -> bool:
    """Whether a tree person must be treated as living.

    Same rule as the e2e fixture gate (eval/harness/e2e/author.py::living_gate):
    **absent is not deceased.** `living` is optional in simplified GedcomX, and
    defaulting a missing flag to "probably dead" is exactly the wrong bet for a
    bundle that is about to leave the user's machine.
    """
    return person.get("living") is not False


def _redact_person(person: dict) -> dict:
    """Reduce a living person to structure: no given name, dates, places, or ark.

    Keeps `id` (relationships reference it, so dropping the person would dangle
    every edge) and `gender`; the schema requires `id`/`gender`/`names`, and a
    name requires `id`/`given`/`surname` with `minItems: 1` on `names` — so the
    placeholder has to carry a surname rather than omit it. Surname is retained
    deliberately: it is already inferable from the deceased relatives around
    them, and "Living Spriggs" is the convention FamilySearch itself displays,
    so a triager reads it as redaction rather than as corrupt data.
    """
    names = person.get("names") or []
    first = names[0] if names else {}
    placeholder = {
        "id": first.get("id") or f"{person.get('id', 'unknown')}-name-1",
        "given": LIVING_GIVEN,
        "surname": first.get("surname") or LIVING_SURNAME_FALLBACK,
    }
    out = {"id": person.get("id"), "living": True, "names": [placeholder], "facts": []}
    if "gender" in person:
        out["gender"] = person["gender"]
    return out


def _redact_living(files: list[tuple[str, bytes]]) -> tuple[list[tuple[str, bytes]], int]:
    """Redact living persons out of the bundled tree before it leaves the sandbox.

    FamilySearch's terms forbid sharing living people's details, and a feedback
    bundle is a capture of a real family. Doing this at capture time (rather than
    at triage) means the data never reaches the Drive folder at all.

    Also clears `facts` on any Couple relationship touching a living person — a
    marriage date/place is as identifying as a birth. Returns the files with the
    tree rewritten, plus the number of persons redacted. Unparseable or
    unexpectedly-shaped trees are passed through untouched: this is a privacy
    filter, not a validator, and it must never be the reason a report fails to
    send.
    """
    out: list[tuple[str, bytes]] = []
    redacted = 0
    for rel, data in files:
        if rel not in _REDACTED_TREE_FILENAMES:
            out.append((rel, data))
            continue
        # Count into a per-file tally and fold it into the total only once the
        # file's rewrite has fully succeeded. _redact_person can raise partway
        # through the person loop (a malformed `names` entry), and this file then
        # ships UNTOUCHED via the except below — so a running counter would report
        # living records protected in a file that leaked them. The count must
        # describe the bytes actually written, not the persons visited.
        file_redacted = 0
        try:
            tree = json.loads(data.decode("utf-8"))
            persons = tree.get("persons")
            if not isinstance(persons, list):
                raise ValueError("no persons array")
            living_ids = set()
            new_persons = []
            for person in persons:
                if isinstance(person, dict) and _is_living(person):
                    living_ids.add(person.get("id"))
                    new_persons.append(_redact_person(person))
                    file_redacted += 1
                else:
                    new_persons.append(person)
            tree["persons"] = new_persons
            for relationship in tree.get("relationships") or []:
                if not isinstance(relationship, dict) or "facts" not in relationship:
                    continue
                if {relationship.get("person1"), relationship.get("person2")} & living_ids:
                    relationship["facts"] = []
            data = json.dumps(tree, indent=2).encode("utf-8")
            redacted += file_redacted  # only the fully-rewritten file counts
        except Exception:  # noqa: BLE001 — never block a submission on this
            # Pass this file through untouched, and contribute nothing to the
            # count — file_redacted is discarded, so a file that failed partway
            # never reports the persons it visited before raising.
            pass
        out.append((rel, data))
    return out, redacted


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


def _filter_transcript(
    raw: bytes, *, cap: int = _SESSION_LOG_CAP_BYTES, allow_subdirs: bool = False
) -> bytes | None:
    """Reduce a raw Claude Code transcript to the conversation: user + assistant
    entries scoped to PROJECT_DIR. Thinking blocks are **kept** — the agent's
    reasoning is the highest-value signal for triage, and it exists nowhere in the
    persisted /project files. Returns filtered JSONL bytes, or None if nothing
    qualifies.

    `cap` is passed in rather than read from the module constant because the whole
    transcript SET now shares one budget (see `_session_log`) — a per-file cap
    times N files is unbounded, and the overflow lands as a 502 that costs the
    tester their submission.

    `allow_subdirs` accepts an entry whose `cwd` is BENEATH PROJECT_DIR, not only
    equal to it. A subagent sent to work in a subfolder stamps every line with
    that folder; under equality every line fails, the file filters to empty, and
    the transcript vanishes — measured, 1 of 12 local subagent transcripts. The
    parent keeps the strict test: it is the file whose scoping keeps a sibling
    project out of the bundle."""
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
            if not (allow_subdirs and cwd.startswith(PROJECT_DIR + "/")):
                continue
        kept.append(line)
    if not kept:
        return None
    out = b"\n".join(kept) + b"\n"
    if len(out) <= cap:
        return out
    # Over cap: keep the most recent entries that fit, with a (valid-JSON) marker
    # line that downstream user/assistant filters harmlessly ignore.
    tail: list[bytes] = []
    size = 0
    for line in reversed(kept):
        if size + len(line) + 1 > cap:
            break
        tail.append(line)
        size += len(line) + 1
    tail.reverse()
    note = json.dumps(
        {
            "type": "_truncation_note",
            "dropped_leading_entries": len(kept) - len(tail),
            "reason": f"session log exceeded {cap} bytes; kept newest {len(tail)} entries",
        }
    ).encode("utf-8")
    return note + b"\n" + b"\n".join(tail) + b"\n"


PARENT_LOG_ENTRY = "_feedback/session-log.jsonl"


def _group_prefix(sid: str, *, active: bool) -> str:
    """Where one session's transcripts live inside the zip.

    The active session keeps the historical names so every existing consumer
    (`docs/specs/feedback-case-spec.md` §2.2, the triage skills, the guardrail
    report) keeps working untouched. Any OTHER session ships as its own group,
    parent included — a subagent transcript is only usable beside the parent
    holding the `Agent` call that spawned it, because that call's id is the
    anchor the consumer splices at. A child with no parent in the bundle is
    ballast: it costs the tester bytes they consented to and the reader
    discards it.
    """
    return "_feedback/" if active else f"_feedback/sessions/{sid}/"


async def _read_group(sandbox, sid: str) -> tuple[bytes | None, list[tuple[str, bytes, bytes | None, float]]]:
    """`(raw parent bytes, [(name, raw transcript, raw meta, mtime), ...])` for
    one session id. Unfiltered and uncapped — the caller owns the budget."""
    parent = await sandbox.read_file(f"{_CLAUDE_PROJECTS_DIR}/{sid}.jsonl")
    subdir = f"{_CLAUDE_PROJECTS_DIR}/{sid}/subagents"
    children: list[tuple[str, bytes, bytes | None, float]] = []
    for entry in await sandbox.list_dir(subdir):
        if entry.is_dir or not entry.name.endswith(".jsonl"):
            continue
        raw = await sandbox.read_file(entry.path)
        if raw is None:
            continue
        name = entry.name[: -len(".jsonl")]
        meta = await sandbox.read_file(f"{subdir}/{name}.meta.json")
        children.append((name, raw, meta, await sandbox.file_mtime(entry.path) or 0.0))
    return parent, children


async def _session_log(
    sandbox, *, cap: int = _SESSION_LOG_CAP_BYTES
) -> tuple[list[tuple[str, bytes]], list[str]]:
    """`(entries, dropped)` — every Claude Code transcript this bundle carries,
    as `(zip relpath, bytes)`, plus the names of the ones that did not make it.

    Returns the whole SET rather than one blob so `feedback_context` and
    `submit_feedback` cannot disagree about what leaves the machine. Subagent
    transcripts are the reason: they live one level down at
    `{projects_dir}/{sid}/subagents/agent-*.jsonl` with a small
    `agent-*.meta.json` beside each, and two guardrail owner arms
    (`proof_summaries`, `questions.exhaustive_declaration`) do their protected
    write from inside one — invisible while a bundle carried only `{sid}.jsonl`
    (issue #1880).

    Every session directory is enumerated, not just the one `.agent_session`
    names: the SDK can hand back a different session id on resume and
    `agent/real_agent.py::_remember_session` persists it, so after a runner
    restart the transcripts sit under the OLD id. Reading one id there ships
    nothing, which looks exactly like a session that used no subagents.

    Nothing is filtered by `agentType`. The failure this evidence is most needed
    for is the model silently falling back to a general-purpose stand-in that
    binds none of the agent's declared tools (issue #939), and an allow-list
    drops precisely that transcript.

    Everything shares ONE `cap`, spent parent-first then newest-first, and
    anything dropped is NAMED — an unnamed drop reads downstream as "we looked
    and found nothing", which is the same invisible zero this all exists to
    kill.
    """
    sid_raw = await sandbox.read_file(f"{PROJECT_DIR}/.agent_session")
    active = sid_raw.decode("utf-8", "replace").strip() if sid_raw else ""
    if active and await sandbox.read_file(f"{_CLAUDE_PROJECTS_DIR}/{active}.jsonl") is None:
        active = ""

    session_ids: list[str] = []
    newest_mtime, newest_sid = -1.0, ""
    for entry in await sandbox.list_dir(_CLAUDE_PROJECTS_DIR):
        if entry.is_dir:
            session_ids.append(entry.name)
        elif entry.name.endswith(".jsonl"):
            sid = entry.name[: -len(".jsonl")]
            session_ids.append(sid)
            mt = await sandbox.file_mtime(entry.path) or 0.0
            if mt > newest_mtime:
                newest_mtime, newest_sid = mt, sid
    if not active:
        active = newest_sid
    if active and active not in session_ids:
        session_ids.append(active)

    entries: list[tuple[str, bytes]] = []
    dropped: list[str] = []
    spent = 0

    def admit(relpath: str, data: bytes) -> bool:
        nonlocal spent
        if spent + len(data) > cap:
            return False
        entries.append((relpath, data))
        spent += len(data)
        return True

    # Filtered parents, keyed by sid. The active one is admitted immediately —
    # it is the routing narrative, and without it nothing else is interpretable.
    parents: dict[str, bytes] = {}
    children: list[tuple[str, str, bytes, bytes | None, float]] = []
    for sid in dict.fromkeys(session_ids):
        raw_parent, raw_children = await _read_group(sandbox, sid)
        filtered = _filter_transcript(raw_parent, cap=cap) if raw_parent else None
        if filtered is not None:
            parents[sid] = filtered
        for name, raw, meta, mtime in raw_children:
            children.append((sid, name, raw, meta, mtime))

    if active in parents and not admit(PARENT_LOG_ENTRY, parents[active]):
        dropped.append(f"{PARENT_LOG_ENTRY} (over the transcript size budget)")

    # Newest first: a tester's most recent work is the part their report is about.
    admitted_parents = {active} if any(r == PARENT_LOG_ENTRY for r, _ in entries) else set()
    for sid, name, raw, meta, _mtime in sorted(children, key=lambda c: (-c[4], c[0], c[1])):
        prefix = _group_prefix(sid, active=(sid == active))
        label = f"{prefix}subagents/{name}.jsonl"
        filtered = _filter_transcript(raw, cap=cap, allow_subdirs=True)
        if filtered is None:
            dropped.append(f"{label} (no conversation entries)")
            continue
        if sid not in admitted_parents:
            # A child is only anchorable beside its own parent, so the parent is
            # charged to the budget with it, and the pair fails or lands together.
            if sid not in parents:
                dropped.append(f"{label} (its session's parent transcript is missing)")
                continue
            if not admit(f"{prefix}session-log.jsonl", parents[sid]):
                dropped.append(f"{label} (over the transcript size budget)")
                continue
            admitted_parents.add(sid)
        if not admit(label, filtered):
            dropped.append(f"{label} (over the transcript size budget)")
            continue
        if meta is not None:
            # Tiny (four keys), and `toolUseId` is the id of the parent `Agent`
            # call — the anchor the consumer splices at. Shipped unfiltered: it
            # is metadata, not a transcript.
            admit(f"{prefix}subagents/{name}.meta.json", meta)

    return entries, dropped


class FeedbackBody(BaseModel):
    sessionId: str
    email: str = ""
    userPrompt: str = ""
    agentDid: str = ""
    # The "Did it work as expected?" answer. Defaults False so a malformed request
    # (a client omitting it) surfaces as a bug for triage rather than a silent
    # positive; the viewer always sends a real value. Bypasses _norm — it is a bool,
    # not text, and _norm's .strip()/len() would raise.
    workedAsExpected: bool = False
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
    log_entries, _dropped = await _session_log(sandbox)
    # Every byte that will be written under `_feedback/` counts, meta files
    # included: this figure is rendered next to the "include session log" toggle
    # (`packages/viewer-ui/.../FeedbackDialog.tsx`), so it must cover what
    # actually leaves the machine, not a subset of it. `hasSessionLog` is
    # likewise "the SET is non-empty" — a disabled toggle submits its default
    # `true` anyway, so a parent-only flag would print "(none found)" while the
    # subagent transcripts shipped.
    return {
        "files": files,
        "sessionLogSize": sum(len(data) for _rel, data in log_entries),
        "hasSessionLog": bool(log_entries),
    }


def _norm(v: str) -> str:
    v = (v or "").strip()
    if len(v) > _MAX_FIELD_CHARS:
        raise HTTPException(status_code=400, detail=f"A feedback field exceeds {_MAX_FIELD_CHARS} chars")
    return v


# Email, "what you asked" and "what the agent did" are all optional at the dialog
# (issue #1919), so any of the three can arrive empty. Say so rather than printing
# a heading or a bullet with nothing after it — a triager cannot otherwise tell
# "the reporter left it blank" from "the bundler lost it".
# Mirrored verbatim in apps/electron/src/main/feedback.ts.
NOT_PROVIDED = "_(not provided)_"


def _or_blank(value: str) -> str:
    return value if value.strip() else NOT_PROVIDED


def _feedback_markdown(
    f: dict,
    submitted_at: str,
    project_label: str,
    session_log: bool,
    viewer_version: str,
    worked_as_expected: bool,
    dropped: list[str] | None = None,
    redacted_living: int = 0,
    has_subagents: bool = False,
) -> str:
    parts = [
        "# Feedback",
        "",
        f"- **From:** {_or_blank(f['email'])}",
        f"- **When:** {submitted_at}",
        f"- **Viewer version:** {viewer_version}",
        f"- **Project:** {project_label}",
        f"- **Worked as expected:** {'Yes' if worked_as_expected else 'No'}",
        "",
        "## What I asked",
        "",
        _or_blank(f["userPrompt"]),
        "",
        "## What the agent did",
        "",
        _or_blank(f["agentDid"]),
    ]
    # Omitted on a positive report and when a bug reporter didn't know the ideal
    # behavior (both send it empty) — the "Worked as expected" line carries the signal.
    if f["agentShouldHave"]:
        parts += ["", "## What it should have done", "", f["agentShouldHave"]]
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
        # Only when the bundle actually carries one: describing a directory that
        # is not there sends a triager hunting for a missing file, which is the
        # confusion the session-log status line exists to prevent (#1481).
        if has_subagents:
            parts += [
                "",
                "Work the agent delegated to a subagent has its own transcript "
                "under `_feedback/subagents/`, one `.jsonl` per subagent with a "
                "small `.meta.json` beside it naming the parent `Agent` call "
                "that spawned it. A session other than the most recent one "
                "ships the same pair under `_feedback/sessions/<session-id>/`.",
            ]
    if redacted_living:
        parts += [
            "",
            "## Living people redacted",
            "",
            f"{redacted_living} living-person record(s) across the project's tree "
            "files (`tree.gedcomx.json` and, when present, `starting-tree.gedcomx.json`) "
            "were living or not "
            "marked deceased, so their given names, dates and places were replaced "
            f"with `{LIVING_GIVEN} <Surname>` before this bundle was created. Their "
            "ids and relationships are intact, so the case still reproduces. This is "
            "expected — not corrupt data.",
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
    session_log, dropped_transcripts = (
        await _session_log(sandbox) if body.includeSessionLog else ([], [])
    )

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
        "worked_as_expected": body.workedAsExpected,
        "agent_should_have": fields["agentShouldHave"],
        "correct_answer": fields["correctAnswer"],
        "notes": fields["notes"],
        # Transcripts the producer could not include, in a field a PROGRAM can
        # read. FEEDBACK.md names them too, but that is prose no consumer opens,
        # and a dropped transcript that reads downstream as "we looked and found
        # nothing" is the invisible zero this whole change exists to remove: the
        # guardrail report must hold its owner arms at "unknown" when this is
        # non-empty. An ADDED optional field bumps no schema_version (see
        # apps/electron/docs/feedback-json-spec.md §5 — removals, renames and
        # re-meanings only).
        "dropped_transcripts": dropped_transcripts,
    }

    redacted_files, redacted_living = _redact_living(await _walk_project(sandbox))
    project_files, dropped = _select_files(redacted_files, body.includeMedia)
    # One "not included" list, not two. The Electron producer pushes dropped
    # transcripts into its own `skipped` list, and FEEDBACK.md is the file a
    # triager reads across both — a web case and a desktop case must not report
    # the same fact in structurally different places.
    dropped = dropped + dropped_transcripts

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, data in project_files:
            zf.writestr(rel, data)
        zf.writestr(
            "FEEDBACK.md",
            _feedback_markdown(
                fields,
                submitted_at,
                project.title,
                bool(session_log),
                viewer_version,
                body.workedAsExpected,
                dropped,
                redacted_living,
                any(rel.startswith("_feedback/") and "/subagents/" in rel
                    for rel, _data in session_log),
            ),
        )
        zf.writestr("_feedback/feedback.json", json.dumps(feedback_json, indent=2) + "\n")
        for rel, data in session_log:
            zf.writestr(rel, data)

    filename = f"feedback-{submitted_at.replace(':', '-').replace('.', '-')}.zip"
    envelope = {
        "timestamp": submitted_at,
        "email": fields["email"],
        "filename": filename,
        "zipBase64": base64.b64encode(buf.getvalue()).decode("ascii"),
    }

    url = settings.feedback_url
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            res = await client.post(url, json=envelope)
            res.raise_for_status()
            resp_body = res.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Feedback upload failed: {exc}") from exc

    if resp_body.get("ok") is not True:
        raise HTTPException(
            status_code=502,
            detail=f"Feedback endpoint rejected the upload: {resp_body.get('error', 'unknown error')}",
        )

    return {"ok": True, "filename": filename}
