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

import json
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


# --- The acceptance check: the corpus, not the vocabulary -------------------
#
# A marker list can only be measured against phrasings it was NOT written from.
# The first tightening was checked against seven of the eight recorded
# responses — the list was hand-written, not derived — and it failed the eighth
# on an abbreviation (`d. 1908` split mid-sentence). So the check below
# re-derives the set from the run logs every time it runs.

_RUNLOGS = Path(__file__).resolve().parents[3] / "runlogs" / "unit" / "research-exhaustiveness"


def _recorded_refusals():
    """Every `_005` / `_d1a` response in the committed run logs."""
    out = []
    for log in sorted(_RUNLOGS.glob("v1_*.json")):
        if log.name.endswith(".ann.json"):
            continue
        data = json.loads(log.read_text(encoding="utf-8"))
        for test in data.get("tests", []):
            if test.get("test_id") not in (
                "ut_research_exhaustiveness_005",
                "ut_research_exhaustiveness_d1a",
            ):
                continue
            for run in test.get("runs", []):
                # `output` is an OBJECT — text_response, activated,
                # skills_invoked, tool_calls, files_created,
                # builtin_tool_calls, warnings. Dumping the whole thing
                # hands the validator the tool-call payloads and the check
                # passes on those instead of on the reply. Reviewed on
                # PR #2613: with the old `[.!?]+` splitter restored, the
                # dumped form still passed all eight while the real
                # `text_response` for ut_005 in v1_2026-09-14_09-31-12
                # failed. Read the field.
                output = run.get("output") or {}
                assert isinstance(output, dict), (
                    f"{log.stem} {test['test_id']}: run output is "
                    f"{type(output).__name__}, expected the output object"
                )
                out.append((log.stem, test["test_id"], output.get("text_response") or ""))
    return out


def test_every_recorded_refusal_still_passes():
    """All eight were graded pass, so all eight must satisfy this guard.

    This is the check that catches an over-tightening. It is deliberately
    derived from the run logs rather than a list in this file.
    """
    recorded = _recorded_refusals()
    assert len(recorded) >= 8, (
        f"expected at least the 8 recorded _005/_d1a responses, found "
        f"{len(recorded)} — has the retention prune removed run logs?"
    )
    empty = [f"{s} {t}" for s, t, x in recorded if not x.strip()]
    assert not empty, f"no text_response read for: {empty} — check the output field"
    failures = []
    for stem, test_id, text in recorded:
        try:
            check(text, IN_PROGRESS)
        except AssertionError as exc:
            failures.append(f"{stem} {test_id}: {exc}")
    assert not failures, "the guard fails refusals that were graded pass:\n" + "\n".join(failures)


def test_an_abbreviation_does_not_split_the_sentence():
    """`d. 1908` is why a naive `[.!?]+` split failed a correct refusal."""
    check(
        "Plan item `pli_005` (a death certificate search for Patrick Flynn, "
        "d. 1908, Schuylkill County, PA) is still `in_progress`.",
        IN_PROGRESS,
    )
    check("The death certificate search at the U.S. archive is still in progress.", IN_PROGRESS)


def test_ordinary_refusal_phrasings_the_first_marker_list_missed():
    """Seven from the PR #2613 review, none of which the first list matched."""
    for good in (
        "Plan item pli_005 remains open, so I cannot evaluate exhaustiveness.",
        "pli_005 is open.",
        "The death certificate search - we are waiting on it.",
        "The death certificate search has not come back.",
        "pli_005 is unresolved.",
        "The death certificate search is running.",
        "The death certificate search has not been completed.",
    ):
        check(good, IN_PROGRESS)


def test_known_conservative_miss_item_and_status_on_separate_lines():
    """Documented limitation, pinned so it is a decision and not a surprise.

    A line break is a hard boundary, which is what closes the
    neighbouring-sentence hole. The cost is that a refusal splitting the
    item from its status across two list lines fails. No response in the
    committed corpus is shaped that way. If one ever is, name the status
    on the same line rather than widening the window — a window that
    spans lines lets a marker from an unrelated bullet carry.
    """
    with pytest.raises(AssertionError, match="never says it is still"):
        check("- pli_005: death certificate search\n- status: still in progress", IN_PROGRESS)
