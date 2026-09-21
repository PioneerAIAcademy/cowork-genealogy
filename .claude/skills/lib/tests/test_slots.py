"""Tests for slot rendering in `/merge-issues`' slots.py.

The bug these exist for (issue #2621): `block()` is reached only from the MUST-CLEAR
and report-only loops, and `queues` has no key for a slot with nothing queued — so a
slot held by an In Progress card, a Review card or an open PR, with 0 or 1 mergeable
cards behind it, rendered nothing at all. An operator reading no block for a slot
concluded it was free when someone was already working it.

A second, quieter half: the coverage block promises to name every pool issue no
section reached, but derived that from `queues` ("queued") rather than from the
sections that rendered, so a lone queue-1 card was counted as shown while appearing
nowhere.

Both directions are pinned, per CLAUDE.md's "a new lint must be proven to fail": the
break cases (the section removed, either term of its keying dropped, its members
emptied, the coverage derivation reverted, the tag gate widened) and the legitimate
variants that must keep working (an icebox card, a card naming no slot, an empty
unheld slot, a card already rendered).

Originally written for the `cross-cutting` label, which was deleted repo-wide on
2026-09-20; the rendering defect it exposed is label-independent and is what these
now cover.

Run: eval/harness/.venv/bin/pytest .claude/skills/lib/tests/test_slots.py -q
CI runs it via eval/harness/pyproject.toml's `testpaths`.
"""

import json
import os
import sys
from collections import namedtuple
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "..", "merge-issues"))

import slots  # noqa: E402

SKILL = "packages/engine/plugin/skills/timeline"
SLOT = "skill:timeline"
OTHER = "packages/engine/plugin/skills/citation"
OTHER_SLOT = "skill:citation"

Block = namedtuple("Block", "section lines")


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


def blocks(out):
    """-> {slot: Block(section, lines)}, per rendered block.

    Substring assertions over whole stdout cannot tell "holder #N is on THIS slot"
    from "holder #N is on some slot", which is the single claim this script makes,
    and they cannot tell WHICH section rendered a block — so a test can pass while
    a queue-1 slot is printed under a header reading "queue 2-3". Both are recorded
    here. A slot rendered twice raises rather than silently merging.
    """
    out_blocks, current, section = {}, None, None
    for line in out.splitlines():
        if line.startswith("--- "):
            section = line.strip().strip("- ").split(" (")[0]
            current = None
        elif line.startswith("  ") and not line.startswith("   ") and "   queue " in line:
            current = line.strip().rsplit("   queue ", 1)[0]
            if current in out_blocks:
                raise AssertionError(f"slot {current} rendered more than once")
            out_blocks[current] = Block(section, [])
        elif current is not None and line.startswith("      "):
            out_blocks[current].lines.append(line.strip())
        elif not line.strip():
            continue
        else:
            current = None
    return out_blocks


def lines_of(out, slot):
    """The indented lines inside `slot`'s own block."""
    b = blocks(out).get(slot)
    return b.lines if b else []


def section_of(out, slot):
    """Which `--- ... ---` section rendered `slot`, or None if it never rendered."""
    b = blocks(out).get(slot)
    return b.section if b else None


def holders_of(out, slot):
    """The issue numbers rendered as holders inside `slot`'s own block."""
    return {ln.split("holder: #")[1].split(" ")[0]
            for ln in lines_of(out, slot) if ln.startswith("holder: #")}


# Two ordinary pool cards, so SLOT reaches `rest` and block() actually runs.
def _queued_pair():
    return [issue(11), issue(12)]


# --- the fix itself: a held slot with a short queue renders --------------------

def test_in_progress_holder_at_queue_0_renders(tmp_path):
    """The defect. `block()` runs only from the two queue loops and `queues` has no
    key for an empty slot, so a slot someone is actively working rendered nowhere —
    a slot that looks free and is not."""
    out = run([issue(101, column="In Progress", assignees=[{"login": "x"}])], tmp_path)

    assert section_of(out, SLOT) == "held, queue below 2"
    assert depth(out, SLOT) == 0
    assert "holder: #101 (In Progress, held)" in lines_of(out, SLOT)


def test_pr_holder_at_queue_0_renders(tmp_path):
    """A PR-held slot is in `pr_slots` and NOT in `held`, so that term of the union
    is load-bearing on its own."""
    out = run([], tmp_path,
              prs=[{"number": 900, "files": [{"path": f"{SKILL}/SKILL.md"}]}])

    assert section_of(out, SLOT) == "held, queue below 2"
    assert "holder: PR #900 (open, touches the snapshot)" in lines_of(out, SLOT)


def test_held_slot_at_queue_1_shows_the_holder_and_the_queued_card(tmp_path):
    """Queue 1 is the case that distinguishes a real member list from an empty one;
    at queue 0 the two are indistinguishable."""
    out = run([issue(11), issue(101, column="Review", assignees=[{"login": "x"}])],
              tmp_path)

    assert section_of(out, SLOT) == "held, queue below 2"
    assert depth(out, SLOT) == 1
    assert "holder: #101 (Review, held)" in lines_of(out, SLOT)
    assert any(ln.startswith("#11 ") for ln in lines_of(out, SLOT))


