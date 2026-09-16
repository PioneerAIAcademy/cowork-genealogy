"""Tests for `**Touches:**` parsing.

The bug these exist for: `paths_from_touches` took the FIRST `**Touches:**` in a
body, so a review banner quoting the phrase won over the real line. 20 of 231 open
issues parsed the wrong line on 2026-09-16, and 8 reached the wrong eval slot.

Taking the LAST match instead is equally wrong, in the opposite direction, so both
shapes are pinned here. The reach cases (a banner-only body, a Touches line inside a
fenced block) and the both-directions case (legitimate variants that must still
parse) follow CLAUDE.md's "a new lint must be proven to fail" — a guard fails two
ways, and breaking the repo tests only one of them.

Run: python3 -m pytest .claude/skills/lib/tests/test_touches.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from touches import paths_from_touches, slot_of  # noqa: E402


def paths(body):
    return {p for _kind, p in paths_from_touches(body)}


def slots(body):
    return {s for _k, p in paths_from_touches(body) if (s := slot_of(p))}


# --- break 1: a banner QUOTES the phrase above the live line (issue #2589 shape) ---

BANNER_ABOVE = """\
> **Reviewed 2026-09-15 before junior handoff.** The card's `**Touches:**` line
> names packages/engine/plugin/agents/proof-conclusion.md, which is stale.

**Touches:** eval/harness/scripts/check_runlogs.py, .github/workflows/check-runlogs.yml
"""


def test_quoted_mention_in_a_banner_does_not_win():
    assert paths(BANNER_ABOVE) == {
        "eval/harness/scripts/check_runlogs.py",
        ".github/workflows/check-runlogs.yml",
    }
    # the quoted agent path must not pull this onto an eval slot it never touches
    assert slots(BANNER_ABOVE) == set()


# --- break 2: a retired body keeps a stale line BELOW the live one (issue #1851) ---

RETIRED_BELOW = """\
> **Rescoped 2026-09-01.** What moved out: the two agent-body edits are issue #2127.

**Touches:** eval/harness/harness/skill_invocation.py, docs/architecture.md

Some live body text.

---

## Original issue

---

**Touches:** packages/engine/plugin/skills/proof-conclusion/SKILL.md, packages/engine/plugin/agents/research-exhaustiveness.md
"""


def test_line_below_a_retiring_fold_does_not_win():
    assert paths(RETIRED_BELOW) == {
        "eval/harness/harness/skill_invocation.py",
        "docs/architecture.md",
    }
    # the retired line would have claimed two eval slots this card no longer holds
    assert slots(RETIRED_BELOW) == set()


def test_original_body_spelling_folds_too():
    body = RETIRED_BELOW.replace("## Original issue", "## Original body")
    assert slots(body) == set()


# --- break 3: both shapes at once, which is what defeats any positional rule ---

BOTH = """\
> **Reviewed.** Its `**Touches:**` line is stale.

**Touches:** eval/harness/e2e/orchestrator.py

## Original issue

**Touches:** packages/engine/plugin/skills/research/SKILL.md
"""


def test_banner_above_and_retired_below_together():
    assert paths(BOTH) == {"eval/harness/e2e/orchestrator.py"}


# --- the other direction: legitimate variants must still parse ---


def test_ordinary_single_line_is_unaffected():
    body = "Prose.\n\n**Touches:** packages/engine/plugin/skills/citation/SKILL.md\n"
    assert slots(body) == {"skill:citation"}


def test_backticked_and_comma_wrapped_paths_still_parse():
    body = "**Touches:** `eval/tests/unit/timeline/`, `docs/specs/unit-test-spec.md`.\n"
    assert paths(body) == {"eval/tests/unit/timeline", "docs/specs/unit-test-spec.md"}


def test_line_wrapped_touches_still_parses():
    body = (
        "**Touches:** packages/engine/plugin/skills/timeline/SKILL.md,\n"
        "eval/tests/unit/timeline/\n"
    )
    assert slots(body) == {"skill:timeline"}


def test_a_body_whose_only_mention_is_quoted_still_parses():
    """Fallback: excluding every candidate would put the card on no queue at all,
    which is worse than parsing a quoted line -- it is invisible rather than wrong."""
    body = "> **Touches:** packages/engine/plugin/skills/citation/SKILL.md\n"
    assert slots(body) == {"skill:citation"}


def test_no_touches_line_reaches_no_queue():
    assert paths_from_touches("Prose with no Touches line.") == set()
    assert paths_from_touches("") == set()
    assert paths_from_touches(None) == set()


def test_prose_mention_after_the_fold_heading_does_not_resurrect_it():
    body = (
        "**Touches:** docs/architecture.md\n\n"
        "## Original issue\n\n"
        "**Touches:** packages/engine/plugin/agents/gps-mentor.md\n"
    )
    assert slots(body) == set()


def test_fold_cutoff_is_load_bearing_when_the_live_line_is_quoted():
    """Isolates the fold cutoff from the blockquote skip.

    Every other fixture here puts the live line above the fold AND outside a
    blockquote, so "first non-quoted" finds it whether or not the cutoff exists --
    deleting the cutoff left the whole file green. Here the only non-quoted line
    is the retired one, so the cutoff is the single thing standing between this
    card and two eval slots it gave up.
    """
    body = (
        "> **Touches:** eval/harness/harness/skill_invocation.py\n\n"
        "## Original issue\n\n"
        "**Touches:** packages/engine/plugin/skills/research/SKILL.md\n"
    )
    # falls back to the quoted live line, never the retired one below the fold
    assert slots(body) == set()
    assert paths(body) == {"eval/harness/harness/skill_invocation.py"}
