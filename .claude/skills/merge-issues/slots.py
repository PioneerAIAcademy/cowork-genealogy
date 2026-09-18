"""Eval-slot queue depth for /merge-issues.

`/fill-ready`'s Gate 4 answers "is this skill's slot taken?" — one bit per slot.
This answers the question that decides whether to merge: **how many issues are
queued behind that holder**, since under Gate 4 they drain one at a time and each
one pays its own `make eval-skill` run plus a full `.ann.json` re-annotation.

A queue is not a scheduling problem. It is a sizing problem, and the output below
is what makes that countable instead of arguable.

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

# A queue this deep or deeper must leave the pass merged, or with a written reason
# per survivor. Three is the depth at which one merge still buys a run back; the
# number is a forcing function, not a measurement, and SKILL.md owns what it means.
MUST_CLEAR = 4

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

    entries, pool, holders, cross_cutting = {}, [], {}, []
    for n, issue in issues.items():
        col = status.get(n)
        labs = labels_of(issue)
        entries[n] = paths_from_touches(issue.get("body") or "")
        if col in HOLDER_COLUMNS:
            holders[n] = col
        # The merge pool: nobody is holding these. An unassigned Ready card is in
        # it *and* holds a slot -- it is the natural merge target, being furthest
        # along. An assigned one is someone's work and is never a merge candidate.
        if "cross-cutting" in labs:
            # The lead's direct assignments: never a merge candidate, so out of the
            # pool. But it still SITS in whatever slot its Touches line names, and
            # that slot's next paid run is spoken for either way -- so collect it as
            # an occupant rather than dropping it. Occupancy and pool membership are
            # different questions; one list cannot answer both.
            #
            # Backlog only, matching the pool's own column test: a cross-cutting card
            # in an active column is already in `holders` above. Icebox is excluded
            # for the same reason the pool excludes it -- a deferred card does not
            # reserve a slot.
            if col == "Backlog" and "icebox" not in labs:
                cross_cutting.append(n)
            continue
        if col == "Backlog" and "icebox" not in labs:
            pool.append(n)
        elif col == "Ready" and not issue.get("assignees"):
            pool.append(n)

    queues, held, occupants = {}, {}, {}
    for n in pool:
        for s in slots_of(entries[n]):
            queues.setdefault(s, []).append(n)
    # Deliberately NOT folded into `queues`. Depth means "this many mergeable cards",
    # which is what MUST_CLEAR obliges the pass to act on and what
    # audit-board/SKILL.md reads out of this block; counting a card the pass may not
    # merge would force slots it can never discharge by merging.
    for n in cross_cutting:
        for s in slots_of(entries[n]):
            occupants.setdefault(s, []).append(n)
    for n, col in holders.items():
        for s in slots_of(entries[n]):
            unassigned = not issues[n].get("assignees")
            held.setdefault(s, []).append((n, col, unassigned))

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
        for n, col, unassigned in sorted(held.get(slot, [])):
            tag = "unassigned -- merge INTO this one" if unassigned else "held"
            print(f"      holder: #{n} ({col}, {tag})")
        for p in sorted(pr_slots.get(slot, [])):
            print(f"      holder: PR #{p} (open, touches the snapshot)")
        for n in sorted(occupants.get(slot, [])):
            print(f"      occupant: #{n} (cross-cutting, Backlog -- not a merge target)")
        for n in sorted(members, key=lambda x: -age_days(issues[x]["createdAt"], now)):
            print(describe(n))
        print()

    must = {s: m for s, m in queues.items() if len(m) >= MUST_CLEAR}
    rest = {s: m for s, m in queues.items() if 2 <= len(m) < MUST_CLEAR}

    print(f"=== eval slot queues (pool: {len(pool)} issues -- non-icebox Backlog + "
          "unassigned Ready; `cross-cutting` excluded from the pool, shown as "
          "occupants) ===\n")
    print(f"--- MUST CLEAR: queue >= {MUST_CLEAR} "
          f"({len(must)} slots) ---\n")
    for s, m in sorted(must.items(), key=lambda x: (-len(x[1]), x[0])):
        block(s, m)
    if not must:
        print("  (none)\n")

    print(f"--- report only: queue 2-{MUST_CLEAR - 1} ({len(rest)} slots) ---\n")
    for s, m in sorted(rest.items(), key=lambda x: (-len(x[1]), x[0])):
        block(s, m)
    if not rest:
        print("  (none)\n")

    # A slot can be spoken for and carry no mergeable queue at all. Those slots reach
    # neither loop above -- block() runs only at queue >= 2 -- so the thing this
    # section exists to show, a slot that looks free and is not, would still be
    # invisible. Same renderer, so its holders and PR holders come with it: the most
    # contested slot here can be one with two active-column holders and a queue of 1.
    spoken = {s: queues.get(s, []) for s in occupants if s not in must and s not in rest}
    print(f"--- occupied by cross-cutting work, not otherwise shown "
          f"({len(spoken)} slots) ---\n")
    for s in sorted(spoken):
        block(s, spoken[s])
    if not spoken:
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
    shown = on_slot | set(blind) | {n for ns in conv.values() for n in ns}
    unshown = sorted(set(pool) - shown)
    print(f"\n=== coverage ===")
    print(f"  pool                                {len(pool)}")
    print(f"  on at least one eval slot           {len(on_slot)}")
    print(f"  queued runs (sum of queue depths)   {sum(len(m) for m in queues.values())}"
          "   <- >= the line above; an issue can hold several slots")
    print(f"  cross-cutting occupants (not in pool) "
          f"{len({n for ns in occupants.values() for n in ns})} issues / "
          f"{len(occupants)} slots")
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
