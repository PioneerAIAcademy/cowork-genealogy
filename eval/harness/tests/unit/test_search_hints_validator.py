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
    test_hint_list_asks_for_pending_only as check_pending,
    test_image_read_before_reject as check_image,
    test_record_mode_logs_each_verdict as check_record,
    test_thin_hint_is_not_enough_information as check_thin,
    test_triage_writes_nothing as check_writes,
)

TRIAGE = {"type": "positive", "tags": ["triage", "pending-only", "writes-nothing"], "delegation": "x"}
IMAGE = {"type": "positive", "tags": ["triage", "image-before-reject"], "delegation": "x"}
THIN = {"type": "positive", "tags": ["triage", "not-enough-information"], "delegation": "x"}
RECORD = {"type": "positive", "tags": ["record-mode"], "delegation": "x"}
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


# --- triage writes nothing ----------------------------------------------

def test_writes_passes_a_read_only_triage():
    check_writes(_state([]), _state([]), [_call("record_read", recordId="MABC")], TRIAGE)


def test_writes_fails_a_log_call():
    with pytest.raises(AssertionError, match="must write nothing"):
        check_writes(_state([]), _state([]), [_call("research_log_append", tool="person_record_matches")], TRIAGE)


def test_writes_fails_a_new_log_entry():
    with pytest.raises(AssertionError, match="added a log entry"):
        check_writes(_state([]), _state([{"id": "log_006"}]), [], TRIAGE)


# --- image before reject ------------------------------------------------

_READ = _call("image_transcribe", ark="ark:/61903/3:1:3Q9M-CSHD-WQ1F", lookingFor="father's name")


def test_image_passes_a_read_and_an_accept():
    check_image([_READ], _returns(f"Hint {MDEF_ARK}: accept — image reads Thomas Flynn"), "", IMAGE)


def test_image_passes_a_read_and_not_enough_information():
    check_image([_READ], _returns(f"Hint {MDEF_ARK}: not enough information to judge"), "", IMAGE)


def test_image_fails_a_reject_with_no_read():
    with pytest.raises(AssertionError, match="image_transcribe was never called"):
        check_image([], _returns(f"Hint {MDEF_ARK}: reject — father is Thomas Glynn"), "", IMAGE)


def test_image_fails_a_read_of_some_other_image():
    other = _call("image_transcribe", ark="ark:/61903/3:1:3Q9M-AAAA-BBBB")
    with pytest.raises(AssertionError, match="image_transcribe was never called"):
        check_image([other], _returns(f"Hint {MDEF_ARK}: accept"), "", IMAGE)


def test_image_fails_a_read_and_a_reject_anyway():
    with pytest.raises(AssertionError, match="recommended for rejection"):
        check_image([_READ], _returns(f"Hint {MDEF_ARK}: reject — index says Glynn"), "", IMAGE)


def test_image_fails_a_return_with_no_hint_line():
    with pytest.raises(AssertionError, match="no `Hint <ark>: <verdict>` line"):
        check_image([_READ], _returns("The death certificate looks fine to me."), "", IMAGE)


def test_image_reads_the_agents_return_not_the_relay():
    # On a direct test the dispatcher's relay is not the subject's reply.
    with pytest.raises(AssertionError, match="no `Hint <ark>: <verdict>` line"):
        check_image([_READ], [], f"Hint {MDEF_ARK}: accept", IMAGE)


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


_GOOD = [_entry("log_006", "MABC", "positive"), _entry("log_007", "MDEF", "negative")]


def test_record_passes_two_verdicts_and_the_accepted_log_id():
    check_record(_state([]), _state(_GOOD), _returns("MABC: accept → log_006\nMDEF: reject → log_007"), "", RECORD)


def test_record_fails_an_outcome_that_ignores_the_verdict():
    log = [_entry("log_006", "MABC", "positive"), _entry("log_007", "MDEF", "positive")]
    with pytest.raises(AssertionError, match="does not follow the researcher's verdict"):
        check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def test_record_fails_a_single_entry():
    with pytest.raises(AssertionError, match="expected 2 new log entries"):
        check_record(_state([]), _state(_GOOD[:1]), _returns("log_006"), "", RECORD)


def test_record_fails_the_wrong_tool():
    log = [_entry("log_006", "MABC", "positive", tool="record_read"), _GOOD[1]]
    with pytest.raises(AssertionError, match="not 'person_record_matches'"):
        check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def test_record_fails_a_plan_item_on_an_ad_hoc_review():
    log = [_entry("log_006", "MABC", "positive", pli="pli_003"), _GOOD[1]]
    with pytest.raises(AssertionError, match="plan_item_id should be null"):
        check_record(_state([]), _state(log), _returns("log_006"), "", RECORD)


def test_record_fails_a_return_without_the_accepted_log_id():
    with pytest.raises(AssertionError, match="does not give the accepted hint's log id"):
        check_record(_state([]), _state(_GOOD), _returns("MABC accepted, MDEF rejected."), "", RECORD)
