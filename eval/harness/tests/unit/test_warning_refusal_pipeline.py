"""The refusal signal has to survive the whole pipeline, not just one leg.

Every defect this file guards against was found one at a time, by a separate
review round, after the previous leg had been fixed in isolation:

    engine answer
      -> recorded      unit tier writes `response` (dict); e2e `response_summary` (str)
      -> summarised    verbatim escaped envelope under 500 chars, else json.dumps
      -> stripped      retention rewrites it to `replay_remnant`, irreversibly
      -> read          `unresolved_warning_refusal`

A leg-at-a-time test passes while the signal dies at the join. These walk an
answer end to end and assert the verdict at the far side, so a leg that drops it
reddens here whichever leg it is.

The four answers below are the ones whose verdicts differ, and each was got
wrong at some point: an abandoned refusal (a violation), a resolved one (not),
a stale-justification round-trip (not -- the agent did the right thing), and a
no-project answer (not a landed write, so it cannot resolve anything).
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.skill_invocation import (  # noqa: E402
    STALE_JUSTIFICATION_MARKER,
    unresolved_warning_refusal,
)
from scripts.prune_runlogs import replay_remnant  # noqa: E402

WRITER = "mcp__genealogy__tree_edit"

REFUSAL = {"ok": False, "reason": "unjustified_warnings", "warnings": [{"warningId": "w1"}]}
STALE = {
    "ok": False,
    "reason": "unjustified_warnings",
    "warnings": [{"message": f"{STALE_JUSTIFICATION_MARKER}(s) not in the current delta"}],
}
SUCCESS = {"ok": True, "written": 1}
NO_PROJECT = {"reason": "no_project"}


def as_unit(answer):
    """What `mock_mcp` records: the dict itself, under `response`."""
    return {"tool": WRITER, "response": answer}


def as_e2e_summary(answer):
    """What the summarizer records past the verbatim threshold: json.dumps."""
    return {"tool": WRITER, "response_summary": json.dumps(answer)}


def as_e2e_verbatim(answer):
    """What it records UNDER 500 chars: the raw MCP envelope, where the tool's
    document is an escaped string. This is the shape a quoted-key matcher is
    blind to."""
    inner = json.dumps(answer)
    envelope = [{"type": "text", "text": inner}]
    return {"tool": WRITER, "response_summary": json.dumps(envelope)}


def as_stripped(answer):
    """What survives retention: the replay remnant, which is all a log older
    than 14 days has. Irreversible, so a marker missing here is gone."""
    return {"tool": WRITER, "response_summary": replay_remnant(json.dumps(answer))}


def as_both_keys_summary_blank(answer):
    """A producer that SETS `response_summary` rather than omitting it, while
    the payload sits in `response`. A `None`-only fallback reads the blank key,
    finds nothing, and never consults the populated one -- the same tier
    blindness as keying on one field, arriving by a different route."""
    return {"tool": WRITER, "response_summary": "", "response": answer}


RECORDINGS = [
    pytest.param(as_unit, id="unit-tier-dict"),
    pytest.param(as_e2e_summary, id="e2e-json-dumps"),
    pytest.param(as_e2e_verbatim, id="e2e-escaped-envelope"),
    pytest.param(as_stripped, id="stripped-remnant"),
    pytest.param(as_both_keys_summary_blank, id="blank-summary-populated-response"),
]


@pytest.mark.parametrize("record", RECORDINGS)
def test_an_abandoned_refusal_is_a_violation_however_it_was_recorded(record):
    assert unresolved_warning_refusal([record(REFUSAL)]) is True


@pytest.mark.parametrize("record", RECORDINGS)
def test_a_resolved_refusal_is_not_a_violation_however_it_was_recorded(record):
    assert unresolved_warning_refusal([record(REFUSAL), record(SUCCESS)]) is False


@pytest.mark.parametrize("record", RECORDINGS)
def test_a_stale_justification_round_trip_is_not_a_violation(record):
    """The agent sent a warningId matching no introduced warning and correctly
    re-called without justifications. The engine answers with the SAME reason,
    so only the marker tells them apart -- and the remnant has to carry it, or
    the exclusion reverts itself on every log older than 14 days."""
    assert unresolved_warning_refusal([record(STALE)]) is False


@pytest.mark.parametrize("record", RECORDINGS)
def test_a_no_project_answer_cannot_resolve_a_refusal(record):
    """It deliberately carries no `is_error`, so an `is_error` test counts a
    write that never happened as the success that cleared the gate."""
    assert unresolved_warning_refusal([record(REFUSAL), record(NO_PROJECT)]) is True


def test_the_remnant_keeps_both_reasons_when_an_answer_carries_both():
    """`reason` was assigned twice in sequence, so one overwrote the other.
    Losing `no_project` loses in the dangerous direction: `did_not_land` uses it
    to SKIP a call, so the loss manufactures a violation rather than missing
    one."""
    both = json.dumps({"ok": False, "reason": "no_project", "detail": "unjustified_warnings"})
    remnant = replay_remnant(both) or ""
    assert "no_project" in remnant
    assert "unjustified_warnings" in remnant


def test_the_remnant_is_not_emitted_for_an_ordinary_answer():
    """The accept direction: stripping must stay lossy for everything that is
    not one of these markers, or retention stops reclaiming anything."""
    assert replay_remnant(json.dumps({"results": []})) is None
