"""Prototype feedback intake (U20): ``POST /api/feedback`` and ``GET /api/feedback/context``.

The alpha (``apps/server/app/feedback.py``) walked the sandbox's ``/project`` and the
SDK's ``~/.claude/projects/-project/`` and POSTed the zip to an Apps Script. The
prototype has neither folder: the project is ``documents`` + ``blobs`` rows (blob bytes in
S3) and the transcript is ``session_entries`` rows. So this module is two halves:

- **Vendored, pure** -- the alpha's redaction, selection, filtering and FEEDBACK.md code,
  copied verbatim, because the web bundle ships ``web/*.py`` only and cannot import
  ``app.*``. ``tests/test_proto_feedback.py``'s parity test runs both copies over one
  corpus; edit ``apps/server/app/feedback.py`` and this copy together.
- **Proto-only** -- reading the project from the store and S3, streaming the transcript
  in keyset batches, the bearer/literal token redaction (the alpha never had a token in a
  transcript; the worker's ``mcp.json`` carries the owner's FamilySearch token), the S3
  key and the ``forward_stored_feedback`` seam.

The zip's layout and ``feedback.json`` keys are the alpha's, so ``make feedback-case``
reads a prototype bundle unchanged (docs/specs/feedback-case-spec.md).
"""
from __future__ import annotations

import asyncio
import io
import json
import re
import secrets
import zipfile
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

# The worker's cwd (proto/worker/Dockerfile, WORKER_CWD): every parent transcript entry
# is stamped with it, as the alpha's sandbox stamped /project.
PROJECT_DIR = "/project"

# ══ vendored from apps/server/app/feedback.py (parity: tests/test_proto_feedback.py) ══

