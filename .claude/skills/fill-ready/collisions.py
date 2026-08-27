"""Gate 3 soft-collision detector for /fill-ready.

Finds items that edit the same files, so the reciprocal notes Gate 3 asks for can
actually be written. Reads `**Touches:**` lines, so it is only as good as they
are: an issue with no such line does not appear at all.

The load-bearing half is issue-against-issue. `/review-ready` fans out one agent
per issue and those agents do check open PRs, so the issue-against-PR half is
largely redundant with that gate — but each agent sees exactly one issue, so a
pair of issues touching one file is invisible to every one of them.

Usage:
    python3 collisions.py board.json open.json prs.json "Ready,In Progress,Review"

Three guards keep the output from becoming a constant. Each is here because the
version without it fired on nearly every candidate; see the table in SKILL.md.
Do not relax one without re-measuring the pair count on a real board.
"""

import json
import re
import subprocess
import sys

ROOTS = ("packages/", "eval/", "docs/", "apps/", "scripts/", ".github/", ".claude/")
_TOKEN = re.compile(r"(?:" + "|".join(re.escape(r) for r in ROOTS) + r")[A-Za-z0-9_./*-]+")

# Guard 2. A bare directory pairs only when it names a UNIT -- a directory that is
# itself the thing being worked on, so naming it really does mean "all of this".
# Everything else is a CONTAINER, where naming it means "a file in here" and
# pairing it against its own siblings is a false positive.
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

# Guard 3. A concrete file named by more than this many candidates is a hub, not a
# collision. Pairing on it emits N-squared rows nobody reads.
_HUB_MAX = 3

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


def in_snapshot(path):
    return any(r.search(path) for r in SNAPSHOT)


_count_cache = {}


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


def is_unit_dir(path):
    return any(r.match(path) for r in _UNIT_DIRS)


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


def overlap(entries, paths):
    """Files in `paths` that collide with `entries`.

    Guard 1 lives here: a ('file', p) entry matches only the identical path. It
    never implies its directory, because two files in one directory are not a
    collision.
    """
    hit = set()
    for kind, p in entries:
        if not pairable(kind, p):
            continue
        if kind == "file":
            if p in paths:
                hit.add(p)
        else:
            hit |= {f for f in paths if under(f, p)}
    return hit


def entry_overlap(a, b):
    hit = overlap(a, {p for k, p in b if k == "file"})
    hit |= overlap(b, {p for k, p in a if k == "file"})
    for ka, pa in a:
        for kb, pb in b:
            if ka == kb == "prefix" and pairable(ka, pa) and pairable(kb, pb):
                if under(pa, pb) or under(pb, pa):
                    hit.add(pa if len(pa) > len(pb) else pb)
    return hit


def main(board_path, open_path, prs_path, statuses):
    board = json.load(open(board_path, encoding="utf-8"))["items"]
    issues = {i["number"]: i for i in json.load(open(open_path, encoding="utf-8"))}
    prs = json.load(open(prs_path, encoding="utf-8"))
    status = {(it.get("content") or {}).get("number"): it.get("status") for it in board}

    cand, broad = {}, {}
    for n, issue in issues.items():
        if status.get(n) not in statuses:
            continue
        entries = paths_from_touches(issue.get("body") or "")
        if not entries:
            continue
        cand[n] = entries
        wide = [p for k, p in entries if k == "prefix" and not pairable(k, p)]
        if wide:
            broad[n] = wide

    touch = {}
    for entries in cand.values():
        for kind, p in entries:
            if kind == "file":
                touch[p] = touch.get(p, 0) + 1
    hubs = {p for p, c in touch.items() if c > _HUB_MAX}

    pr_paths = {p["number"]: {f["path"] for f in p["files"]} for p in prs}

    def show(pairs):
        shown = 0
        for (a, b), shared in sorted(pairs.items()):
            shared = shared - hubs
            if not shared:
                continue
            shown += 1
            gate = "GATE 4 (hard)" if any(in_snapshot(s) for s in shared) else "GATE 3"
            print(f"  {a} + {b}  [{gate}]")
            # Snapshot paths first: they are what justifies a GATE 4 label, so
            # truncation must never hide them.
            ordered = sorted(shared, key=lambda s: (not in_snapshot(s), s))
            for s in ordered[:4]:
                print(f"       {s}{'   [snapshot]' if in_snapshot(s) else ''}")
            if len(ordered) > 4:
                print(f"       ... and {len(ordered) - 4} more")
        if not shown:
            print("  (none)")
        return shown

    print("=== issue + issue (invisible to per-issue review agents) ===")
    pairs = {}
    numbers = sorted(cand)
    for idx, a in enumerate(numbers):
        for b in numbers[idx + 1:]:
            shared = entry_overlap(cand[a], cand[b])
            if shared:
                pairs[(f"issue #{a}", f"issue #{b}")] = shared
    n_ii = show(pairs)

    print("\n=== issue + open PR (mostly covered by /review-ready) ===")
    pairs = {}
    for n, entries in cand.items():
        for pn, paths in pr_paths.items():
            shared = overlap(entries, paths)
            if shared:
                pairs[(f"issue #{n}", f"PR #{pn}")] = shared
    n_ip = show(pairs)

    if hubs:
        print("\n=== hub files -- many items touch these; not a pairing signal ===")
        for h in sorted(hubs):
            who = sorted(n for n, e in cand.items() if ("file", h) in e)
            print(f"  {h}: {len(who)} items -- {', '.join('#' + str(x) for x in who)}")

    if broad:
        print("\n=== directories too broad to pair -- read these by hand ===")
        for n, wide in sorted(broad.items()):
            desc = ", ".join(f"{p} ({tracked_count(p)} files)" for p in wide)
            print(f"  issue #{n}: {desc}")

    print(
        f"\nsummary: {n_ii} issue-issue, {n_ip} issue-PR, "
        f"{len(hubs)} hubs, {len(broad)} broad"
    )


if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2], sys.argv[3], set(sys.argv[4].split(",")))
