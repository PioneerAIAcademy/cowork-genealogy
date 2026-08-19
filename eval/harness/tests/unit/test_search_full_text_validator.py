"""Direct tests for the three search-full-text validators added in the #1651
deep dive (log-fidelity, first-call scoping, plan-item completion congruence).

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and these three ran their real pass/fail set exactly
once, inside a paid `make eval-skill` run. A later refactor could make one
vacuous with nothing going red. Firing cases are drawn from committed run
logs wherever one exists (traceable back to the exact test/run that
produced the defect); the one branch with no real occurrence in any
committed run log (test_plan_item_completion_matches_its_own_record_type's
structural half -- a plan item completed with zero attributed log entries)
is hand-built, since there is nothing real to draw it from.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_full_text import (  # noqa: E402
    test_log_query_traces_to_fulltext_search_call as check_log_fidelity,
    test_first_fulltext_search_call_is_unscoped as check_first_call_unscoped,
    test_plan_item_completion_matches_its_own_record_type as check_plan_item_completion,
)


def call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args}


# --- test_log_query_traces_to_fulltext_search_call ---------------------
# Deep dive #1651 finding 1: `ut_search_full_text_010`, run
# `v1_2026-07-27_22-27-37` -- the real fulltext_search call carried no
# place field, but the log entry it produced claimed recordPlace1/2 anyway.

FIRING_LOG_FIDELITY_CALLS = [
    call("fulltext_search", keywords="+Flynn +witness", count=50),
]
FIRING_LOG_FIDELITY_BEFORE = {"research_json": {"log": []}}
FIRING_LOG_FIDELITY_AFTER = {"research_json": {"log": [{
    "id": "log_005",
    "plan_item_id": None,
    "tool": "fulltext_search",
    "query": {
        "keywords": "+Flynn +witness",
        "recordPlace1": "Pennsylvania",
        "recordPlace2": "Schuylkill",
    },
    "outcome": "positive",
    "results_examined": 1,
}]}}


def test_log_fidelity_fires_on_a_claimed_filter_the_call_never_sent():
    with pytest.raises(AssertionError) as e:
        check_log_fidelity(FIRING_LOG_FIDELITY_BEFORE, FIRING_LOG_FIDELITY_AFTER, FIRING_LOG_FIDELITY_CALLS)
    assert "recordPlace1" in str(e.value)
    assert "recordPlace2" in str(e.value)


def test_log_fidelity_passes_when_the_log_only_claims_what_was_sent():
    calls = [call("fulltext_search", keywords="+Naveda +Somarriba", recordPlace1="Spain")]
    before = {"research_json": {"log": []}}
    after = {"research_json": {"log": [{
        "id": "log_001",
        "plan_item_id": None,
        "tool": "fulltext_search",
        "query": {"keywords": "+Naveda +Somarriba", "recordPlace1": "Spain"},
        "outcome": "positive",
        "results_examined": 3,
    }]}}
    check_log_fidelity(before, after, calls)


def test_log_fidelity_does_not_guess_when_the_entry_cannot_be_correlated_to_a_call():
    """An entry whose keywords/nlQuery match no call this turn is left
    alone rather than guessed at -- see the validator's own docstring. Not
    a skip: the loop simply has nothing to check this entry against, so it
    passes silently rather than raising or skipping."""
    calls = [call("fulltext_search", keywords="+Flynn +witness")]
    before = {"research_json": {"log": []}}
    after = {"research_json": {"log": [{
        "id": "log_005",
        "plan_item_id": None,
        "tool": "fulltext_search",
        "query": {"keywords": "+something else entirely", "recordPlace1": "Pennsylvania"},
        "outcome": "positive",
        "results_examined": 1,
    }]}}
    check_log_fidelity(before, after, calls)


# --- test_first_fulltext_search_call_is_unscoped ------------------------
# Deep dive #1651 finding 2: `ut_search_full_text_002`, run
# `v1_2026-07-27_22-27-37` -- the first fulltext_search call for the turn
# already carried recordType/yearFrom/yearTo, before any unfiltered hit
# count was ever observed. Confirmed by the fix: after SKILL.md named the
# actual arguments explicitly, a re-run of the same test's first call
# (`ut_search_full_text_007`, run `v1_2026-08-19_14-12-22`) came back clean.

FIRING_FIRST_CALL_CALLS = [
    call(
        "fulltext_search",
        keywords="+Flynn +Patrick",
        recordType="Probate Records",
        yearFrom=1870,
        yearTo=1890,
        count=20,
    ),
]

PASSING_FIRST_CALL_CALLS = [
    call("fulltext_search", keywords="+Patrick +Fl?n*", count=20),
]


def test_first_call_unscoped_fires_on_a_prefiltered_first_call():
    with pytest.raises(AssertionError) as e:
        check_first_call_unscoped(FIRING_FIRST_CALL_CALLS)
    msg = str(e.value)
    assert "recordType" in msg
    assert "yearFrom" in msg
    assert "yearTo" in msg


def test_first_call_unscoped_passes_on_a_clean_first_call():
    check_first_call_unscoped(PASSING_FIRST_CALL_CALLS)


def test_first_call_unscoped_skips_when_no_fulltext_search_was_called():
    with pytest.raises(pytest.skip.Exception):
        check_first_call_unscoped([call("research_log_append", planItemId=None)])


def test_first_call_unscoped_only_checks_the_literal_first_call():
    """Documented narrower scope (see the validator's own docstring): a
    second, later fulltext_search call in the same turn that adds a filter
    is not what this check is about, and must not trip it."""
    calls = [
        call("fulltext_search", keywords="+Naveda +Somarriba", count=50),
        call("fulltext_search", keywords="+Naveda +Somarriba", recordPlace1="Spain"),
    ]
    check_first_call_unscoped(calls)


# --- test_plan_item_completion_matches_its_own_record_type --------------
# Deep dive #1651 finding 3, content branch: `ut_search_full_text_011`, run
# `v1_2026-07-27_21-14-16` -- `pli_006` (record_type "probate") flips to
# completed; its two attributed log entries are both witness-search
# queries, none of which mention probate/will vocabulary.

FIRING_CONTENT_BEFORE = {"research_json": {"plans": [
    {"id": "pl_002", "items": [
        {"id": "pli_006", "record_type": "probate", "status": "in_progress"},
    ]},
]}}
FIRING_CONTENT_AFTER = {"research_json": {
    "log": [
        {"id": "log_006", "plan_item_id": "pli_006", "tool": "fulltext_search",
         "query": {"keywords": "+\"Thomas Flynn\" +witness"},
         "notes": "1878 deed of conveyance, both Thomas Flynn and Patrick Flynn appear as witnesses"},
        {"id": "log_007", "plan_item_id": "pli_006", "tool": "fulltext_search",
         "query": {"keywords": "+Patrick +Flynn +witness"},
         "notes": "same deed, Patrick Flynn side of the query"},
    ],
    "plans": [
        {"id": "pl_002", "items": [
            {"id": "pli_006", "record_type": "probate", "status": "completed"},
        ]},
    ],
}}


def test_plan_item_completion_fires_on_content_mismatch_ut_011():
    with pytest.raises(AssertionError) as e:
        check_plan_item_completion(FIRING_CONTENT_BEFORE, FIRING_CONTENT_AFTER)
    assert "pli_006" in str(e.value)
    assert "probate" in str(e.value)


# Deep dive #1651, the legitimate counterpart: `ut_search_full_text_013`,
# run `v1_2026-08-19_14-12-22` -- `pli_001` (record_type "church") is
# completed by the search it was actually created for, and the log entry's
# own notes independently mention baptism/burial vocabulary.

PASSING_CONTENT_BEFORE = {"research_json": {"plans": [
    {"id": "pl_001", "items": [
        {"id": "pli_001", "record_type": "church", "status": "in_progress"},
    ]},
]}}
PASSING_CONTENT_AFTER = {"research_json": {
    "log": [
        {"id": "log_001", "plan_item_id": "pli_001", "tool": "fulltext_search",
         "query": {"keywords": "+Naveda +Somarriba"},
         "notes": "baptism of a sibling and the burial record both name the parents"},
    ],
    "plans": [
        {"id": "pl_001", "items": [
            {"id": "pli_001", "record_type": "church", "status": "completed"},
        ]},
    ],
}}


def test_plan_item_completion_passes_on_the_legitimate_ut_013_shape():
    check_plan_item_completion(PASSING_CONTENT_BEFORE, PASSING_CONTENT_AFTER)


# Structural branch: hand-built, not drawn from a committed run log. Per
# task review on #1742 (independently reproduced): across every committed
# run log, every plan-item completion has at least one log entry newly
# attributed to it that same turn -- so this branch has never once fired
# on real data, and needs a fabricated case to prove it works at all.

def test_plan_item_completion_fires_when_nothing_is_attributed_at_all():
    before = {"research_json": {"plans": [
        {"id": "pl_009", "items": [
            {"id": "pli_099", "record_type": "probate", "status": "in_progress"},
        ]},
    ]}}
    after = {"research_json": {
        "log": [],
        "plans": [
            {"id": "pl_009", "items": [
                {"id": "pli_099", "record_type": "probate", "status": "completed"},
            ]},
        ],
    }}
    with pytest.raises(AssertionError) as e:
        check_plan_item_completion(before, after)
    assert "pli_099" in str(e.value)
    assert "no log entry added this turn is attributed to it" in str(e.value)


def test_plan_item_completion_skips_a_record_type_outside_the_vocabulary():
    """family_bible carries no vocabulary at all -- structural check only,
    never asserted clean by a term match it never had."""
    before = {"research_json": {"plans": [
        {"id": "pl_004", "items": [
            {"id": "pli_030", "record_type": "family_bible", "status": "in_progress"},
        ]},
    ]}}
    after = {"research_json": {
        "log": [{"id": "log_030", "plan_item_id": "pli_030", "tool": "fulltext_search",
                 "query": {"keywords": "+Schmidt"}, "notes": "found the family bible page"}],
        "plans": [{"id": "pl_004", "items": [
            {"id": "pli_030", "record_type": "family_bible", "status": "completed"},
        ]}],
    }}
    with pytest.raises(pytest.skip.Exception):
        check_plan_item_completion(before, after)


def test_plan_item_completion_skips_when_nothing_completed_this_turn():
    before = {"research_json": {"plans": []}}
    after = {"research_json": {"plans": []}}
    with pytest.raises(pytest.skip.Exception):
        check_plan_item_completion(before, after)