FEEDBACK_SCHEMA_VERSION = 1
_MAX_FIELD_CHARS = 10_000

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
    writing them; it did not delete the ones already on disk. They would be
    redacted by shape anyway, so this skip keeps noise out, not living people.
    `.tmp-` — before the ProjectStore seam, atomicWriteJson wrote
    `<path>.tmp-<uuid>`, *not* dot-prefixed, so a crash between write and
    rename leaves one behind that the dot-skip does not catch. (The current
    tmpSibling in fs-project-store.ts is dot-prefixed and already skipped.)

    Dropped rather than merely redacted, because nothing reads them and a
    bundle full of duplicate trees is noise a triager has to wade through.
    Mirror of apps/electron/src/main/feedback.ts::isStaleCopy.
    """
    # Lowercased because the genealogist team is on Windows, where a shell or
    # an editor readily produces `.BAK`; the neighbouring _ext() does the same.
    # The temp form is anchored to a trailing hex/uuid run so an ordinary file
    # that merely contains the substring — `notes.tmp-draft.md` — survives.
    lower = name.lower()
    return bool(lower.endswith(".bak") or _STALE_TMP_RE.search(lower))


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
# the Electron copy; tests/test_feedback.py::test_parity_* checks the two
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
            # utf-8-sig, not utf-8: a Windows editor readily saves a BOM in
            # front, and without this the parse raises, the except below ships
            # the file UNREDACTED, and a living person leaks. _may_be_tree
            # already skips these bytes, so the file reaches here and fails.
            tree = json.loads(data.decode("utf-8-sig"))
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


# ══ proto-only ═══════════════════════════════════════════════════════════════════════

# -- token redaction -------------------------------------------------------------------
# The worker writes the owner's FamilySearch access token into <TMPDIR>/worker-cfg-*/
# mcp.json as `Authorization: Bearer ...`. A turn that read it would leave the token in a
# session_entries tool_result, and _redact_api_keys passes it (it knows sk- keys only).
# Two passes, both after _redact_api_keys: any bearer credential -- the main defence,
# since an older turn's row carries the token THAT turn held, possibly rotated since --
# and the owner's current access and refresh tokens literally, for token text with no
# `Bearer` in front. deny.py now refuses the read; this is the second wall. A third
# pattern takes an `access_token` query parameter or JSON key, the other place a bearer
# credential travels in a URL or payload a tool may relay. Project text files get the
# same passes as transcripts (redact_project_files).

_REDACTED_TOKEN = "[REDACTED_TOKEN]"
_BEARER_RE = re.compile(r"(?i:bearer)\s+[A-Za-z0-9._~+/=-]{16,}")
_BEARER_RE_B = re.compile(rb"(?i:bearer)\s+[A-Za-z0-9._~+/=-]{16,}")
_ACCESS_TOKEN_RE = re.compile(r"((?i:access_token)[\\\"']*\s*[=:]\s*[\\\"']*)[A-Za-z0-9._~+/-]{16,}")
_ACCESS_TOKEN_RE_B = re.compile(rb"((?i:access_token)[\\\"']*\s*[=:]\s*[\\\"']*)[A-Za-z0-9._~+/-]{16,}")
# A literal shorter than this is not a token, and replacing it would shred the text.
_MIN_LITERAL_TOKEN = 16


def redact_tokens(data: bytes, literals: Sequence[str] = ()) -> bytes:
    out = _BEARER_RE_B.sub(("Bearer " + _REDACTED_TOKEN).encode("ascii"), data)
    out = _ACCESS_TOKEN_RE_B.sub(rb"\1" + _REDACTED_TOKEN.encode("ascii"), out)
    for token in literals:
        if token and len(token) >= _MIN_LITERAL_TOKEN:
            out = out.replace(token.encode("utf-8"), _REDACTED_TOKEN.encode("ascii"))
    return out


def redact_tokens_str(text: str, literals: Sequence[str] = ()) -> str:
    out = _BEARER_RE.sub("Bearer " + _REDACTED_TOKEN, text)
    out = _ACCESS_TOKEN_RE.sub(r"\1" + _REDACTED_TOKEN, out)
    for token in literals:
        if token and len(token) >= _MIN_LITERAL_TOKEN:
            out = out.replace(token, _REDACTED_TOKEN)
    return out


def redact_bytes(data: bytes, literals: Sequence[str] = ()) -> bytes:
    """Everything that leaves in a transcript: the alpha's API keys, then tokens."""
    return redact_tokens(_redact_api_keys(data), literals)


def redact_project_files(
    files: list[tuple[str, bytes]], literals: Sequence[str] = ()
) -> list[tuple[str, bytes]]:
    """Project text files with the transcript passes applied; media unchanged."""
    return [(rel, redact_bytes(data, literals) if _ext(rel) in _TEXT_EXTS else data) for rel, data in files]


def redact_field(text: str, literals: Sequence[str] = ()) -> str:
    """A form field: the alpha's API keys, then tokens."""
    return redact_tokens_str(_redact_api_keys_str(text), literals)


# -- project files ----------------------------------------------------------------------


@dataclass(frozen=True)
class ProjectFile:
    """One file a bundle may carry. A document carries its serialised bytes (``data``); a
    blob carries its S3 key and its ``blobs.bytes``, and is fetched only once selected."""

    rel: str
    size: int
    s3_key: str | None = None
    data: bytes | None = None


def serialise_document(doc: Any) -> bytes:
    """A ``documents`` row as the engine's ``readText`` renders it: ``JSON.stringify(doc,
    null, 2)`` (jsonb keeps no key order, so no byte-for-byte promise beyond that)."""
    return json.dumps(doc, indent=2, ensure_ascii=False).encode("utf-8")


def _excluded(rel: str) -> tuple[str, str | None]:
    """``("dot", None)`` for a ref with a dot segment (the alpha skipped dot-dirs, which
    is where ``results/.staging/`` lives); ``("stale", <path to the stale segment>)``;
    else ``("", None)``."""
    parts = rel.split("/")
    for i, part in enumerate(parts):
        if not part or part.startswith("."):
            return "dot", None
        if _is_stale_copy(part):
            return "stale", "/".join(parts[: i + 1])
    return "", None


