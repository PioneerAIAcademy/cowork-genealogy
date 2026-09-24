"""Shared `**Touches:**` parsing for the board skills.

`/fill-ready`'s collisions.py pairs items that edit the same files; `/merge-issues`'s
slots.py measures how deep each eval slot's queue is. Both decide those things from
the same line in an issue body, and they must decide them the same way — if they
disagree about which paths an issue names, or about which paths are inside a skill's
eval snapshot, fill-ready's Gate 4 map and the merge pass's queue depths describe
different boards.

Everything here is a claim about ONE issue body. Anything that compares two items
lives in the caller.
"""

import os
import re
import subprocess

# The checkout slot_of reads to tell a live skill from a deleted one. A module global,
# read at call time, so a test can point it at a tmp tree.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))

ROOTS = ("packages/", "eval/", "docs/", "apps/", "scripts/", ".github/", ".claude/")
_TOKEN = re.compile(r"(?:" + "|".join(re.escape(r) for r in ROOTS) + r")[A-Za-z0-9_./*-]+")

# A bare directory names a UNIT -- a directory that is itself the thing being worked
# on, so naming it really does mean "all of this". Everything else is a CONTAINER,
# where naming it means "a file in here".
#
# This replaced a tracked-file-count threshold (<= 10 files) on 2026-08-27. Size is
# a proxy for the distinction and gets it wrong in both directions: measured over
# the 27 bare-directory Touches entries then on the board, `apps/server/app/sandbox`
# (5 files) and `eval/app/tests/unit` (6) passed the threshold and are containers,
# while `eval/runlogs/unit/<skill>` (11) failed it and is a unit. The false pair it
# produced: issue #1959 says `apps/server/app/sandbox/ (LocalProvider WS path)` --
# i.e. local.py -- and was paired against #1729 and #1489, which name e2b.py.
_UNIT_DIRS = (
    re.compile(r"^packages/engine/plugin/skills/[a-z0-9-]+$"),
    re.compile(r"^eval/tests/unit/[a-z0-9-]+$"),
    re.compile(r"^eval/tests/e2e/[a-z0-9-]+$"),
    re.compile(r"^eval/fixtures/scenarios/[a-z0-9-]+$"),
    re.compile(r"^eval/runlogs/unit/[a-z0-9-]+$"),
    re.compile(r"^eval/runlogs/e2e/[a-z0-9-]+$"),
)

# Paths inside a skill's eval run-log snapshot. A collision here is Gate 4 (hard,
# costs a second paid run); anything else is Gate 3 (sequence + reciprocal notes).
# Mirrors `build_snapshot` in eval/harness/harness/snapshot.py, which deliberately
# excludes packages/engine/mcp-server/src/** -- an eval run never executes it.
SNAPSHOT = (
    re.compile(r"^packages/engine/plugin/skills/[a-z0-9-]+/"),
    re.compile(r"^eval/tests/unit/[a-z0-9-]+/"),
    re.compile(r"^packages/engine/plugin/agents/[a-z0-9-]+\.md$"),
    re.compile(r"^eval/fixtures/(scenarios|mcp)/"),
)

# The name of the eval slot a snapshot path belongs to. The slot is what a paid run
# buys, so it -- not the file, and not the skill named in the title -- is the unit
# the merge pass queues against. An agent is its own slot because one agent body
# gates every skill that delegates to it via `@plugin:`.
#
# A skill converted to an agent keeps its suite: `eval/tests/unit/<x>/` stays, the
# skill directory goes, and `build_snapshot` embeds `agents/<x>.md` in that suite by
# name. So once `skills/<x>/` is gone from disk and `agents/<x>.md` exists, all three
# shapes name `agent:<x>` -- one paid run, one queue. Without the agent file the name
# stays `skill:<x>`: a card creating a new skill names a directory not yet on disk.
#
# These three path shapes and no others, because /fill-ready's Gate 4 defines a slot
# holder from exactly this set (its map still keys a converted suite by bare name). `eval/runlogs/unit/<skill>/` is deliberately absent:
# a run log is not in the snapshot it certifies (build_snapshot in
# eval/harness/harness/snapshot.py embeds neither), so an issue that touches only a
# run log takes no slot. Widening this set would make the merge pass and Gate 4
# disagree about who holds what, which is the failure this module exists to prevent.
# `eval/fixtures/{scenarios,mcp}/` is in SNAPSHOT but not here on purpose: a fixture
# belongs to every skill whose tests reference it, so it names no single slot.
_SLOT = (
    (re.compile(r"^packages/engine/plugin/skills/([a-z0-9-]+)(?:/|$)"), "skill:{}"),
    (re.compile(r"^eval/tests/unit/([a-z0-9-]+)(?:/|$)"), "skill:{}"),
    (re.compile(r"^packages/engine/plugin/agents/([a-z0-9-]+)\.md$"), "agent:{}"),
)

