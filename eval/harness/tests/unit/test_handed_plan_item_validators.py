"""Direct tests for the handed-plan-item validators (issue #3581).

`validators/` is not collected by `make harness-test` (pyproject sets
testpaths = ["tests"]), so a validator's real pass/fail set otherwise appears
only inside a paid per-skill run. These run each one over inputs it must accept
and inputs it must reject.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import (  # noqa: E402
    test_delegation_hands_plan_item_verbatim as research_check,
)
from test_search_records import (  # noqa: E402
    test_handed_plan_item_skips_research_query as skips_check,
    test_mismatched_handed_plan_item_is_queried as mismatch_check,
)

ITEM = {
    "id": "pli_001",
    "sequence": 1,
    "record_type": "vital_record",
    "jurisdiction": "Hamre prestegjeld, Hordaland, Norway",
    "rationale": "Search for Unna \u2014 the distinctive patronymic narrows results.",
    "fallback_for": None,
    "status": "planned",
}


def call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args, "input": args}


# --- search-records: item handed, no research_query -------------------------

HANDED = {"tags": ["search", "handed-plan-item"]}
MISMATCH = {"tags": ["search", "handed-plan-item-mismatch"]}
UNTAGGED = {"tags": ["search"]}


def test_skip_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        skips_check([call("research_query", section="plans")], UNTAGGED)


def test_skip_check_passes_when_no_research_query_was_made():
    skips_check([call("record_search", surname="Flynn"), call("research_log_append")], HANDED)


def test_skip_check_fails_when_research_query_was_made():
    with pytest.raises(AssertionError, match="still called research_query"):
        skips_check([call("research_query", section="plans"), call("record_search")], HANDED)


def test_skip_check_fails_on_a_query_after_the_search_too():
    with pytest.raises(AssertionError):
        skips_check([call("record_search"), call("research_query", section="plans")], HANDED)


# --- search-records: mismatched id must be queried first --------------------

def test_mismatch_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        mismatch_check([call("record_search")], UNTAGGED)


def test_mismatch_check_passes_when_the_item_is_read_before_searching():
    mismatch_check([call("research_query", section="plans"), call("record_search")], MISMATCH)


def test_mismatch_check_fails_when_the_item_is_never_read():
    with pytest.raises(AssertionError, match="no research_query was made"):
        mismatch_check([call("record_search")], MISMATCH)


def test_mismatch_check_fails_when_the_search_ran_first():
    with pytest.raises(AssertionError, match="came after the first record_search"):
        mismatch_check([call("record_search"), call("research_query", section="plans")], MISMATCH)


# --- research: the spawn carries the item verbatim --------------------------

RTEST = {"tags": ["routing", "routes-to:search-records", "asserts-delegation-plan-item"]}
BEFORE = {"research_json": {"plans": [{"id": "pl_001", "status": "active", "items": [ITEM]}]}}


def spawn(prompt):
    return {"tool": None, "args": {"subagent_type": "search-records", "prompt": prompt}}


def block(item, fence=False):
    body = json.dumps(item, indent=2, ensure_ascii=False)
    return ("```json\n" + body + "\n```") if fence else body


def test_research_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        research_check({"tags": ["routing", "routes-to:search-records"]}, [], BEFORE)


def test_research_check_passes_on_a_verbatim_block():
    prompt = f"planItemId: pli_001\nprojectPath: /p\nplan_item:\n{block(ITEM)}"
    research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_passes_on_a_fenced_and_escaped_block():
    escaped = json.dumps(ITEM, indent=2)  # ensure_ascii escapes the em dash
    prompt = f"planItemId: pli_001\nplan_item:\n```json\n{escaped}\n```"
    research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_no_plan_item_block_is_sent():
    with pytest.raises(AssertionError, match="no plan_item JSON block"):
        research_check(RTEST, [spawn("planItemId: pli_001\nprojectPath: /p")], BEFORE)


def test_research_check_fails_when_the_item_is_summarised():
    summary = dict(ITEM, rationale="Search for Unna.")
    prompt = f"planItemId: pli_001\nplan_item:\n{block(summary)}"
    with pytest.raises(AssertionError, match="not verbatim; differs on \['rationale'\]"):
        research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_a_field_is_dropped():
    trimmed = {k: v for k, v in ITEM.items() if k != "fallback_for"}
    prompt = f"planItemId: pli_001\nplan_item:\n{block(trimmed)}"
    with pytest.raises(AssertionError, match="differs on \['fallback_for'\]"):
        research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_no_search_records_was_spawned():
    with pytest.raises(AssertionError, match="No recorded spawn"):
        research_check(RTEST, [], BEFORE)