def project_files(
    docs: Mapping[str, tuple[int, Any]], blob_index: Iterable[tuple[str, str, int]]
) -> tuple[list[ProjectFile], list[str]]:
    """``(files, stale)``: every document and blob a bundle may carry, sorted by path, and
    the stale copies skipped. A blob over the alpha's per-file cap is skipped unnamed, as
    the alpha's walker skipped one; a document is never over it in practice."""
    files: dict[str, ProjectFile] = {}
    stale: list[str] = []

    def consider(rel: str) -> bool:
        kind, path = _excluded(rel)
        if kind == "stale" and path not in stale:
            stale.append(path)
        return kind == ""

    for name, (_version, doc) in docs.items():
        if consider(name):
            data = serialise_document(doc)
            if len(data) <= _INDIVIDUAL_FILE_CAP_BYTES:
                files[name] = ProjectFile(name, len(data), data=data)
    for key, s3_key, size in blob_index:
        if key in files or not consider(key) or int(size) > _INDIVIDUAL_FILE_CAP_BYTES:
            continue
        files[key] = ProjectFile(key, int(size), s3_key=s3_key)
    return [files[rel] for rel in sorted(files)], sorted(stale)


class _Size:
    """A stand-in for a file's bytes in ``_select_files``, which reads only ``len()``. So
    the alpha's own selection runs on ``blobs.bytes`` BEFORE any ``GetObject``."""

    __slots__ = ("n",)

    def __init__(self, n: int) -> None:
        self.n = n

    def __len__(self) -> int:
        return self.n


def select_project_files(files: list[ProjectFile], include_media: bool) -> tuple[list[ProjectFile], list[str]]:
    """``_select_files`` over sizes: the media toggle and the 35 MiB cap, largest dropped
    first. Redaction only shrinks a document, so selecting on pre-redaction sizes is
    conservative."""
    by_rel = {f.rel: f for f in files}
    kept, dropped = _select_files([(f.rel, _Size(f.size)) for f in files], include_media)
    return [by_rel[rel] for rel, _ in kept], dropped


def fetch_project_files(
    kept: list[ProjectFile], get: Callable[[str], bytes]
) -> tuple[list[tuple[str, bytes]], list[str]]:
    """``(files, unreadable)``. Synchronous (botocore): run it in a thread. A blob that
    cannot be read is named, never a failed submission."""
    out: list[tuple[str, bytes]] = []
    unreadable: list[str] = []
    for f in kept:
        if f.data is not None:
            out.append((f.rel, f.data))
            continue
        try:
            out.append((f.rel, get(f.s3_key or "")))
        except Exception:  # noqa: BLE001 - one unreadable blob must not cost the report
            unreadable.append(f"{f.rel} (could not be read)")
    return out, unreadable


def context_files(files: list[ProjectFile]) -> list[dict[str, Any]]:
    """The alpha's ``/context`` file entries."""
    return [
        {"relativePath": f.rel, "sizeBytes": f.size, "isMedia": _ext(f.rel) in _MEDIA_EXTS,
         "isText": _ext(f.rel) in _TEXT_EXTS}
        for f in files
    ]


# -- the transcript ----------------------------------------------------------------------
# session_entries rows, keyed (project_key = project_id, session_id = the SDK session id,
# subpath). A parent is subpath ''; a subagent is 'subagents/<name>', and its
# `agent_metadata` rows are the .meta.json the SDK's own materialiser writes
# (claude_agent_sdk/_internal/session_resume.py). Streamed in keyset batches: memory is a
# batch plus what the budget admits, never the project's whole transcript.

ROWS_BATCH = 500
_SUBAGENT_RE = re.compile(r"^subagents/([^/]+)$")


