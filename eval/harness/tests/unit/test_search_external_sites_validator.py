"""Unit tests for the six #1950 Half-1 validators on `search-external-sites`.

**Why these exist at all.** Nothing in CI ever runs a validator against a real
run — validators execute only inside a paid `make eval-skill`, which this card
must not buy (#1933 owns the next one). So a validator that silently always
skips — wrong field name, a gate that never matches, `None` where a value was
expected — is green forever and reads as coverage. Each one below is therefore
asserted in **both** directions: it fires on the bad shape, and it stays quiet
on the good one.

**The field-name trap this suite pins.** Issue #1950 states every rule in the
MCP tool's camelCase parameter spelling, because that is what a
`research_log_append` call carries. The validators read `after_state`, which is
the persisted snake_case document. The mapping (from
`docs/specs/schemas/research.schema.json`) is:

    stagedResultsRef -> results_ref      NOT staged_results_ref
    resultsExamined  -> results_examined
    planItemId       -> plan_item_id

`results_ref` is the one that bites. Transcribing the issue's name verbatim
gives a V2 that never fires on anything, and no other test in the repo would
notice.

**Shapes are reduced inline, not read from run logs.** Candidate retention keeps
only the newest five per skill (`eval/CLAUDE.md`, "Retention"), so a test that
reads a run-log path ages out and starts erroring. Provenance instead:

- V3's bad shape (`results_examined: 2` logged `negative`) is the corpus's most
  common violation — 9 of 48 `external_links_search` entries, six tests, four of
  the five run logs.
- V7's bad shape (a plan item appended, then `pli_007` set `skipped`) is
  `ut_search_external_sites_013` in `v1_2026-08-20_22-45-06`, recurring on the
  dive branch's `v1_2026-08-27_00-08-56`. Roughly two runs in five.
- V2, V4 and V6 have no corpus instance yet — they guard rules the skill states
  and nothing enforced, so their bad shapes are constructed from the rule.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))  # validators_lib, the module

from test_search_external_sites import (  # noqa: E402
    test_curated_links_fetch_with_results_is_not_logged_as_nil as check_v3,
    test_log_entries_do_not_carry_each_others_fields as check_v2,
    test_no_plan_item_status_written_when_no_entry_names_one as check_v6,
    test_plan_items_are_updated_never_appended as check_v7,
    test_the_log_is_append_only as check_v8,
    test_the_url_logged_is_the_url_presented as check_v4,
    test_writes_only_to_log_and_plans as check_v7b,
)

POSITIVE = {"type": "positive", "tags": []}
URL = "https://www.ancestry.com/search/?name=Patrick_Flynn&birth=1845"


def _plan(items):
    return [{"id": "pl_001", "question_id": "q_001", "items": items}]


def _item(item_id="pli_001", status="planned"):
    return {
        "id": item_id,
        "sequence": 1,
        "record_type": "census",
        "jurisdiction": "Schuylkill County, Pennsylvania",
        "date_range": "1850",
        "repository": "Ancestry",
        "rationale": "The 1850 census places Patrick in a household.",
        "fallback_for": None,
        "status": status,
    }


def _states(*, before_log=None, after_log=None, before_items=None, after_items=None):
    """A before/after pair. Only the sections these validators read are built."""
    before_items = before_items if before_items is not None else [_item()]
    after_items = after_items if after_items is not None else list(before_items)
    return (
        {"research_json": {"log": list(before_log or []), "plans": _plan(before_items)}},
        {"research_json": {"log": list(after_log or []), "plans": _plan(after_items)}},
    )


def _links_entry(entry_id="log_010", **over):
    entry = {
        "id": entry_id,
        "tool": "external_links_search",
        "outcome": "positive",
        "query": "Schuylkill County, Pennsylvania",
        "results_examined": 2,
        "results_ref": "results/log_010.json",
        "plan_item_id": None,
        "external_site": None,
    }
    entry.update(over)
    return entry


def _site_entry(entry_id="log_011", **over):
    entry = {
        "id": entry_id,
        "tool": "external_site",
        "outcome": "partial",
        "query": "Patrick Flynn 1845",
        "results_examined": 0,
        "results_ref": None,
        "plan_item_id": None,
        "external_site": {
            "site": "ancestry",
            "url_generated": URL,
            "capture_received": False,
        },
    }
    entry.update(over)
    return entry


# --- V2: the two entries must not carry each other's fields ------------


def test_v2_fires_when_a_links_entry_carries_external_site():
    before, after = _states(after_log=[_links_entry(external_site={"site": "ancestry"})])
    with pytest.raises(AssertionError, match="carries external_site"):
        check_v2(before, after, POSITIVE)


def test_v2_fires_when_a_site_entry_carries_the_staged_handle():
    """The `results_ref` half. If this name were transcribed as
    `staged_results_ref` from the issue, this test would be the only thing in
    the repo that noticed."""
    before, after = _states(after_log=[_site_entry(results_ref="results/log_010.json")])
    with pytest.raises(AssertionError, match="carries results_ref"):
        check_v2(before, after, POSITIVE)


def test_v2_quiet_on_the_correct_pair():
    before, after = _states(after_log=[_links_entry(), _site_entry()])
    check_v2(before, after, POSITIVE)


def test_v2_treats_explicit_null_as_not_carrying():
    """Both fields are nullable in the schema. `results_ref: null` on a site
    entry is the correct shape, not a violation."""
    before, after = _states(
        after_log=[_links_entry(external_site=None), _site_entry(results_ref=None)]
    )
    check_v2(before, after, POSITIVE)


# --- V3: a fetch that returned links is not a nil ----------------------


def test_v3_fires_on_the_corpus_shape():
    """9 of 48 entries: `results_examined: 2` logged `outcome: negative`."""
    before, after = _states(
        after_log=[_links_entry(results_examined=2, outcome="negative")]
    )
    with pytest.raises(AssertionError, match="not a nil result"):
        check_v3(before, after, POSITIVE)


def test_v3_quiet_when_the_fetch_genuinely_returned_nothing():
    """Zero examined and `negative` is the honest nil — the distinction the
    rule exists to preserve."""
    before, after = _states(
        after_log=[_links_entry(results_examined=0, outcome="negative")]
    )
    check_v3(before, after, POSITIVE)


def test_v3_quiet_when_results_are_logged_positive():
    before, after = _states(after_log=[_links_entry(results_examined=2, outcome="positive")])
    check_v3(before, after, POSITIVE)


# --- V4: the URL logged is the URL presented ---------------------------


def test_v4_fires_when_the_logged_url_is_not_in_the_reply():
    before, after = _states(after_log=[_site_entry()])
    with pytest.raises(AssertionError, match="not in\n?.*the reply|never presented"):
        check_v4(before, after, "Here is your search link: https://example.com/other", POSITIVE)


def test_v4_quiet_when_the_reply_carries_the_url():
    before, after = _states(after_log=[_site_entry()])
    check_v4(before, after, f"Open this in your browser: {URL}", POSITIVE)


def test_v4_ignores_an_entry_with_no_url():
    """Shape is `test_url_generation_log_entry_shape`'s job; V4 must not
    double-report it."""
    entry = _site_entry(external_site={"site": "ancestry", "capture_received": False})
    before, after = _states(after_log=[entry])
    check_v4(before, after, "no link here", POSITIVE)


# --- V6: no plan status when no entry names a plan item ----------------


def test_v6_fires_when_status_moves_with_no_entry_naming_an_item():
    before, after = _states(
        after_log=[_links_entry(plan_item_id=None), _site_entry(plan_item_id=None)],
        before_items=[_item(status="planned")],
        after_items=[_item(status="completed")],
    )
    with pytest.raises(AssertionError, match="records no plan progress"):
        check_v6(before, after, POSITIVE)


def test_v6_gates_out_when_an_entry_names_the_item():
    """The gate, asserted rather than left as a bare skip.

    When an entry names a plan item, status writes are in scope and V6 must not
    judge them — it skips. Calling it and letting the skip propagate would make
    this test itself SKIPPED in the suite, which is the shape #1950 warns reads
    as coverage while asserting nothing. So the skip is caught and asserted.
    """
    before, after = _states(
        after_log=[_site_entry(plan_item_id="pli_001")],
        before_items=[_item(status="planned")],
        after_items=[_item(status="completed")],
    )
    with pytest.raises(pytest.skip.Exception, match="names a plan item"):
        check_v6(before, after, POSITIVE)


def test_v6_quiet_when_no_status_moved():
    before, after = _states(
        after_log=[_site_entry(plan_item_id=None)],
        before_items=[_item(status="planned")],
        after_items=[_item(status="planned")],
    )
    check_v6(before, after, POSITIVE)


# --- V7: update a plan item, never append one --------------------------


def test_v7_fires_on_an_appended_plan_item():
    """`ut_search_external_sites_013`'s shape: an item appended, then an
    existing one set `skipped`."""
    before, after = _states(
        before_items=[_item("pli_007", "planned")],
        after_items=[_item("pli_007", "skipped"), _item("pli_008", "skipped")],
    )
    with pytest.raises(AssertionError, match=r"appended plan item\(s\) \['pli_008'\]"):
        check_v7(before, after, POSITIVE)


def test_v7_quiet_when_an_existing_item_is_updated():
    """The permitted half — updating status is what the skill is for."""
    before, after = _states(
        before_items=[_item("pli_007", "planned")],
        after_items=[_item("pli_007", "completed")],
    )
    check_v7(before, after, POSITIVE)


def test_v7b_fires_on_a_write_outside_log_and_plans():
    """The adjacent boundary, and `assert_only_writes_to_sections`'s first call
    site repo-wide. Deliberately a separate check: `owned={"log","plans"}`
    permits an append to `plans`, so it cannot substitute for V7."""
    before = {"research_json": {"log": [], "plans": _plan([_item()]), "sources": []}}
    after = {
        "research_json": {
            "log": [],
            "plans": _plan([_item()]),
            "sources": [{"id": "src_001", "title": "invented"}],
        }
    }
    with pytest.raises(AssertionError):
        check_v7b(before, after, POSITIVE)


def test_v7b_quiet_on_a_log_and_plans_write():
    before, after = _states(
        after_log=[_site_entry()],
        before_items=[_item(status="planned")],
        after_items=[_item(status="completed")],
    )
    check_v7b(before, after, POSITIVE)


# --- V8: the log is append-only ----------------------------------------


def test_v8_fires_when_a_prior_entry_is_edited():
    prior = _site_entry("log_001", outcome="partial")
    edited = _site_entry("log_001", outcome="positive")
    before, after = _states(before_log=[prior], after_log=[edited])
    with pytest.raises(AssertionError):
        check_v8(before, after, POSITIVE)


def test_v8_quiet_when_entries_are_only_appended():
    """Two entries per turn plus a capture entry — the skill's normal shape."""
    prior = _site_entry("log_001")
    before, after = _states(
        before_log=[prior], after_log=[prior, _links_entry("log_002"), _site_entry("log_003")]
    )
    check_v8(before, after, POSITIVE)
