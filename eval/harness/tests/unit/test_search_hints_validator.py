"""Direct tests for the search-hints validators (issue #2029).

Each validator is exercised in both directions: the shapes it must refuse, and
the legitimate variants it must still accept, so a check that cannot fail — or
one that fails a correct run — is caught here rather than on a paid run.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect them here.
from test_search_hints import (  # noqa: E402
    test_extracted_unlinked_hint_is_triaged as check_unlinked,
    test_hint_already_in_the_project_is_named as check_in_project,
    test_hint_list_asks_for_pending_only as check_pending,
    test_hints_item_ends_as_tagged as check_ending,
    test_image_read_before_reject as check_image,
    test_record_mode_logs_each_verdict as check_record,
    test_thin_hint_is_not_enough_information as check_thin,
    test_triage_writes_only_item_status as check_writes,
)

TRIAGE = {"type": "positive", "tags": ["triage", "pending-only", "writes-nothing"], "delegation": "x"}
TRIAGE_HELD = {
    "type": "positive", "tags": ["triage", "writes-nothing"],
    "delegation": "Review the hints.\n\npersonId: LZNY-BRF\nplanItemId: pli_007\nplanId: pl_002",
}
IMAGE = {"type": "positive", "tags": ["triage", "image-before-reject"], "delegation": "x"}
THIN = {"type": "positive", "tags": ["triage", "not-enough-information"], "delegation": "x"}
RECORD = {"type": "positive", "tags": ["record-mode", "already-in-project-accept"], "delegation": "x"}
RECORD_HELD = {
    "type": "positive", "tags": ["record-mode"],
    "delegation": "Record their verdicts.\n\npersonId: LZNY-BRF\nplanItemId: pli_007\nplanId: pl_002",
}
IN_PROJECT = {"type": "positive", "tags": ["triage", "already-in-project"], "delegation": "x"}
UNLINKED = {"type": "positive", "tags": ["triage", "extracted-not-linked"], "delegation": "x"}
M80C_ARK = "https://familysearch.org/ark:/61903/1:1:M80C"
MDEF_ARK = "https://familysearch.org/ark:/61903/1:1:MDEF"


def _call(name, **args):
    return {"tool": f"mcp__genealogy__{name}", "args": args}


def _returns(text):
    return [{"subagent_type": "search-hints", "text": text}]


def _state(log):
    return {"research_json": {"log": log}}


# --- pending only -------------------------------------------------------

def test_pending_passes_a_pending_call():
    check_pending([_call("person_record_matches", id="LZNY-BRF", status=["pending"], minConfidence=1)], TRIAGE)


def test_pending_accepts_a_stringified_status():
    check_pending([_call("person_record_matches", id="LZNY-BRF", status='["pending"]')], TRIAGE)


def test_pending_fails_a_bare_call():
    with pytest.raises(AssertionError, match="pending matches only"):
        check_pending([_call("person_record_matches", id="LZNY-BRF")], TRIAGE)


def test_pending_fails_a_call_that_adds_accepted():
    with pytest.raises(AssertionError, match="pending matches only"):
        check_pending([_call("person_record_matches", id="LZNY-BRF", status=["pending", "accepted"])], TRIAGE)


def test_pending_fails_a_triage_that_never_listed_hints():
    with pytest.raises(AssertionError, match="made no person_record_matches call"):
        check_pending([], TRIAGE)


def test_pending_ignores_a_record_mode_run_with_no_listing():
    check_pending([], RECORD)


# --- triage writes only its item's status -------------------------------

def test_writes_passes_a_read_only_triage():
    check_writes(_state([]), _state([]), [_call("record_read", recordId="MABC")], TRIAGE)


def test_writes_passes_a_plan_items_status_update():
    check_writes(_state([]), _state([]), [_call("research_append", section="plan_items", op="update")], TRIAGE_HELD)


def test_writes_passes_a_single_negative_log_entry():
    check_writes(_state([]), _state([{"id": "log_006", "outcome": "negative"}]), [], TRIAGE_HELD)


def test_writes_fails_an_evidence_write():
    with pytest.raises(AssertionError, match="plan_items"):
        check_writes(_state([]), _state([]), [_call("research_append", section="evidence")], TRIAGE_HELD)


def test_writes_fails_two_log_entries():
    with pytest.raises(AssertionError, match="at most one"):
        check_writes(_state([]), _state([{"id": "log_006"}, {"id": "log_007"}]), [], TRIAGE_HELD)


def test_writes_fails_a_positive_log_entry():
    with pytest.raises(AssertionError, match="negative"):
        check_writes(_state([]), _state([{"id": "log_006", "outcome": "positive"}]), [], TRIAGE_HELD)


def test_writes_fails_a_negative_log_entry_with_no_item_held():
    with pytest.raises(AssertionError, match="must write nothing"):
        check_writes(_state([]), _state([{"id": "log_006", "outcome": "negative"}]), [], TRIAGE)


def test_writes_fails_a_status_write_with_no_item_held():
    with pytest.raises(AssertionError, match="must write nothing"):
        check_writes(_state([]), _state([]), [_call("research_append", section="plan_items", op="update")], TRIAGE)


def test_writes_fails_a_log_call_with_no_item_held():
    with pytest.raises(AssertionError, match="must write nothing"):
        check_writes(_state([]), _state([]), [_call("research_log_append", outcome="negative")], TRIAGE)


# --- image before reject ------------------------------------------------

_READ = _call("image_transcribe", ark="ark:/61903/3:1:3Q9M-CS80-L7Q2", lookingFor="surname")


def test_image_passes_a_read_and_an_accept():
    check_image([_READ], _returns(f"Hint {M80C_ARK}: accept — image reads Thomas Flynn"), "", IMAGE)


def test_image_passes_a_read_and_not_enough_information():
    check_image([_READ], _returns(f"Hint {M80C_ARK}: not enough information to judge"), "", IMAGE)


def test_image_fails_a_reject_with_no_read():
    with pytest.raises(AssertionError, match="image_transcribe was never called"):
        check_image([], _returns(f"Hint {M80C_ARK}: reject — father is Thomas Glynn"), "", IMAGE)


def test_image_fails_a_read_of_some_other_image():
    other = _call("image_transcribe", ark="ark:/61903/3:1:3Q9M-AAAA-BBBB")
    with pytest.raises(AssertionError, match="image_transcribe was never called"):
        check_image([other], _returns(f"Hint {M80C_ARK}: accept"), "", IMAGE)


def test_image_fails_a_read_and_a_reject_anyway():
    with pytest.raises(AssertionError, match="recommended for rejection"):
        check_image([_READ], _returns(f"Hint {M80C_ARK}: reject — index says Glynn"), "", IMAGE)


def test_image_fails_a_return_with_no_hint_line():
    with pytest.raises(AssertionError, match="no `Hint <ark>: <verdict>` line"):
        check_image([_READ], _returns("The death certificate looks fine to me."), "", IMAGE)


def test_image_reads_the_agents_return_not_the_relay():
    # On a direct test the dispatcher's relay is not the subject's reply.
    with pytest.raises(AssertionError, match="no `Hint <ark>: <verdict>` line"):
        check_image([_READ], [], f"Hint {M80C_ARK}: accept", IMAGE)


# --- already linked ---------------------------------------------------

def test_in_project_passes_the_named_line():
    check_in_project(_returns(f"Hint `{MDEF_ARK}`: already linked — src_004, pe_005"), "", IN_PROJECT)


@pytest.mark.parametrize("verdict", ["accept", "not enough information to judge"])
def test_in_project_fails_a_fresh_recommendation(verdict):
    with pytest.raises(AssertionError, match="already extracted as src_004 and linked"):
        check_in_project(_returns(f"Hint {MDEF_ARK}: {verdict}"), "", IN_PROJECT)



def test_in_project_passes_a_bold_token_with_the_link():
    check_in_project(_returns(f"Hint {MDEF_ARK}: **already linked by pe_005** — src_004"), "", IN_PROJECT)


def test_in_project_fails_a_link_claim_with_no_link_named():
    with pytest.raises(AssertionError, match="does not name the link"):
        check_in_project(_returns(f"Hint {MDEF_ARK}: already linked — src_004, extracted"), "", IN_PROJECT)


def test_in_project_fails_naming_the_link_on_another_hint_only():
    reply = f"Hint {MDEF_ARK}: already linked — src_004\nHint {M80C_ARK}: accept — unlike pe_005"
    with pytest.raises(AssertionError, match="does not name the link"):
        check_in_project(_returns(reply), "", IN_PROJECT)


def test_in_project_fails_the_retired_token():
    # Renamed 2026-10-07: "already in the project" also describes an extracted
    # record nobody linked, which is the state the agent kept mislabelling.
    with pytest.raises(AssertionError, match="already extracted as src_004 and linked"):
        check_in_project(_returns(f"Hint {MDEF_ARK}: already in the project — src_004"), "", IN_PROJECT)

# --- extracted, not linked ----------------------------------------------

_MDEF_READ = [_call("record_read", recordId="ark:/61903/1:1:MDEF")]


@pytest.mark.parametrize("verdict", ["accept", "reject", "not enough information to judge"])
def test_unlinked_passes_a_read_and_a_recommendation(verdict):
    check_unlinked(_MDEF_READ, _returns(f"Hint {MDEF_ARK}: {verdict} — death certificate, src_004, not linked"), "", UNLINKED)


def test_unlinked_passes_a_bare_id_read_and_a_bold_verdict():
    reads = [_call("record_read", recordId="MDEF")]
    check_unlinked(reads, _returns("Hint `ark:/61903/1:1:MDEF`: **accept** — extracted as src_004"), "", UNLINKED)


def test_unlinked_fails_the_old_already_in_the_project_shortcut():
    with pytest.raises(AssertionError, match="expected a recommendation"):
        check_unlinked([], _returns(f"Hint {MDEF_ARK}: already linked — src_004"), "", UNLINKED)


def test_unlinked_fails_the_retired_token():
    with pytest.raises(AssertionError, match="expected a recommendation"):
        check_unlinked(_MDEF_READ, _returns(f"Hint {MDEF_ARK}: already in the project — src_004"), "", UNLINKED)


def test_unlinked_fails_a_missing_line():
    with pytest.raises(AssertionError, match="expected a recommendation"):
        check_unlinked(_MDEF_READ, _returns("The death certificate is src_004."), "", UNLINKED)


def test_unlinked_fails_a_recommendation_without_reading_the_record():
    reads = [_call("record_read", recordId="ark:/61903/1:1:M70C")]
    with pytest.raises(AssertionError, match="without its record ever being read"):
        check_unlinked(reads, _returns(f"Hint {MDEF_ARK}: accept — src_004, not linked"), "", UNLINKED)


def test_unlinked_skips_other_tests():
    with pytest.raises(pytest.skip.Exception):
        check_unlinked([], _returns(""), "", IN_PROJECT)


# --- thin evidence ------------------------------------------------------

_MTHN = "https://familysearch.org/ark:/61903/1:1:MTHN"


@pytest.mark.parametrize(
    "line",
    [
        f"Hint `{_MTHN}`: **not enough information to judge** — no county",
        f"Hint {_MTHN}: _not enough information to judge_",
        f"- Hint `ark:/61903/1:1:MTHN`: `not enough information to judge`",
    ],
)
def test_thin_reads_through_markdown(line):
    # Measured on the first paid run (2026-10-05): the agent wrote the right
    # verdict in backticks and bold, and a plain-text pattern read it as missing.
    check_thin(_returns(line), "", THIN)


def test_thin_passes_not_enough_information():
    check_thin(_returns(f"Hint {_MTHN}: Not enough information to judge — no county or age"), "", THIN)


@pytest.mark.parametrize("verdict", ["accept", "reject"])
def test_thin_fails_a_forced_verdict(verdict):
    with pytest.raises(AssertionError, match="expected 'not enough information to judge'"):
        check_thin(_returns(f"Hint {_MTHN}: {verdict}"), "", THIN)


def test_thin_fails_a_missing_line():
    with pytest.raises(AssertionError, match="got None"):
        check_thin(_returns("I could not tell."), "", THIN)


# --- record mode --------------------------------------------------------

def _entry(id_, pid, outcome, tool="person_record_matches", pli=None):
    return {
        "id": id_, "tool": tool, "plan_item_id": pli, "outcome": outcome,
        "query": {"id": "LZNY-BRF", "recordId": f"https://familysearch.org/ark:/61903/1:1:{pid}"},
        "notes": f"hint {pid}: researcher's verdict",
    }


_GOOD = [_entry("log_006", "M70C", "positive"), _entry("log_007", "M80C", "negative")]


def test_record_passes_two_verdicts_and_the_accepted_log_id():
    check_record(_state([]), _state(_GOOD), _returns("M70C: accept → log_006\nM80C: reject → log_007"), "", RECORD)


def test_record_passes_a_reject_note_naming_the_accepted_hint():
    # The query's recordId decides which hint an entry is, not the notes.
    log = [_entry("log_006", "M70C", "positive"),
           {**_entry("log_007", "M80C", "negative"), "notes": "rejected; unlike M70C, a different household"}]
    check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def test_record_fails_logging_an_accepted_hint_already_in_the_project():
    log = _GOOD + [_entry("log_008", "MDEF", "positive")]
    with pytest.raises(AssertionError, match="expected 2 new log entries"):
        check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def test_record_fails_an_outcome_that_ignores_the_verdict():
    log = [_entry("log_006", "M70C", "positive"), _entry("log_007", "M80C", "positive")]
    with pytest.raises(AssertionError, match="does not follow the researcher's verdict"):
        check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def test_record_fails_a_single_entry():
    with pytest.raises(AssertionError, match="expected 2 new log entries"):
        check_record(_state([]), _state(_GOOD[:1]), _returns("log_006"), "", RECORD)


def test_record_fails_the_wrong_tool():
    log = [_entry("log_006", "M70C", "positive", tool="record_read"), _GOOD[1]]
    with pytest.raises(AssertionError, match="not 'person_record_matches'"):
        check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def test_record_fails_a_plan_item_when_none_was_handed_over():
    log = [_entry("log_006", "M70C", "positive", pli="pli_007"), _GOOD[1]]
    with pytest.raises(AssertionError, match="plan_item_id should be null"):
        check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def _plans(status):
    return [{"id": "pl_002", "items": [{"id": "pli_007", "record_type": "fs_hints", "status": status}]}]


def _held_state(log, status):
    return {"research_json": {"log": log, "plans": _plans(status)}}


_HELD = [_entry("log_006", "M70C", "positive", pli="pli_007"), _entry("log_007", "M80C", "negative", pli="pli_007")]


def test_record_passes_held_item_named_and_completed():
    check_record(_held_state([], "in_progress"), _held_state(_HELD, "completed"), _returns("log_006"), "", RECORD_HELD)


def test_record_reads_a_backticked_or_quoted_plan_item_id():
    for delegation in ("planItemId: `pli_007`", 'planItemId: "pli_007"', '{"planItemId": "pli_007"}'):
        test = {**RECORD_HELD, "delegation": delegation}
        check_record(_held_state([], "in_progress"), _held_state(_HELD, "completed"), _returns("log_006"), "", test)


def test_record_fails_a_null_plan_item():
    # A verdict entry that names no plan item leaves the fs_hints item with no
    # log naming it, so record mode cannot complete it (issue #3153).
    log = [_entry("log_006", "M70C", "positive"), _HELD[1]]
    with pytest.raises(AssertionError, match="must name its fs_hints plan item"):
        check_record(_held_state([], "in_progress"), _held_state(log, "completed"), _returns("log_006"), "", RECORD_HELD)


def test_record_fails_some_other_plan_item():
    log = [_entry("log_006", "M70C", "positive", pli="pli_006"), _HELD[1]]
    with pytest.raises(AssertionError, match="must name its fs_hints plan item"):
        check_record(_held_state([], "in_progress"), _held_state(log, "completed"), _returns("log_006"), "", RECORD_HELD)


def test_record_fails_a_held_item_left_open():
    with pytest.raises(AssertionError, match="not completed"):
        check_record(_held_state([], "in_progress"), _held_state(_HELD, "in_progress"), _returns("log_006"), "", RECORD_HELD)


def test_record_fails_a_return_without_the_accepted_log_id():
    with pytest.raises(AssertionError, match="does not give the accepted hint's log id"):
        check_record(_state([]), _state(_GOOD), _returns("M70C accepted, M80C rejected."), "", RECORD)


# --- how triage leaves the hints item -------------------------------------

_DELEGATION = "personId: LZNY-BRF\nplanItemId: pli_007\nplanId: pl_002\nprojectPath: <workspace>"


def _ends(status):
    return {"type": "positive", "tags": ["triage", f"item-ends:{status}"], "delegation": _DELEGATION}


def _item_state(log, status, **fields):
    return {"research_json": {"log": log, "plans": [{"id": "pl_002", "items": [
        {"id": "pli_007", "record_type": "fs_hints", "status": status, **fields}]}]}}


_NO_HINTS_LOG = [{"id": "log_006", "plan_item_id": "pli_007", "outcome": "negative"}]


def test_ending_passes_no_hints_completed_through_a_negative_entry():
    check_ending(_item_state([], "planned"), _item_state(_NO_HINTS_LOG, "completed"), _ends("completed"))


def test_ending_fails_completed_with_no_entry_naming_it():
    with pytest.raises(AssertionError, match="one negative log entry"):
        check_ending(_item_state([], "planned"), _item_state([], "completed"), _ends("completed"))


def test_ending_fails_no_hints_logged_positive():
    log = [{**_NO_HINTS_LOG[0], "outcome": "positive"}]
    with pytest.raises(AssertionError, match="one negative log entry"):
        check_ending(_item_state([], "planned"), _item_state(log, "completed"), _ends("completed"))


def test_ending_passes_hints_found_waiting():
    check_ending(_item_state([], "planned"), _item_state([], "in_progress"), _ends("in_progress"))


def test_ending_fails_hints_found_left_planned():
    # A `planned` hints item is what the router routes to search-hints, so
    # leaving it there re-runs triage every turn.
    with pytest.raises(AssertionError, match="ended 'planned'"):
        check_ending(_item_state([], "planned"), _item_state([], "planned"), _ends("in_progress"))


def test_ending_fails_hints_found_with_an_entry_naming_the_item():
    log = [{"id": "log_006", "plan_item_id": "pli_007", "outcome": "positive"}]
    with pytest.raises(AssertionError, match="nothing logged"):
        check_ending(_item_state([], "planned"), _item_state(log, "in_progress"), _ends("in_progress"))


def test_ending_passes_skipped_inaccessible():
    after = _item_state([], "skipped", skip_category="inaccessible", skip_reason="3 pending hints, no researcher")
    check_ending(_item_state([], "planned"), after, _ends("skipped"))


def test_ending_fails_skipped_for_another_reason():
    after = _item_state([], "skipped", skip_category="not_applicable")
    with pytest.raises(AssertionError, match="skipped as inaccessible"):
        check_ending(_item_state([], "planned"), after, _ends("skipped"))


def test_ending_fails_completed_when_skipped_is_forced():
    with pytest.raises(AssertionError, match="ended 'completed'"):
        check_ending(_item_state([], "planned"), _item_state(_NO_HINTS_LOG, "completed"), _ends("skipped"))


def test_ending_fails_a_test_with_no_plan_item_handed_over():
    with pytest.raises(AssertionError, match="must hand over a planItemId"):
        check_ending(_item_state([], "planned"), _item_state([], "in_progress"), {**_ends("in_progress"), "delegation": "x"})


def test_ending_skips_other_tests():
    with pytest.raises(pytest.skip.Exception):
        check_ending(_state([]), _state([]), TRIAGE)


# --- the router stops after a hint triage (research suite) ---------------

from test_research import (  # noqa: E402
    test_hint_review_stops_for_the_researchers_verdicts as check_router_stops,
)

STOPS = {"type": "positive", "tags": ["routing", "routes-to:search-hints", "stops-for-verdicts"]}


def _spawn(prompt="personId: LZNY-BRF"):
    return {"tool": "Agent", "args": {"subagent_type": "search-hints", "prompt": prompt}}


def test_router_passes_one_spawn_and_no_log():
    check_router_stops([], [_spawn()], [], STOPS)


def test_router_fails_a_second_spawn_with_invented_verdicts():
    second = _spawn("verdicts: [{ark: M70C, verdict: accept}]")
    with pytest.raises(AssertionError, match="handed off 2 time"):
        check_router_stops([], [_spawn(), second], [], STOPS)


def test_router_fails_logging_the_hints_itself():
    log = [_call("research_log_append", tool="person_record_matches")]
    with pytest.raises(AssertionError, match="logged 1 entry"):
        check_router_stops([], [_spawn()], log, STOPS)


def test_router_fails_never_spawning():
    with pytest.raises(AssertionError, match="handed off 0 time"):
        check_router_stops([], [], [], STOPS)
