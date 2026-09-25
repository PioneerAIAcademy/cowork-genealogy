"""Eval-slot queue depth for /merge-issues.

How many open issues change each skill's eval snapshot. Every issue that lands
on a snapshot pays its own `make eval-skill` run, so a deep queue is where
duplicate and subset scope concentrates and where a merge can buy a run back.
Depth selects what to read first; it never forces a merge on its own.

Reads `**Touches:**` lines via ../lib/touches.py, shared with collisions.py, so
the two passes cannot disagree about which slot an issue holds. An issue with no
such line does not appear in a queue at all — it is listed under coverage instead,
and read by hand.

Usage:
    python3 slots.py board.json open.json prs.json
"""

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from touches import (  # noqa: E402
    in_snapshot,
    paths_from_touches,
    pairable,
    slot_of,
    under,
)

# A queue this deep or deeper is read first. The number is a reading order, not a
# measurement, and SKILL.md owns what it means.
READ_FIRST = 4

# The --limit every SKILL.md that calls this script passes to `gh project
# item-list`. A pull is truncated silently iff it returns exactly this many rows,
# so the guard below must test this number and not a smaller one: warning early
# means warning on every run through the whole range where the pull is fine, with
# the same message used when truncation is real -- and telling the operator to
# "re-pull with a higher --limit" when 2000 is already what they passed.
BOARD_LIMIT = 2000

# A file named by more than this many pool issues is a hub -- docs/architecture.md
# is the repo's map and everyone edits it, in different sections. Still printed,
# because suppressing it hides real pairs; marked, because pairing on it is noise.
HUB = 8

HOLDER_COLUMNS = ("Ready", "In Progress", "Review")


def age_days(iso, now):
    return (now - datetime.fromisoformat(iso.replace("Z", "+00:00"))).days


def labels_of(issue):
    return {lb["name"] for lb in issue.get("labels") or []}


def slots_of(entries):
    """Every eval slot an issue's Touches line puts it in."""
    out = set()
    for _, p in entries:
        s = slot_of(p)
        if s:
            out.add(s)
    return out


