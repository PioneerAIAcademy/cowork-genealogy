"""Direct tests for `test_narrative_edit_form_used` (issue #3542, lead 2c).

Nothing under `validators/` is collected by `make harness-test`, so without these
the validator's pass/fail set would appear only inside a paid per-skill run. Each
case shows it FIRES on a run that re-sends the narrative, uses no `edits`, or
saves the wrong text, ACCEPTS the compliant run (single-op or batched, stringified
or not), and STANDS DOWN on a test without the tag.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_proof_conclusion import (  # noqa: E402
    _EDIT_FORM_FROM,
    _EDIT_FORM_TO,
    test_narrative_edit_form_used as check,
)

from tests.unit.skip_blind import expect_fires, expect_passes  # noqa: E402

TAGGED = {"tags": ["narrative-edit-form"]}
# As long as ps_001's real narrative (3,542 characters), so an edit is the small part of it.
ORIGINAL = (
    "## C\nLike the 1850 census, " + _EDIT_FORM_FROM + ". Tail; relationships not stated.\n"
    + "The household is placed by name, age and birthplace. " * 60
)
EXPECTED = ORIGINAL.replace(_EDIT_FORM_FROM, _EDIT_FORM_TO)
EDIT = {"field": "narrative_markdown", "old": _EDIT_FORM_FROM, "new": _EDIT_FORM_TO}


def _state(narrative):
    return {"research_json": {"proof_summaries": [{"id": "ps_001", "narrative_markdown": narrative}]}}


def _call(args, tool="mcp__genealogy__research_append"):
    return {"tool": tool, "args": args}


def _single(**over):
    return {"section": "proof_summaries", "op": "update", "entryId": "ps_001", **over}


def test_accepts_a_single_op_edit():
    expect_passes(lambda: check(_state(ORIGINAL), _state(EXPECTED), [_call(_single(edits=[EDIT]))], TAGGED))


def test_accepts_a_batched_stringified_edit_under_another_prefix():
    ops = json.dumps([_single(edits=[EDIT])])
    calls = [_call({"ops": ops}, tool="mcp__remote-devices__Genealogy_Research__research_append")]
    expect_passes(lambda: check(_state(ORIGINAL), _state(EXPECTED), calls, TAGGED))


def test_accepts_a_refused_edit_retried_with_more_context():
    calls = [
        _call(_single(edits=[{**EDIT, "old": "relationship column"}])),
        _call(_single(edits=[EDIT])),
    ]
    expect_passes(lambda: check(_state(ORIGINAL), _state(EXPECTED), calls, TAGGED))


def test_fires_when_the_narrative_is_re_sent():
    calls = [_call(_single(fields={"narrative_markdown": EXPECTED}))]
    expect_fires(lambda: check(_state(ORIGINAL), _state(EXPECTED), calls, TAGGED), "re-sent the whole narrative")


def test_fires_when_the_narrative_is_re_sent_in_a_stringified_fields():
    calls = [_call(_single(edits=[EDIT])), _call(_single(fields=json.dumps({"narrative_markdown": EXPECTED})))]
    expect_fires(lambda: check(_state(ORIGINAL), _state(EXPECTED), calls, TAGGED), "re-sent the whole narrative")


def test_fires_when_a_retry_re_sends_after_an_edit():
    calls = [_call(_single(edits=[EDIT])), _call(_single(fields={"narrative_markdown": EXPECTED}))]
    expect_fires(lambda: check(_state(ORIGINAL), _state(EXPECTED), calls, TAGGED), "re-sent the whole narrative")


def test_fires_when_the_whole_narrative_is_sent_as_one_edit():
    whole = [{"field": "narrative_markdown", "old": ORIGINAL, "new": EXPECTED}]
    expect_fires(lambda: check(_state(ORIGINAL), _state(EXPECTED), [_call(_single(edits=whole))], TAGGED), "an edit names the sentence")


def test_fires_when_no_update_was_made():
    expect_fires(lambda: check(_state(ORIGINAL), _state(ORIGINAL), [], TAGGED), "no research_append update")


def test_fires_when_the_update_carried_no_edits():
    calls = [_call(_single(fields={"tier": "probable"}))]
    expect_fires(lambda: check(_state(ORIGINAL), _state(EXPECTED), calls, TAGGED), "carried `edits`")


def test_fires_when_the_saved_text_is_not_exactly_the_change():
    calls = [_call(_single(edits=[EDIT]))]
    expect_fires(
        lambda: check(_state(ORIGINAL), _state(EXPECTED + " extra"), calls, TAGGED),
        "not the original with exactly the requested change",
    )


def test_stands_down_without_the_tag():
    with pytest.raises(pytest.skip.Exception):
        check(_state(ORIGINAL), _state(ORIGINAL), [], {"tags": []})
