"""Unit tests for `assert_capture_pending_item_not_terminal` (issue #1226).

The validator guards this: `search-external-sites` cannot search a paywalled
site, so it builds a URL, hands it to the user, and waits for a PDF. Marking
the plan item `completed` at that point tells `research-exhaustiveness` the
avenue was searched when nothing was.

The two "buggy"/"correct" shapes below are reduced from the five committed
`ut_search_records_026` run logs, where the same scenario ends at `completed`
in v1_2026-08-13_17-42-37 and v1_2026-08-17_18-06-27 and at `in_progress` in
the other three. That 2-of-5 split is why this test exists at all: the eval
suite cannot demonstrate the guard deterministically, so the guard is
mutation-tested here instead — it must fire on the bad shape AND stay quiet on
every good one.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

from validators_lib import assert_capture_pending_item_not_terminal  # noqa: E402


def _states(final_status: str, capture_received: bool = False, *, item_id: str = "pli_001"):
    """A before/after pair where this run moved `item_id` planned → final_status."""
    def item(status):
        return {
            "id": item_id,
            "sequence": 1,
            "record_type": "census",
            "jurisdiction": "Schuylkill County, Pennsylvania",
            "date_range": "1850",
            "repository": "FamilySearch",
            "rationale": "The 1850 census places Patrick in a household.",
            "fallback_for": None,
            "status": status,
        }

    before = {"research_json": {"plans": [{"id": "pl_001", "items": [item("planned")]}], "log": []}}
    after = {
        "research_json": {
            "plans": [{"id": "pl_001", "items": [item(final_status)]}],
            "log": [
                {
                    "id": "log_004",
                    "plan_item_id": item_id,
                    "tool": "external_site",
                    "outcome": "partial",
                    "external_site": {
                        "site": "ancestry",
                        "url_generated": "https://www.ancestry.com/search/?name=Patrick_Flynn",
                        "capture_received": capture_received,
                    },
                }
            ],
        }
    }
    return before, after


def test_fires_on_completed_with_capture_pending():
    """The defect: URL handed over, no capture back, item marked completed."""
    before, after = _states("completed")
    with pytest.raises(AssertionError, match="capture never arrived"):
        assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_fires_on_skipped_with_capture_pending():
    """`skipped` is terminal too — the same defect through the new skip path."""
    before, after = _states("skipped")
    with pytest.raises(AssertionError):
        assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_passes_on_in_progress():
    """The corrected behaviour."""
    before, after = _states("in_progress")
    assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_passes_when_capture_arrived():
    """A triaged capture legitimately completes the item."""
    before, after = _states("completed", capture_received=True)
    assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_passes_on_later_entry_carrying_the_capture():
    """Step 4's in-flight entry is never revised — a capture appends a NEW
    entry. The stale `capture_received: false` must not fail the run."""
    before, after = _states("completed")
    after["research_json"]["log"].append(
        {
            "id": "log_005",
            "plan_item_id": "pli_001",
            "tool": "external_site",
            "outcome": "positive",
            "external_site": {"site": "ancestry", "capture_received": True},
        }
    )
    assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_passes_when_the_capture_arrived_without_a_plan_item_id():
    """The ending the table calls `completed`, logged the way the corpus
    actually logs external-site entries. Step 6 names the fields to carry onto
    the arrival but not `planItemId`, and 14 of 14 committed ext-sites entries
    have `plan_item_id: null` — so the arrival is matched on
    `(site, url_generated)` instead. Without that, the one ending this guard is
    supposed to permit would fail it."""
    before, after = _states("completed")
    after["research_json"]["log"].append(
        {
            "id": "log_005",
            "plan_item_id": None,
            "tool": "external_site",
            "outcome": "positive",
            "external_site": {
                "site": "ancestry",
                "url_generated": "https://www.ancestry.com/search/?name=Patrick_Flynn",
                "capture_received": True,
                "capture_filename": "ancestry-1850-flynn.pdf",
            },
        }
    )
    assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_fires_when_the_capture_that_arrived_answers_a_different_search():
    """The `(site, url_generated)` match must identify the same handoff, not
    merely the same site — otherwise any capture anywhere would launder every
    pending item on that site."""
    before, after = _states("completed")
    after["research_json"]["log"].append(
        {
            "id": "log_005",
            "plan_item_id": None,
            "tool": "external_site",
            "outcome": "positive",
            "external_site": {
                "site": "ancestry",
                "url_generated": "https://www.ancestry.com/search/?name=Bridget_Flynn",
                "capture_received": True,
            },
        }
    )
    with pytest.raises(AssertionError, match="capture never arrived"):
        assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_passes_when_a_later_search_closed_the_item():
    """An item can be closed by work this guard has no opinion about: the
    record turns up on FamilySearch after the external handoff was logged.
    Only the item's LATEST entry decides, so a stale in-flight handoff further
    up the log must not fail a legitimate `completed`."""
    before, after = _states("completed")
    after["research_json"]["log"].append(
        {
            "id": "log_005",
            "plan_item_id": "pli_001",
            "tool": "record_search",
            "outcome": "positive",
            "results_examined": 3,
            "external_site": None,
        }
    )
    assert_capture_pending_item_not_terminal(before, after, {"tags": []})


def test_ignores_items_this_run_did_not_change():
    """A scenario's pre-existing `completed` external-site item is fixture
    state, not this run's doing (e.g. mid-research-flynn's pli_002/pli_003)."""
    before, after = _states("completed")
    before["research_json"]["plans"][0]["items"][0]["status"] = "completed"
    # No status changed, so the validator skips rather than passing — assert the
    # skip explicitly. A test that merely "passes" because the function skipped
    # is the vacuous pass this whole guard exists to avoid.
    with pytest.raises(BaseException) as exc:
        assert_capture_pending_item_not_terminal(before, after, {"tags": []})
    assert exc.typename == "Skipped"


@pytest.mark.parametrize(
    "tag", ["terminal-status-expected", "autonomous", "user-requested-skip"]
)
def test_skips_exempt_tags(tag):
    """All three legitimately end terminal. `terminal-status-expected` is the
    tag that says so for its own reason; the other two are honoured because
    the corpus already carries them."""
    before, after = _states("skipped")
    with pytest.raises(BaseException) as exc:
        assert_capture_pending_item_not_terminal(before, after, {"tags": [tag]})
    assert exc.typename == "Skipped"


def test_skips_when_no_research_json():
    before, after = _states("completed")
    with pytest.raises(BaseException) as exc:
        assert_capture_pending_item_not_terminal({}, after, {"tags": []})
    assert exc.typename == "Skipped"
