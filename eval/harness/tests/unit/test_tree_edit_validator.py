"""Direct tests for the tree-edit warning-gate validator (issue #2840 PR 2).

Replaces the old check-warnings hand-back tests. The engine gate now refuses
tree writes that introduce unjustified warnings, so the validator checks that
no writer call returned ``unjustified_warnings`` without a subsequent
successful re-call.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_tree_edit import (  # noqa: E402
    test_no_unjustified_warning_write as check_warning_gate,
)


F2_BEFORE = {
    "persons": [
        {
            "id": "I1",
            "gender": "Male",
            "names": [{"id": "N1", "preferred": True, "given": "Patrick", "surname": "Flynn", "type": "BirthName"}],
            "facts": [
                {"id": "F1", "type": "Birth", "primary": True, "date": "~1845", "place": "Ireland",
                 "sources": [{"ref": "S1", "page": "1850 Census, Schuylkill Co., dwelling 84"}]},
                {"id": "F2", "type": "Death", "date": "1908-03-21", "place": "Schuylkill County, Pennsylvania",
                 "sources": [{"ref": "S3", "page": "Death cert. no. 4521"}]},
            ],
        }
    ]
}


def _f2_corrected():
    import copy

    after = copy.deepcopy(F2_BEFORE)
    after["persons"][0]["facts"][1]["date"] = "1908-03-12"
    return after


TEST = {"skill": "tree-edit", "tags": ["tree-edit"]}


def _call(tool, response_summary="", is_error=False):
    return {
        "tool": f"mcp__genealogy__{tool}",
        "args": {},
        "response_summary": response_summary,
        "is_error": is_error,
    }


def test_passes_when_writer_succeeds_with_no_warnings():
    before = {"tree_gedcomx_json": F2_BEFORE}
    after = {"tree_gedcomx_json": _f2_corrected()}
    calls = [_call("tree_edit", '{"ok": true, "filesWritten": ["tree.gedcomx.json"]}')]
    check_warning_gate(before, after, calls, TEST)


def test_passes_when_refusal_is_followed_by_successful_retry():
    before = {"tree_gedcomx_json": F2_BEFORE}
    after = {"tree_gedcomx_json": _f2_corrected()}
    calls = [
        _call("tree_edit", '{"ok": false, "reason": "unjustified_warnings", "warnings": []}'),
        _call("tree_edit", '{"ok": true, "filesWritten": ["tree.gedcomx.json"]}'),
    ]
    check_warning_gate(before, after, calls, TEST)


def test_fails_when_only_unjustified_warnings_refusals():
    before = {"tree_gedcomx_json": F2_BEFORE}
    after = {"tree_gedcomx_json": _f2_corrected()}
    calls = [
        _call("tree_edit", '{"ok": false, "reason": "unjustified_warnings", "warnings": []}'),
    ]
    with pytest.raises(AssertionError, match="unjustified_warnings"):
        check_warning_gate(before, after, calls, TEST)


def test_skips_when_tree_unchanged():
    before = {"tree_gedcomx_json": F2_BEFORE}
    after = {"tree_gedcomx_json": F2_BEFORE}
    calls = []
    with pytest.raises(pytest.skip.Exception):
        check_warning_gate(before, after, calls, TEST)


def test_skips_when_tree_state_missing():
    with pytest.raises(pytest.skip.Exception):
        check_warning_gate({}, {}, [], TEST)


def test_passes_when_no_writer_calls_at_all():
    """Tree changed but no writer tool call seen — not this validator's job."""
    before = {"tree_gedcomx_json": F2_BEFORE}
    after = {"tree_gedcomx_json": _f2_corrected()}
    calls = [_call("person_warnings", '{"warnings": []}')]
    check_warning_gate(before, after, calls, TEST)
