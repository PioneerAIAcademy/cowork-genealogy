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
import re
import zipfile
from datetime import date, datetime, timezone

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

_API_KEY_PATTERNS = [
    re.compile(rb"sk-ant-[A-Za-z0-9_-]{20,}"),
    re.compile(rb"sk-or-[A-Za-z0-9_-]{20,}"),
    re.compile(rb"sk-[A-Za-z0-9_-]{40,}"),
]
_API_KEY_PATTERNS_STR = [
    re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    re.compile(r"sk-or-[A-Za-z0-9_-]{20,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{40,}"),
]
_REDACTED_KEY = b"[REDACTED_API_KEY]"
_REDACTED_KEY_STR = "[REDACTED_API_KEY]"


def _redact_api_keys(data: bytes) -> bytes:
    out = data
    for pattern in _API_KEY_PATTERNS:
        out = pattern.sub(_REDACTED_KEY, out)
    return out


def _redact_api_keys_str(text: str) -> str:
    for pattern in _API_KEY_PATTERNS_STR:
        text = pattern.sub(_REDACTED_KEY_STR, text)
    return text


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


def _is_stale_copy(name: str) -> bool:
    """A stale copy of a project document that nothing reads.

    `.bak` — pre-#2333 `.mcpb` builds wrote one beside the tree. #2333 stopped
    writing them; it did not delete the ones already on disk, and they ship
    UNREDACTED because _redact_living only rewrites the two canonical
    filenames. `.tmp-` — before the ProjectStore seam, atomicWriteJson wrote
    `<path>.tmp-<uuid>`, *not* dot-prefixed, so a crash between write and
    rename leaves one behind that the dot-skip does not catch. (The current
    tmpSibling in fs-project-store.ts is dot-prefixed and already skipped.)

    Skipped rather than redacted: nothing reads them, and redacting would mean
    a second tree parser. Mirror of
    apps/electron/src/main/feedback.ts::isStaleCopy.
    """
    # Lowercased because the genealogist team is on Windows, where a shell or
    # an editor readily produces `.BAK`; the neighbouring _ext() does the same.
    # The temp form is anchored to a trailing hex/uuid run so an ordinary file
    # that merely contains the substring — `notes.tmp-draft.md` — survives.
    lower = name.lower()
    return bool(lower.endswith(".bak") or _STALE_TMP_RE.search(lower))


