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

Why naming alone is not enough: reviewed on PR #2613, where two responses
passed a first version that looked for the token anywhere in the text — one
refusing for the wrong reason, one asserting the death-certificate search was
COMPLETE, the opposite of the blocker. A substring cannot tell "is blocking"
from "is done", so the item and a still-open marker must land in the same
sentence. Both are pinned below so the hole cannot reopen silently.
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


# --- The two cases that defeated the first version (PR #2613 review) --------


def test_fires_when_the_blocker_is_named_but_refused_for_another_reason():
    """Names the death certificate, but the refusal turns on the 1860 census.

    Naming the item in passing is not identifying it as the blocker.
    """
    with pytest.raises(AssertionError, match="never says it is still"):
        check(
            "I cannot declare exhaustive because the 1860 census has not been "
            "checked. Separately, the death certificate we already hold is a "
            "fine source.",
            IN_PROGRESS,
        )


def test_fires_when_the_response_says_the_blocking_search_is_finished():
    """The inversion: it asserts the death certificate search is COMPLETE.

    This is the opposite of the blocker, and the worst case for a bare
    substring — the guard exists to confirm the agent saw that search as
    in flight.
    """
    with pytest.raises(AssertionError, match="never says it is still"):
        check(
            "Declaration withheld: you have run out of budget. The death "
            "certificate search was completed last week, so that is not the "
            "issue.",
            IN_PROGRESS,
        )


def test_the_marker_must_share_a_sentence_with_the_item():
    """An in-progress marker elsewhere in the response does not carry.

    Otherwise any refusal mentioning some other in-flight work would
    satisfy the check while naming the wrong blocker.
    """
    with pytest.raises(AssertionError, match="never says it is still"):
        check(
            "The probate search is still in progress. The death certificate "
            "is already filed.",
            IN_PROGRESS,
        )


def test_accepts_the_phrasings_a_correct_refusal_actually_uses():
    """Phrasing freedom is the reason the check is not pinned to `pli_005`."""
    for good in (
        "pli_005 is still in_progress, so I cannot evaluate exhaustiveness yet.",
        "The death certificate search has not finished; finish it first.",
        "Blocked: the death certificate search is still open.",
        "I can't assess this yet — pli_005 is in flight.",
        "The death certificate search is outstanding, so no declaration.",
        "Cannot declare: the death certificate search has not yet returned.",
    ):
        check(good, IN_PROGRESS)