_count_cache = {}


def in_snapshot(path):
    return any(r.search(path) for r in SNAPSHOT)


def is_unit_dir(path):
    return any(r.match(path) for r in _UNIT_DIRS)


def slot_of(path):
    """-> 'skill:<name>' | 'agent:<name>' | None for a path, file or directory."""
    p = path.rstrip("/")
    for rx, fmt in _SLOT:
        m = rx.match(p)
        if m:
            name = m.group(1)
            if fmt == "skill:{}" and _converted_to_agent(name):
                return f"agent:{name}"
            return fmt.format(name)
    return None


def _converted_to_agent(name):
    plugin = os.path.join(REPO_ROOT, "packages", "engine", "plugin")
    return (not os.path.isdir(os.path.join(plugin, "skills", name))
            and os.path.isfile(os.path.join(plugin, "agents", f"{name}.md")))


def pairable(kind, path):
    """A file always pairs. A directory pairs only if everything inside it is in
    scope: a snapshot path (any file under it dirties a run log -- Gate 4), or a
    unit dir (the directory *is* the thing being worked on)."""
    if kind == "file":
        return True
    return in_snapshot(path + "/") or is_unit_dir(path)


def parse(entry):
    """-> ('file', path) | ('prefix', dir).

    A glob, or a last segment with no dot, means the entry names a directory.
    """
    p = entry.rstrip("/")
    if "*" in p:
        return ("prefix", p.split("*")[0].rstrip("/"))
    last = p.rsplit("/", 1)[-1]
    return ("file", p) if "." in last else ("prefix", p)


# A body can carry the string `**Touches:**` more than once, and neither the first
# nor the last occurrence is reliably the live one. Measured over the 231 open issues
# on 2026-09-16: 214 occurrences across 21 multi-mention bodies, of which 193 are the
# real thing and 21 are mentions inside prose.
#
# What separates them is POSITION ON THE LINE, not position in the body:
#
#   - A real Touches line is LINE-INITIAL -- the body states its paths (193 cases).
#   - A mention is INLINE, almost always in backticks, where a review banner talks
#     ABOUT the line: "its `**Touches:**` line names X, which is stale" (21 cases;
#     issue #2589 does it nine times). Taking the first match parses the banner.
#
# Position in the body cannot decide it, because both orders occur. A rescoped card
# keeps its superseded body under `## Original issue` past a `---` fold, carrying a
# stale line BELOW the live one -- issue #1851's live line is harness+docs, while the
# retired one names four skill/agent paths that moved to issue #2127 on 2026-09-01.
# So taking the LAST match is wrong in the opposite direction.
#
# Hence: take the first line-initial occurrence above any retiring fold.
_RETIRING_FOLD = re.compile(r"^#{2,}\s+Original\s+(issue|body)\b", re.M | re.I)
_TOUCHES = re.compile(r"\*\*Touches:\*\*(.*?)(?:\n\n|\Z)", re.S)


def _live_touches_segment(body):
    """The `**Touches:**` payload a card actually claims today, or None.

    Skips inline mentions (a banner discussing the line rather than stating it)
    and anything below a `## Original issue` / `## Original body` fold. Falls back
    to the first match when every candidate is excluded, so an unusually formatted
    body still reaches a queue rather than silently reaching none.
    """
    text = body or ""
    fold = _RETIRING_FOLD.search(text)
    cutoff = fold.start() if fold else len(text)

    first = None
    for m in _TOUCHES.finditer(text):
        if first is None:
            first = m.group(1)
        if m.start() >= cutoff:
            continue
        line_start = text.rfind("\n", 0, m.start()) + 1
        prefix = text[line_start:m.start()].lstrip()
        # line-initial, optionally behind a blockquote marker or list bullet
        if prefix.lstrip("> ").lstrip("-*+ ") != "":
            continue
        return m.group(1)
    return first


def paths_from_touches(body):
    seg = _live_touches_segment(body)
    if seg is None:
        return set()
    seg = seg.replace("`", " ").replace("·", " ")
    out = set()
    for tok in _TOKEN.findall(seg):
        tok = tok.rstrip(".,;:)").rstrip("/")
        if tok:
            out.add(parse(tok))
    return out


def under(path, prefix):
    return path == prefix or path.startswith(prefix + "/")


def tracked_count(prefix):
    """Number of git-tracked files under `prefix`."""
    if prefix not in _count_cache:
        out = subprocess.run(
            ["git", "ls-files", prefix],
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout
        _count_cache[prefix] = len([ln for ln in out.split("\n") if ln.strip()])
    return _count_cache[prefix]
