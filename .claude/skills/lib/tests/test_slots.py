"""Tests for eval-slot occupancy in `/merge-issues`' slots.py.

The bug these exist for (issue #2621): `pool` answered two different questions —
"may this be merged?" and "does this sit in a slot?" — so the `cross-cutting`
`continue` that correctly kept those cards out of the merge pool also dropped them
from slot occupancy, because `queues` is built by iterating `pool`. Ten live cards
sat in 21 slots the merge pass could not see.

The fix separates the two. An occupant appears in its slot's block and does NOT
change queue depth, which keeps meaning "this many mergeable cards" — the number
MUST_CLEAR obliges the pass to act on.

Both directions are pinned, per CLAUDE.md's "a new lint must be proven to fail":
the break cases (occupancy dropped again; occupancy folded into depth) and the
legitimate variants that must keep working (a card naming no slot, an icebox card,
an ordinary card whose numbers must not move, an active-column card that is a
holder and not an occupant).

Run: eval/harness/.venv/bin/pytest .claude/skills/lib/tests/test_slots.py -q
CI runs it via eval/harness/pyproject.toml's `testpaths`.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "..", "merge-issues"))

import slots  # noqa: E402

SKILL = "packages/engine/plugin/skills/timeline"
SLOT = "skill:timeline"
OTHER = "packages/engine/plugin/skills/citation"


def _created(days_ago):
    """tz-aware, relative to now — `age_days` subtracts from datetime.now(utc), and
    the rendered `NNNd` column would otherwise change the day after this is written."""
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def issue(number, *, touches=SKILL, labels=(), column="Backlog", assignees=()):
    return {
        "number": number,
        "title": f"issue {number}",
        "createdAt": _created(number % 30),
        "body": f"**Touches:** {touches}\n\nsome prose\n" if touches else "no line\n",
        "labels": [{"name": lb} for lb in labels],
        "assignees": list(assignees),
        "column": column,
    }


def run(issues, tmp_path, prs=()):
    """Render slots.py against these issues and return its stdout."""
    board = {"items": [{"content": {"number": i["number"]}, "status": i["column"]}
                       for i in issues]}
    paths = {}
    for name, payload in (("board", board),
                          ("open", [{k: v for k, v in i.items() if k != "column"}
                                    for i in issues]),
                          ("prs", list(prs))):
        p = tmp_path / f"{name}.json"
        p.write_text(json.dumps(payload), encoding="utf-8")
        paths[name] = str(p)

    import io
    from contextlib import redirect_stdout
    buf = io.StringIO()
    with redirect_stdout(buf):
        slots.main(paths["board"], paths["open"], paths["prs"])
    return buf.getvalue()


def depth(out, slot):
    """The rendered queue depth for `slot`, or None when the slot never prints."""
    for line in out.splitlines():
        if line.strip().startswith(f"{slot}   queue "):
            return int(line.strip().rsplit(" ", 1)[1])
    return None


# Two ordinary pool cards, so SLOT reaches `rest` and block() actually runs.
def _queued_pair():
    return [issue(11), issue(12)]


# --- the fix itself -------------------------------------------------------------

def test_cross_cutting_card_is_an_occupant_and_does_not_move_depth(tmp_path):
    cc = issue(2475, labels=["cross-cutting"])
    with_cc = run(_queued_pair() + [cc], tmp_path)
    without = run(_queued_pair(), tmp_path)

    assert "occupant: #2475 (cross-cutting, Backlog -- not a merge target)" in with_cc
    # rendered once, as the occupant. A second "#2475" would be describe() offering
    # it as a merge candidate in the same block.
    assert with_cc.count("#2475") == 1
    # depth is what it is with the card absent entirely
    assert depth(with_cc, SLOT) == depth(without, SLOT) == 2


def test_occupied_slot_with_no_queue_is_still_shown(tmp_path):
    """The case the fix exists for: a slot that looks free and is not. With queue 0
    this slot reaches neither the MUST-CLEAR nor the report-only loop."""
    out = run([issue(2476, labels=["cross-cutting"])], tmp_path)

    assert "--- occupied by cross-cutting work, not otherwise shown (1 slots) ---" in out
    assert f"{SLOT}   queue 0" in out
    assert "occupant: #2476" in out


def test_occupant_section_carries_the_slots_real_holders(tmp_path):
    """Rendered through block(), so a holder on an otherwise-unqueued slot is not
    dropped — the section would otherwise show the most contested slot as the least."""
    out = run([issue(2475, labels=["cross-cutting"]),
               issue(2524, column="Ready", assignees=[{"login": "x"}])], tmp_path)

    assert "holder: #2524 (Ready, held)" in out
    assert "occupant: #2475" in out


# --- the other direction ---------------------------------------------------------

def test_cross_cutting_card_naming_no_slot_appears_nowhere(tmp_path):
    """Modelled on #2480, whose Touches line names no snapshot path."""
    out = run(_queued_pair() + [issue(2480, touches="docs/architecture.md",
                                      labels=["cross-cutting"])], tmp_path)

    assert "#2480" not in out
    assert depth(out, SLOT) == 2


