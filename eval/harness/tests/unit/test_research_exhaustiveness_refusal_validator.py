"""Direct tests for the research-exhaustiveness refusal-names-the-blocker validator.

Same reason as the sibling validator tests: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: `ut_005`'s only deterministic check was
`no-exhaustive-declaration`, which asserts that no declaration was written —
a condition a null response satisfies. Probed with a sabotage rule in the
routing skill, the run replied with the single word "BLOCKED", made no tool
calls, wrote nothing, and scored pass on Correctness, Completeness and
Declaration honesty. A refusal test whose pass condition is met by doing
nothing cannot tell a correct refusal from a dead run.

`judge_context` already asks the judge to check this ("Claude should
specifically identify pli_005 as the in-progress plan item blocking the
declaration") and the judge scored it 3 regardless, so the positive assertion
has to be deterministic.

Why the match accepts either spelling: naming the death certificate search
identifies the blocker as precisely as `pli_005` does — `pli_005` IS the
death-certificate item in `flynn-plan-in-progress`. Pinning the check to the
literal id would fail a correct refusal for its phrasing, which is the defect
`test_fetches_registration_start_date`'s tag gates exist to avoid.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research_exhaustiveness import (  # noqa: E402
    test_refusal_names_the_blocking_plan_item as check,
)

# ut_005 (routed) and ut_d1a (direct twin) both carry `refuse-in-progress`.
IN_PROGRESS = {"tags": ["research-exhaustiveness", "refuse-in-progress", "no-exhaustive-declaration"]}
DIRECT_IN_PROGRESS = {
    "tags": ["research-exhaustiveness", "refuse-in-progress", "no-exhaustive-declaration", "direct-arm"]
}
POSITIVE = {"tags": ["research-exhaustiveness", "planning", "exhaustiveness"]}


def test_fires_on_the_dead_run():
    """The case this check exists for: a one-word refusal that names nothing."""
    with pytest.raises(AssertionError, match="did not name what is blocking"):
        check("BLOCKED", IN_PROGRESS)


def test_fires_on_an_empty_response():
    with pytest.raises(AssertionError, match="did not name what is blocking"):
        check("", IN_PROGRESS)


def test_tolerates_none_text_response():
    with pytest.raises(AssertionError, match="did not name what is blocking"):
        check(None, IN_PROGRESS)


def test_passes_when_the_plan_item_id_is_named():
    check("Cannot declare: pli_005 is still in_progress.", IN_PROGRESS)


def test_passes_when_the_record_is_named_instead_of_the_id():
    """A refusal that says which search is in flight has named the blocker."""
    check(
        "I can't evaluate exhaustiveness yet — the death certificate search is "
        "still in progress. Finish it first.",
        IN_PROGRESS,
    )


def test_match_is_case_insensitive():
    check("PLI_005 is still open.", IN_PROGRESS)
    check("The Death Certificate search has not finished.", IN_PROGRESS)


def test_applies_to_the_direct_twin():
    """ut_d1a carries the same tag, so the direct route is held to it too."""
    with pytest.raises(AssertionError, match="did not name what is blocking"):
        check("BLOCKED", DIRECT_IN_PROGRESS)
    check("pli_005 is in progress.", DIRECT_IN_PROGRESS)


def test_skips_a_test_that_has_no_blocking_item():
    """Every other test in the suite: there is no in-flight plan item to name,
    so demanding one would manufacture a failure."""
    with pytest.raises(pytest.skip.Exception):
        check("Declared exhaustive.", POSITIVE)


def test_skips_when_the_tags_key_is_missing():
    with pytest.raises(pytest.skip.Exception):
        check("anything", {})


def test_failure_message_quotes_the_response():
    """The message has to show what came back, or a dead run looks like a
    phrasing miss in the run log."""
    with pytest.raises(AssertionError, match="BLOCKED"):
        check("BLOCKED", IN_PROGRESS)
