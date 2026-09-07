"""Skill-specific validators for the check-warnings skill.

check-warnings is a read-only analysis skill — it invokes the
`person_warnings` MCP tool (declared in allowed-tools) and surfaces
the results as narrative output. It does not modify research.json or
tree.gedcomx.json.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(detection accuracy, severity classification, actionability). The
mechanical "didn't modify anything" rules live here.

Tool-usage enforcement is handled by the universal `test_tool_allowlist`,
which validates calls against the skill's `allowed-tools` frontmatter —
there is no separate `test_no_mcp_tools_called` here because check-warnings
legitimately calls `person_warnings` as its checking engine.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import re

import pytest


# --- Survivor's-claim doctrine (issue #2210) ---

# Phrases that recommend severing the source from the person. Whole-word,
# case-insensitive, so "unlinking" counts and an unrelated substring does not.
# Deliberately the same vocabulary as test_source_evaluation.py's
# `_DETACH_TERMS`: both guards assert the same #1606 reservation of detaching
# for a source genuinely about a different person.
_DETACH_TERMS = (
    "detach",
    "detaching",
    "detached",
    "unlink",
    "unlinking",
    "unlinked",
    "shouldn't be attached",
    "should not be attached",
)

# The survivor's claim in the scenario, by source id and by the word a report
# will actually use. Scoping the scan to the paragraphs that name it is the
# lesson test_source_evaluation.py records: an unscoped detach assertion
# passes a hedged reply and can never fail on a corpus that also contains a
# legitimately misattached source.
_CLAIM_TERMS = ("pension", "s6")


def _requires_survivor_claim(test) -> None:
    """Skip unless this test declares a survivor's-claim cue in its tags."""
    if "survivor-claim" not in (test.get("tags") or []):
        pytest.skip("test does not declare a survivor's-claim cue")
    if test.get("type") != "positive":
        pytest.skip("negative tests route away and produce no report")


def test_survivor_claim_action_is_not_unlink(text_response, test):
    """A survivor's benefit claim is kept and re-typed, never detached.

    A widow's or dependent's pension file names the deceased to establish
    the claimant's entitlement, so its filing date necessarily postdates
    the death and fires `hasEventAfterDeath1`. It is still genuine
    evidence *for* the deceased -- it documents the service, the death and
    the marriage the claim rests on -- so the posthumous-mention category's
    usual remedy is wrong here: the fix is to correct the fact it was
    recorded as, not to sever the source.

    Issue #2210, from alpha feedback #2167. Asserted here rather than left
    to the judge because the rubric carries no dimension for
    posthumous-mention cause classification (issue #1965), and because
    `ut_check_warnings_013` requires the opposite action on the obituary
    cue at the same SKILL.md bullet -- a wording collision that a score
    alone would not localise.

    Scoped per paragraph, so a reply that names the claim in one
    paragraph and recommends detaching in the next is not caught. That
    is the same trade-off `test_source_evaluation.py` takes deliberately:
    an unscoped scan cannot fail on a report that also, correctly,
    recommends unlinking a relative's obituary -- which the posthumous
    category calls for on its other cues.
    """
    _requires_survivor_claim(test)
    hits = [
        block
        for block in re.split(r"\n\s*\n", text_response)
        if any(claim in block.lower() for claim in _CLAIM_TERMS)
        and any(term in block.lower() for term in _DETACH_TERMS)
    ]
    assert not hits, (
        "check-warnings recommended detaching or unlinking in the same "
        "passage as the survivor's pension claim. A survivor's or "
        "dependent's benefit claim is evidence FOR the deceased: keep the "
        "source attached and correct the fact it was recorded as (the "
        "service period the file documents, or the survivor's own event). "
        "Detaching is reserved for a source genuinely about a different "
        "person (issue #1606; issue #2210). Offending passage: "
        f"{hits[0][:300] if hits else ''!r}"
    )


# --- Read-only enforcement ---

def test_research_json_unmodified(before_state, after_state, test):
    """check-warnings must not modify research.json. The skill reports
    warnings as narrative output — the project file is read-only input.

    Skipped on negative tests: the LLM is expected to route away to
    another skill (e.g. conflict-resolution), which may legitimately
    modify project files as part of its own contract. Attributing those
    writes to check-warnings would be a false positive. Mirrors the
    same guard in test_project_status.py and test_universal.py's
    test_ownership_table.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "check-warnings modified research.json — this skill is read-only. "
        "Warnings should be reported as narrative, not written into the file."
    )


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """check-warnings must not modify tree.gedcomx.json either.

    Skipped on negative tests (see test_research_json_unmodified).
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "check-warnings modified tree.gedcomx.json — this skill is read-only."
    )