async def _walk_project(
    sandbox, stale_skipped: list[str] | None = None
) -> list[tuple[str, bytes]]:
    """(relativePath, bytes) for every file under PROJECT_DIR, recursively.

    Matches the Electron walker: skips dotfiles and dot-directories, skips the
    stale copies _is_stale_copy names, and skips any single file over the
    per-file cap. Previously this returned only
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
            if _is_stale_copy(entry.name):
                if stale_skipped is not None:
                    stale_skipped.append(f"{prefix}{entry.name}")
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
# These two are named only in the FEEDBACK.md note now. Which files get redacted
# is decided by shape, not by name — see _redact_living. starting-tree.gedcomx.json
# is the write-once completion-gate baseline; it carries the same living persons
# as tree.gedcomx.json and is bundled by the same non-media walk, so it must be
# redacted too.
LIVING_GIVEN = "Living"
LIVING_SURNAME_FALLBACK = "Unknown"


PRESUMED_LIVING_YEARS = 110
# Neither app may import eval code, so the rule is written inline here and in
# the Electron copy; tests/test_feedback.py::test_2988_parity_* checks the two
# still agree. `Probate` counts as death evidence because it can only follow
# one; `Will` does not, because a will is written while alive.
_DEATH_FACT_TYPES = frozenset({"Death", "Burial", "Cremation", "Probate"})
_BIRTH_FACT_TYPES = frozenset({"Birth", "Christening", "Baptism"})
_EMBEDDED_YEAR_RE = re.compile(r"\b(1\d{3}|20\d{2})\b")
_STALE_TMP_RE = re.compile(r"\.tmp-[0-9a-f-]{8,}$")


def _fact_year(fact: dict) -> int | None:
    """The first 4-digit year in a fact's dates, or None.

    **Only a string date counts.** `str(x)` renders a dict's *contents* while
    JavaScript's `String(x)` renders `"[object Object]"`, so an unguarded
    coercion makes the two copies of this rule disagree on a malformed
    `{"date": {"original": "14 May 1823"}}` — this side would extract 1823 and
    ship someone the desktop redacts.
    """
    for value in (fact.get("standard_date"), fact.get("date")):
        if not isinstance(value, str):
            continue
        match = _EMBEDDED_YEAR_RE.search(value)
        if match:
            return int(match.group(1))
    return None


def _birth_year(facts: list[dict]) -> int | None:
    """The person's birth year, or None.

    An explicit `Birth` fact wins over a `Christening`/`Baptism`, which in a
    FamilySearch-derived tree can be a posthumous ordinance dated long after
    death — taking it would date a person born 1823 to 1960 and blank them.
    Within a class the earliest year wins, so the answer does not depend on
    list order. Callers pass dicts only.
    """
    birth: int | None = None
    proxy: int | None = None
    for fact in facts:
        fact_type = str(fact.get("type", ""))
        if fact_type not in _BIRTH_FACT_TYPES:
            continue
        year = _fact_year(fact)
        if year is None:
            continue
        if fact_type == "Birth":
            if birth is None or year < birth:
                birth = year
        elif proxy is None or year < proxy:
            proxy = year
    return birth if birth is not None else proxy


def _last_seen_year(facts: list[dict]) -> int | None:
    """The most recent year the person is evidenced alive, or None.

    Any dated fact that is neither a birth nor a death: a census, residence,
    marriage, military or occupation entry all place the person alive that
    year, which bounds their birth no later than it. Defined as "everything
    else" rather than an allow-list because the fact-type enum is open, so any
    list would be under-inclusive by construction — which is how a census-only
    ancestor stayed blanked.
    """
    latest: int | None = None
    for fact in facts:
        fact_type = str(fact.get("type", ""))
        if fact_type in _BIRTH_FACT_TYPES or fact_type in _DEATH_FACT_TYPES:
            continue
        year = _fact_year(fact)
        if year is not None and (latest is None or year > latest):
            latest = year
    return latest


def _is_living(person: dict, now_year: int) -> bool:
    """Whether a tree person must be treated as living.

    Mirrors apps/electron/src/main/feedback.ts::isLiving.

    When `living` is **present** this is the pre-#2988 rule verbatim — living
    unless exactly `False` — so no present value changes behaviour, including
    the non-boolean ones (`None`, `0`, `"true"`).

    When the key is **absent** the old rule blanked everyone: a tree built by
    `tree_edit` carries no flag at all, so one reported bundle shipped all 11
    of its 19th-century ancestors as `Living <Surname>` with no facts. An
    absent flag now means deceased on any of:
      - a death-type fact;
      - a birth more than PRESUMED_LIVING_YEARS years before `now_year`;
      - a last-seen-alive year more than that many years before `now_year`.
    Otherwise living, as before.

    Deliberately **one year more conservative** than the e2e fixture gate
    (eval/harness/e2e/author.py::living_gate), which presumes living only when
    `year > current_year - 110` and so treats someone born exactly 110 years
    ago as deceased — this still redacts them. The gate is also stricter about
    a missing flag, because fixtures are committed to a public repo; a bundle
    goes only to maintainers. The comparison is year arithmetic, so the
    effective threshold is between 110 and 111 years depending on birth month.

    The key-absent branch must not raise: an exception here reaches
    _redact_living's `except`, which ships the whole tree UNREDACTED.
    """
    if "living" in person:
        return person.get("living") is not False
    try:
        facts = person.get("facts")
        objects = [f for f in facts if isinstance(f, dict)] if isinstance(facts, list) else []
        if any(str(f.get("type", "")) in _DEATH_FACT_TYPES for f in objects):
            return False
        born = _birth_year(objects)
        if born is not None and now_year - born > PRESUMED_LIVING_YEARS:
            return False
        seen = _last_seen_year(objects)
        if seen is not None and now_year - seen > PRESUMED_LIVING_YEARS:
            return False
    except Exception:  # noqa: BLE001 — must never reach _redact_living's except
        return True
    return True


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


def _may_be_tree(data: bytes) -> bool:
    """Cheap pre-filter so a multi-MB scan is never handed to json.loads: a tree
    document is a JSON object, so its first non-whitespace byte is `{`."""
    for byte in data[:64]:
        if byte in (0x20, 0x09, 0x0A, 0x0D, 0xEF, 0xBB, 0xBF):
            continue
        return byte == 0x7B
    return False


def _redact_living(
    files: list[tuple[str, bytes]], now: date | None = None
) -> tuple[list[tuple[str, bytes]], int]:
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

    **Selected by shape, not by filename.** Keying on the two canonical names
    meant any other copy of a tree shipped with every living person intact — a
    `.bak`, a crash-residue `.tmp-<uuid>`, but equally a
    `tree-backup.gedcomx.json` a researcher made by hand. Anything that parses
    as a JSON object with a `persons` array is redacted, so closing the leak
    does not depend on enumerating the ways a copy can be named.
    `research.json` has no top-level `persons`, so it is unaffected.
    """
    out: list[tuple[str, bytes]] = []
    redacted = 0
    # Resolved once per bundle: per-person resolution lets the cutoff year
    # change mid-file across midnight, giving two people born the same year
    # opposite verdicts.
    now_year = (now or date.today()).year
    for rel, data in files:
        if not _may_be_tree(data):
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
                if isinstance(person, dict) and _is_living(person, now_year):
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
        # API-key redaction happens HERE, not at the return, because the set now
        # has four kinds of member (active parent, grouped parent, subagent
        # transcript, subagent meta) and a per-member call would have to be
        # repeated at each -- the shape that lets a new member ship a key.
        # Charged to the budget post-redaction, so the byte count is the bytes
        # that actually leave the sandbox. Mirrors `admit` in
        # apps/electron/src/main/feedback.ts.
        nonlocal spent
        data = _redact_api_keys(data)
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
    *,
    # Keyword-only and REQUIRED on purpose. A default here would have to be
    # `True`, which is the pre-fix behaviour — so a future caller that forgot it
    # would silently reintroduce the bug this argument exists to fix, and the
    # bug is invisible (a sentence naming a file that is not there). The
    # neighbouring flags can default safely; this one cannot.
    has_parent_log: bool,
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
        parts += ["", "## Session log", ""]
        if has_parent_log:
            parts += [
                "See `_feedback/session-log.jsonl` — the full Claude Code conversation "
                "transcript (user turns, tool calls, results, and the agent's reasoning).",
            ]
        else:
            # `session_log` is "the set is non-empty", which does NOT imply the
            # active session's parent is in it: that transcript can filter to
            # nothing while another session's group ships. Naming the file
            # anyway sends the triager hunting for a missing file, which is the
            # confusion this section exists to prevent (#1481).
            # WHICH of the two causes applies is knowable here, so say it
            # rather than offering both and pointing at a list. A parent lost to
            # the budget records a drop (`_session_log`); a parent that filtered
            # to nothing records none — so in the commoner branch the "Files not
            # included" section is not rendered at all (`if dropped:` below), and
            # sending the triager to it is the same missing-file hunt this
            # message exists to prevent.
            if any(d.startswith(PARENT_LOG_ENTRY) for d in (dropped or [])):
                parts += [
                    "There is no `_feedback/session-log.jsonl` in this bundle: the "
                    "most recent session's transcript did not fit the transcript "
                    "size budget, and is named in the \"Files not included\" list "
                    "below. The transcripts that did ship are grouped by session "
                    "under `_feedback/sessions/<session-id>/`, each with its own "
                    "`session-log.jsonl`.",
                ]
            else:
                parts += [
                    "There is no `_feedback/session-log.jsonl` in this bundle: the "
                    "most recent session had no conversation entries for this "
                    "project. The transcripts that did ship are grouped by session "
                    "under `_feedback/sessions/<session-id>/`, each with its own "
                    "`session-log.jsonl`.",
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
            "are living, or with no living flag and no evidence of death, "
            "so their given names, dates and places were replaced "
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
        "userPrompt": _redact_api_keys_str(_norm(body.userPrompt)),
        "agentDid": _redact_api_keys_str(_norm(body.agentDid)),
        "agentShouldHave": _redact_api_keys_str(_norm(body.agentShouldHave)),
        "correctAnswer": _redact_api_keys_str(_norm(body.correctAnswer)),
        "notes": _redact_api_keys_str(_norm(body.notes or "")),
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

    stale_skipped: list[str] = []
    redacted_files, redacted_living = _redact_living(
        await _walk_project(sandbox, stale_skipped)
    )
    project_files, dropped = _select_files(redacted_files, body.includeMedia)
    # Named alongside every other drop reason, so a triager reproducing against
    # the bundle can tell a stale copy was removed rather than never existed.
    dropped = dropped + [f"{rel} (stale copy)" for rel in stale_skipped]
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
                has_parent_log=any(rel == PARENT_LOG_ENTRY for rel, _data in session_log),
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