@dataclass(frozen=True)
class TranscriptGroup:
    session_id: str
    subpath: str
    max_seq: int
    bytes: int  # SQL sum(octet_length(entry::text) + 1): an upper bound on the JSONL


TranscriptRows = Callable[[str, str, str, int, int], Awaitable[list[tuple[int, Any]]]]


def subagent_name(subpath: str) -> str | None:
    """``agent-x`` for ``subagents/agent-x``; None for a nested or unsafe subpath, which
    the alpha (one ``list_dir`` of ``subagents/``) never read either."""
    m = _SUBAGENT_RE.match(subpath)
    if m is None or m.group(1).startswith(".") or "\\" in m.group(1):
        return None
    return m.group(1)


def bundled_groups(groups: Iterable[TranscriptGroup]) -> list[TranscriptGroup]:
    """The groups a POST reads: every parent and every direct subagent."""
    return [g for g in groups if g.subpath == "" or subagent_name(g.subpath) is not None]


def session_log_size(groups: Iterable[TranscriptGroup]) -> int:
    """``/context``'s ``sessionLogSize``, from SQL sizes alone: an upper bound on the
    transcript bytes a POST zips (filtering and redaction only remove)."""
    return sum(g.bytes for g in bundled_groups(groups))


async def iter_batches(
    rows: TranscriptRows, project_id: str, session_id: str, subpath: str, batch: int | None = None
) -> AsyncIterator[list[Any]]:
    """One group's entries, ``batch`` (``ROWS_BATCH``) at a time, keyset on ``seq``."""
    batch = batch or ROWS_BATCH
    after = 0
    while True:
        page = await rows(project_id, session_id, subpath, after, batch)
        if not page:
            return
        yield [entry for _seq, entry in page]
        if len(page) < batch:
            return
        after = int(page[-1][0])