def main(board_path, open_path, prs_path):
    now = datetime.now(timezone.utc)
    board = json.load(open(board_path, encoding="utf-8"))["items"]
    issues = {i["number"]: i for i in json.load(open(open_path, encoding="utf-8"))}
    prs = json.load(open(prs_path, encoding="utf-8"))
    status = {(it.get("content") or {}).get("number"): it.get("status") for it in board}

    if len(board) >= BOARD_LIMIT:
        print(f"!! board.json holds {len(board)} items, the --limit the callers pass -- "
              "re-pull with a higher one; gh truncates silently and every count below "
              "is then wrong.\n")

    entries, pool, holders = {}, [], {}
    for n, issue in issues.items():
        col = status.get(n)
        labs = labels_of(issue)
        entries[n] = paths_from_touches(issue.get("body") or "")
        if col in HOLDER_COLUMNS:
            holders[n] = col
        # The merge pool: nobody is holding these. An unassigned Ready card is in
        # it *and* holds a slot -- it is the natural merge target, being furthest
        # along. An assigned one is someone's work and is never a merge candidate.
        if col == "Backlog" and "icebox" not in labs:
            pool.append(n)
        elif col == "Ready" and not issue.get("assignees"):
            pool.append(n)

    queues, held = {}, {}
    for n in pool:
        for s in slots_of(entries[n]):
            queues.setdefault(s, []).append(n)
    for n, col in holders.items():
        # "merge INTO this one" names a merge TARGET, so it may only be said of a
        # card the pool can actually merge into -- an unassigned Ready one. SKILL.md
        # is explicit that an In Progress or Review card is someone's work and is
        # never merged in either direction, so an unassigned card in one of those
        # columns is held, not a target. Below a queue of 2 this line used to print
        # nowhere, which is why the wrong tag went unnoticed.
        if col == "Ready" and not issues[n].get("assignees"):
            tag = "unassigned -- merge INTO this one"
        else:
            tag = "held"
        for s in slots_of(entries[n]):
            held.setdefault(s, []).append((n, col, tag))

    pr_slots = {}
    for p in prs:
        for f in p.get("files") or []:
            s = slot_of(f["path"])
            if s and in_snapshot(f["path"]):
                pr_slots.setdefault(s, set()).add(p["number"])

    def describe(n):
        i = issues[n]
        labs = ",".join(sorted(labels_of(i)))
        return (f"      #{n:<5} {age_days(i['createdAt'], now):>3}d  "
                f"[{labs}]  {i['title'][:62]}")

    def block(slot, members):
        print(f"  {slot}   queue {len(members)}")
        for n, col, tag in sorted(held.get(slot, [])):
            print(f"      holder: #{n} ({col}, {tag})")
        for p in sorted(pr_slots.get(slot, [])):
            print(f"      holder: PR #{p} (open, touches the snapshot)")
        for n in sorted(members, key=lambda x: -age_days(issues[x]["createdAt"], now)):
            print(describe(n))
        print()

    must = {s: m for s, m in queues.items() if len(m) >= READ_FIRST}
    rest = {s: m for s, m in queues.items() if 2 <= len(m) < READ_FIRST}

    print(f"=== eval slot queues (pool: {len(pool)} issues -- non-icebox Backlog + "
          "unassigned Ready) ===\n")
    print(f"--- READ FIRST: queue >= {READ_FIRST} "
          f"({len(must)} slots) ---\n")
    for s, m in sorted(must.items(), key=lambda x: (-len(x[1]), x[0])):
        block(s, m)
    if not must:
        print("  (none)\n")

    print(f"--- then: queue 2-{READ_FIRST - 1} ({len(rest)} slots) ---\n")
    for s, m in sorted(rest.items(), key=lambda x: (-len(x[1]), x[0])):
        block(s, m)
    if not rest:
        print("  (none)\n")

    # A slot can be held and carry no mergeable queue at all. `block()` runs only
    # from the two loops above, and `queues` has no key for a slot with nothing
    # queued -- so a slot held by an In Progress card or an open PR, with 0 or 1
    # behind it, rendered nowhere. That is a slot that looks free and is not, which
    # is the one thing this script exists to prevent an operator from believing.
    # Keyed on the holders themselves rather than on the queue, and rendered by the
    # same block(), so the holder and PR lines come with it.
    held_short = {s: queues.get(s, [])
                  for s in (set(held) | set(pr_slots)) - set(must) - set(rest)}
    print(f"--- held, queue below 2 ({len(held_short)} slots) ---\n")
    for s in sorted(held_short):
        block(s, held_short[s])
    if not held_short:
        print("  (none)\n")

    # Non-snapshot convergence. A merge here saves a reviewer and a rebase, never a
    # paid run, so it is the second tier -- but it is the only place a merge between
    # two engine or harness issues can be seen at all.
    touch = {}
    for n in pool:
        for kind, p in entries[n]:
            if not pairable(kind, p) or slot_of(p):
                continue
            key = p if kind == "file" else p + "/"
            touch.setdefault(key, set()).add(n)
    conv = {p: ns for p, ns in touch.items() if len(ns) >= 2}
    print(f"=== file convergence outside any eval slot ({len(conv)} paths) ===\n")
    for p, ns in sorted(conv.items(), key=lambda x: (-len(x[1]), x[0])):
        mark = ""
        if in_snapshot(p):
            # A shared fixture belongs to no one slot and to many at once: editing it
            # flips the run log of every skill whose tests reference it.
            mark = "   [SHARED SNAPSHOT -- count the referencing skills first]"
        elif len(ns) > HUB:
            mark = "   [fan-out -- a hub (many sections) or a family (one cluster); say which]"
        print(f"  {len(ns):3d}  {p}{mark}")
        print(f"       {' '.join('#' + str(x) for x in sorted(ns))}")
    if not conv:
        print("  (none)")

    blind = [n for n in pool if not entries[n]]
    on_slot = {n for m in queues.values() for n in m}
    # Everything the operator has actually been shown. A pool issue reaching none
    # of the three sections is invisible, and SKILL.md tells them this block is the
    # record of what the script could not see -- so it has to name them, not just
    # the ones missing a Touches: line.
    #
    # Derived from the sections that RENDERED, not from `queues`. `on_slot` means
    # "queued", and a queue of 1 on an unheld slot reaches no section at all -- so
    # folding `on_slot` in here reported those issues as shown and printed
    # "in no section above -- READ BY HAND  0" while they appeared nowhere.
    rendered = {n for sec in (must, rest, held_short) for m in sec.values() for n in m}
    shown = rendered | set(blind) | {n for ns in conv.values() for n in ns}
    unshown = sorted(set(pool) - shown)
    print(f"\n=== coverage ===")
    print(f"  pool                                {len(pool)}")
    print(f"  on at least one eval slot           {len(on_slot)}")
    print(f"  queued runs (sum of queue depths)   {sum(len(m) for m in queues.values())}"
          "   <- >= the line above; an issue can hold several slots")
    print(f"  no **Touches:** line -- READ BY HAND {len(blind)}")
    if blind:
        for n in sorted(blind):
            print(describe(n))
    print(f"  in no section above -- READ BY HAND  {len(unshown)}")
    for n in unshown:
        print(describe(n))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