def test_icebox_cross_cutting_card_does_not_reserve_a_slot(tmp_path):
    out = run(_queued_pair() + [issue(2481, labels=["cross-cutting", "icebox"])],
              tmp_path)

    assert "occupant: #2481" not in out
    assert depth(out, SLOT) == 2


def test_active_column_cross_cutting_card_is_a_holder_not_an_occupant(tmp_path):
    """HOLDER_COLUMNS already catches this one — it must render once, as a holder.
    The pair seeds the slot so block() runs at all; with queue 1 there would be no
    holder line either and the assertion would pass vacuously."""
    out = run(_queued_pair() + [issue(2482, labels=["cross-cutting"],
                                      column="In Progress")], tmp_path)

    assert out.count("holder: #2482") == 1
    assert "occupant: #2482" not in out


def test_unassigned_cross_cutting_holder_is_never_a_merge_target(tmp_path):
    """`holders` is built without reading labels, so an UNASSIGNED cross-cutting card
    in an active column would otherwise be tagged "merge INTO this one" — nominating
    the lead's pre-assigned work as the merge target, which doctrine forbids. An
    ordinary unassigned Ready card must keep that tag."""
    out = run(_queued_pair() + [issue(2484, labels=["cross-cutting"], column="Ready"),
                                issue(14, column="Ready")], tmp_path)

    assert "holder: #2484 (Ready, cross-cutting -- not a merge target)" in out
    assert "#2484" not in out.replace(
        "holder: #2484 (Ready, cross-cutting -- not a merge target)", "")
    # the ordinary unassigned Ready card is still the natural target
    assert "holder: #14 (Ready, unassigned -- merge INTO this one)" in out


def test_cross_cutting_holder_reaches_a_renderer_on_an_unqueued_slot(tmp_path):
    """The tag above is computed in `held`, and `held` is read only by block(), which
    runs only at queue >= 2. Without `cc_held` widening the last section, an active
    cross-cutting card alone on a slot renders NOWHERE — the exact looks-free-and-is-
    not case this script exists to report, and the strongest claim on a slot there is
    (someone is doing that work now)."""
    out = run([issue(2485, labels=["cross-cutting"], column="In Progress")], tmp_path)

    assert "--- occupied by cross-cutting work, not otherwise shown (1 slots) ---" in out
    assert "holder: #2485 (In Progress, cross-cutting -- not a merge target)" in out


def test_ordinary_card_is_untouched_by_a_cross_cutting_neighbour(tmp_path):
    """An ordinary pool card's membership and its slot's depth must equal what they
    are with the cross-cutting card removed entirely."""
    ordinary = issue(13)
    cc = issue(2483, labels=["cross-cutting"])
    with_cc = run(_queued_pair() + [ordinary, cc], tmp_path)
    without = run(_queued_pair() + [ordinary], tmp_path)

    assert depth(with_cc, SLOT) == depth(without, SLOT) == 3
    assert "#13 " in with_cc
    assert "pool                                3" in with_cc
    assert "pool                                3" in without


def test_coverage_line_counts_issues_and_slots(tmp_path):
    """One card naming two slots is one issue over two slots."""
    out = run([issue(2477, touches=f"{SKILL}, {OTHER}", labels=["cross-cutting"])],
              tmp_path)

    assert "cross-cutting occupants (not in pool) 1 issues / 2 slots" in out