def _jsonl(entries: Iterable[Any]) -> bytes:
    return b"".join(
        json.dumps(e, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        for e in entries if isinstance(e, dict)
    )


def _filter_batch(entries: list[Any], allow_subdirs: bool, literals: Sequence[str]) -> bytes:
    """One batch through the alpha's filter (uncapped: the budget is the caller's) and
    the redaction ``admit`` applies. Lines are whole, so batching changes no byte."""
    filtered = _filter_transcript(_jsonl(entries), cap=1 << 62, allow_subdirs=allow_subdirs)
    return redact_bytes(filtered, literals) if filtered else b""


OVER = "over"


async def stream_group(
    rows: TranscriptRows, project_id: str, group: TranscriptGroup, *, limit: int,
    literals: Sequence[str], allow_subdirs: bool,
) -> tuple[bytes | str | None, bytes | None]:
    """``(transcript, meta)``. ``transcript`` is the filtered, redacted JSONL, None when no
    entry qualifies, or ``OVER`` the moment it passes ``limit`` -- no further batch is
    fetched. ``meta`` is the last ``agent_metadata`` row, ``type`` dropped, as the SDK
    writes it."""
    chunks: list[bytes] = []
    size = 0
    meta: dict[str, Any] | None = None
    async for entries in iter_batches(rows, project_id, group.session_id, group.subpath):
        transcript = []
        for e in entries:
            if isinstance(e, dict) and e.get("type") == "agent_metadata":
                meta = e
            else:
                transcript.append(e)
        data = await asyncio.to_thread(_filter_batch, transcript, allow_subdirs, literals)
        size += len(data)
        if size > limit:
            return OVER, None
        if data:
            chunks.append(data)
    meta_bytes = None
    if meta is not None:
        meta_bytes = json.dumps({k: v for k, v in meta.items() if k != "type"}).encode("utf-8")
    return (b"".join(chunks) or None), meta_bytes


async def transcript_set(
    groups: list[TranscriptGroup], rows: TranscriptRows, project_id: str, active: str,
    literals: Sequence[str] = (), *, cap: int = _SESSION_LOG_CAP_BYTES,
) -> tuple[list[tuple[str, bytes]], list[str]]:
    """``(entries, dropped)``: the alpha's ``_session_log`` over ``session_entries``.

    ``active`` is the web session's SDK session id; when it has no parent transcript the
    newest parent (largest ``seq``) stands in, as the alpha fell back to the newest file.
    One shared budget, active parent first, then subagents newest first, each beside its
    own parent; every drop is named. Unlike the alpha, a transcript over what is left of
    the budget is not read to its end: it stops at the first batch past it and is named
    ``(over the transcript size budget)``."""
    parents = {g.session_id: g for g in groups if g.subpath == ""}
    if active not in parents:
        active = max(parents.values(), key=lambda g: g.max_seq).session_id if parents else ""

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

    # A parent is read once: when it cannot be admitted it stays so (the budget only
    # shrinks), and once admitted it is in `admitted`.
    unusable: dict[str, str] = {}
    admitted: set[str] = set()

    async def admit_parent(sid: str, relpath: str) -> str | None:
        """None when admitted; else ``missing`` or ``OVER``."""
        if sid in unusable:
            return unusable[sid]
        group = parents.get(sid)
        if group is None:
            unusable[sid] = "missing"
            return "missing"
        data, _meta = await stream_group(rows, project_id, group, limit=cap - spent, literals=literals,
                                         allow_subdirs=False)
        if data is None:
            unusable[sid] = "missing"
        elif data == OVER or not admit(relpath, data):
            unusable[sid] = OVER
        else:
            admitted.add(sid)
            return None
        return unusable[sid]

    if active in parents and await admit_parent(active, PARENT_LOG_ENTRY) == OVER:
        dropped.append(f"{PARENT_LOG_ENTRY} (over the transcript size budget)")

    children = [g for g in groups if g.subpath != ""]
    for group in sorted(children, key=lambda g: (-g.max_seq, g.session_id, g.subpath)):
        sid = group.session_id
        prefix = _group_prefix(sid, active=(sid == active))
        name = subagent_name(group.subpath)
        if name is None:
            dropped.append(f"{prefix}{group.subpath}.jsonl (nested subagent transcript; not bundled)")
            continue
        label = f"{prefix}subagents/{name}.jsonl"
        data, meta = await stream_group(rows, project_id, group, limit=cap - spent, literals=literals,
                                        allow_subdirs=True)
        if data is None:
            dropped.append(f"{label} (no conversation entries)")
            continue
        if sid not in admitted:
            verdict = await admit_parent(sid, f"{prefix}session-log.jsonl")
            if verdict == "missing":
                dropped.append(f"{label} (its session's parent transcript is missing)")
                continue
            if verdict == OVER:
                dropped.append(f"{label} (over the transcript size budget)")
                continue
        if data == OVER or not admit(label, data):
            dropped.append(f"{label} (over the transcript size budget)")
            continue
        if meta is not None:
            admit(f"{prefix}subagents/{name}.meta.json", redact_bytes(meta, literals))
    return entries, dropped


# -- the bundle --------------------------------------------------------------------------


def build_info(tier_root: Path) -> tuple[str, str]:
    """``(built_at, git_sha)`` from the tier root's ``BUILD-INFO.json`` (the Beanstalk
    bundle ships it; scripts/eb_bundles/layout.py), else ``("dev", "dev")``."""
    try:
        info = json.loads((tier_root / "BUILD-INFO.json").read_text(encoding="utf-8"))
        return str(info.get("built_at") or "dev"), str(info.get("git_sha") or "dev")
    except (OSError, ValueError, AttributeError):
        return "dev", "dev"


def feedback_fields(body: FeedbackBody, literals: Sequence[str] = ()) -> dict[str, str]:
    """The alpha's normalised fields (400 over ``_MAX_FIELD_CHARS``), API keys and tokens
    redacted."""
    return {
        "email": _norm(body.email).lower(),
        "userPrompt": redact_field(_norm(body.userPrompt), literals),
        "agentDid": redact_field(_norm(body.agentDid), literals),
        "agentShouldHave": redact_field(_norm(body.agentShouldHave), literals),
        "correctAnswer": redact_field(_norm(body.correctAnswer), literals),
        "notes": redact_field(_norm(body.notes or ""), literals),
    }


def build_bundle(
    *, fields: dict[str, str], body: FeedbackBody, submitted_at: str, project_label: str,
    built_at: str, git_sha: str, files: list[tuple[str, bytes]], dropped_files: list[str],
    session_log: list[tuple[str, bytes]], dropped_transcripts: list[str], now: date | None = None,
) -> tuple[bytes, int]:
    """``(zip bytes, living persons redacted)``: the alpha's ``submit_feedback`` from the
    redaction on. Synchronous (the deflate): run it in a thread."""
    viewer_version = f"web {built_at} ({git_sha})"
    feedback_json = {
        "schema_version": FEEDBACK_SCHEMA_VERSION,
        "submitted_at": submitted_at,
        "viewer_version": viewer_version,
        "build_date": built_at,
        "git_sha": git_sha,
        "platform": "web",
        "email": fields["email"],
        "project_folder_path": body.sessionId,
        "user_prompt": fields["userPrompt"],
        "agent_did": fields["agentDid"],
        "worked_as_expected": body.workedAsExpected,
        "agent_should_have": fields["agentShouldHave"],
        "correct_answer": fields["correctAnswer"],
        "notes": fields["notes"],
        "dropped_transcripts": dropped_transcripts,
    }
    project, redacted_living = _redact_living(files, now)
    dropped = dropped_files + dropped_transcripts
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, data in project:
            zf.writestr(rel, data)
        zf.writestr(
            "FEEDBACK.md",
            _feedback_markdown(
                fields,
                submitted_at,
                project_label,
                bool(session_log),
                viewer_version,
                body.workedAsExpected,
                dropped,
                redacted_living,
                any(rel.startswith("_feedback/") and "/subagents/" in rel for rel, _data in session_log),
                has_parent_log=any(rel == PARENT_LOG_ENTRY for rel, _data in session_log),
            ),
        )
        zf.writestr("_feedback/feedback.json", json.dumps(feedback_json, indent=2) + "\n")
        for rel, data in session_log:
            zf.writestr(rel, data)
    return buf.getvalue(), redacted_living


# NOT the orphan sweep's shape (ORPHAN_KEY_RE in packages/engine/mcp-server/src/store/
# s3-orphan-sweep.ts, `<projectId>/<ref>/<uuid>`): the last segment is never a bare UUID,
# so the U19 sweep counts these `foreign` and leaves them. tests/test_proto_feedback.py
# and tests/store/s3-orphan-sweep.test.ts each pin their side.
FEEDBACK_PREFIX = "feedback/"


def bundle_key(owner_id: str, project_id: str, submitted_at: str) -> str:
    """``feedback/<owner_id>/<project_id>/feedback-<ts>-<8 hex>.zip``. ``owner_id`` (the
    internal ``usr_...`` id, not PII) keeps a bundle traceable to its patron after
    ``delete_session`` drops the ``projects`` row."""
    stamp = submitted_at.replace(":", "-").replace(".", "-")
    return f"{FEEDBACK_PREFIX}{owner_id}/{project_id}/feedback-{stamp}-{secrets.token_hex(4)}.zip"


def forward_stored_feedback(key: str, meta: dict[str, Any]) -> None:
    """Where a stored bundle goes next. Deliberately nothing.

    No destination is decided. The alpha posted the zip to Drive through an Apps Script,
    which also opened the triage issue (docs/alpha-feedback-guide.md); sending patron data
    anywhere beyond our own bucket is the lead's call (handoff F7/F17). Until then a
    prototype bundle reaches S3 and no one is notified. The route calls this after the
    PUT, so the decision lands here and nowhere else."""
    return None
