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

import re
import subprocess

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
# These three path shapes and no others, because /fill-ready's Gate 4 defines a slot
# holder from exactly this set. `eval/runlogs/unit/<skill>/` is deliberately absent:
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
            return fmt.format(m.group(1))
    return None


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


def paths_from_touches(body):
    m = re.search(r"\*\*Touches:\*\*(.*?)(?:\n\n|\Z)", body or "", re.S)
    if not m:
        return set()
    seg = m.group(1).replace("`", " ").replace("·", " ")
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
