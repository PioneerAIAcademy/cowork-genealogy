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

Guard 2 (a bare directory pairs only when it names a unit) and the `**Touches:**`
parsing itself live in ../lib/touches.py, shared with /merge-issues' slots.py so
the two passes cannot disagree about which paths an issue names.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from touches import (  # noqa: E402
    in_snapshot,
    paths_from_touches,
    pairable,
    tracked_count,
    under,
)

# Guard 3. A concrete file named by more than this many candidates is a hub, not a
# collision. Pairing on it emits N-squared rows nobody reads.
_HUB_MAX = 3


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
        # sorted() because `entries` is a set -- without it the row order of the
        # "too broad to pair" list changes between runs on identical input.
        wide = sorted(p for k, p in entries if k == "prefix" and not pairable(k, p))
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
            gate = "GATE 4" if any(in_snapshot(s) for s in shared) else "GATE 3"
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