def test_each_holder_is_attributed_to_its_own_slot(tmp_path):
    """The single claim the script makes. Rendering every holder under every slot
    passes any whole-stdout substring check."""
    out = run([issue(101, column="In Progress", assignees=[{"login": "x"}]),
               issue(102, touches=OTHER, column="Review", assignees=[{"login": "y"}])],
              tmp_path)

    assert holders_of(out, SLOT) == {"101"}
    assert holders_of(out, OTHER_SLOT) == {"102"}


def test_a_held_slot_renders_once_at_every_depth(tmp_path):
    """`blocks()` raises on a double render. Queue 4 belongs to MUST CLEAR and queue
    2 to report-only; neither may also appear in the new section."""
    held4 = [issue(n) for n in (11, 12, 13, 14)] + [
        issue(101, column="In Progress", assignees=[{"login": "x"}])]
    out4 = run(held4, tmp_path)
    assert section_of(out4, SLOT) == "MUST CLEAR: queue >= 4"
    assert depth(out4, SLOT) == 4

    out2 = run(_queued_pair() + [issue(101, column="In Progress",
                                       assignees=[{"login": "x"}])], tmp_path)
    assert section_of(out2, SLOT) == "report only: queue 2-3"
    assert depth(out2, SLOT) == 2


def test_an_agent_slot_is_held_like_a_skill_slot(tmp_path):
    """touches.py resolves two slot shapes; every other fixture here uses `skill:`."""
    agent = "packages/engine/plugin/agents/record-extractor.md"
    out = run([issue(101, touches=agent, column="In Progress",
                     assignees=[{"login": "x"}])], tmp_path)

    assert holders_of(out, "agent:record-extractor") == {"101"}


# --- the merge-target tag --------------------------------------------------------

def test_only_an_unassigned_ready_card_is_named_a_merge_target(tmp_path):
    """SKILL.md: an In Progress or Review card is someone's work and is never merged
    in either direction. Only an unassigned Ready card may be called a target — and
    below a queue of 2 this line printed nowhere, which is how the wrong tag hid."""
    out = run([issue(14, column="Ready"),
               issue(102, touches=OTHER, column="In Progress")], tmp_path)

    assert "holder: #14 (Ready, unassigned -- merge INTO this one)" in lines_of(out, SLOT)
    assert "holder: #102 (In Progress, held)" in lines_of(out, OTHER_SLOT)


def test_an_assigned_ready_card_is_held_not_a_target(tmp_path):
    out = run([issue(14, column="Ready", assignees=[{"login": "x"}])], tmp_path)

    assert "holder: #14 (Ready, held)" in lines_of(out, SLOT)


# --- the coverage block tells the truth about what it could not show -------------

def test_an_unheld_queue_1_card_is_reported_as_unshown(tmp_path):
    """`on_slot` meant "queued", not "rendered". A lone queue-1 card on an unheld
    slot reaches no section, and the block that exists to name what the script could
    not see reported 0."""
    out = run([issue(11)], tmp_path)

    assert section_of(out, SLOT) is None
    assert "in no section above -- READ BY HAND  1" in out
    assert "#11 " in out.split("in no section above")[1]


def test_a_rendered_card_is_not_reported_as_unshown(tmp_path):
    """The other direction: no false positives once the derivation changed."""
    out = run(_queued_pair(), tmp_path)

    assert section_of(out, SLOT) == "report only: queue 2-3"
    assert "in no section above -- READ BY HAND  0" in out


def test_a_card_with_no_touches_line_stays_in_the_blind_bucket_only(tmp_path):
    """It must be counted once, not in both buckets."""
    out = run([issue(11, touches=None)], tmp_path)

    assert "no **Touches:** line -- READ BY HAND 1" in out
    assert "in no section above -- READ BY HAND  0" in out


# --- the other direction: what must NOT move -------------------------------------

def test_an_icebox_backlog_card_is_not_in_the_pool(tmp_path):
    out = run(_queued_pair() + [issue(21, labels=["icebox"])], tmp_path)

    assert depth(out, SLOT) == 2
    assert "#21 " not in out


def test_a_card_naming_no_slot_reaches_no_queue(tmp_path):
    out = run(_queued_pair() + [issue(22, touches="docs/architecture.md")], tmp_path)

    assert depth(out, SLOT) == 2
    assert holders_of(out, SLOT) == set()


def test_an_unqueued_unheld_slot_renders_in_no_section(tmp_path):
    """The section is keyed on holders, not on depth — an empty, unheld slot must not
    be conjured into it."""
    out = run([], tmp_path)

    assert "--- held, queue below 2 (0 slots) ---" in out
