"""Direct tests for the tree-edit check-warnings validator added in the #1657
deep dive.

Same reason as test_search_full_text_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
make harness-test, and this check would otherwise run its real pass/fail
set exactly once, inside a paid make eval-skill run. Firing and passing
cases are drawn from committed run logs (traceable back to the exact
test/run that produced or avoided the defect).

A second validator (place-resolution provenance) was authored alongside
this one and retracted the same day: a live make eval-skill run showed it
false-positiving on tree_edit/tree_correct's own internal auto-resolution
(maybeResolvePlace in tree-edit.ts, using the same resolveStandardPlace
place_search calls) on 3 of 5 edit tests -- every flagged value was
correctly resolved by the tool itself, with no skill-visible place_search
call needed at all. See the #1657 comment correction for the full account.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_tree_edit import (  # noqa: E402
    test_check_warnings_runs_after_any_tree_write as check_check_warnings,
)


# --- test_check_warnings_runs_after_any_tree_write ----------------------
# Deep dive #1657 finding F: ut_tree_edit_008, run v1_2026-07-30_18-18-04
# -- F2 date corrected 1908-03-21 -> 1908-03-12, skills_invoked ==
# ["tree-edit"], check-warnings never invoked. Passing counterpart:
# ut_tree_edit_010, run v1_2026-07-28_13-02-56 -- Mary (I5) created,
# skills_invoked == ["tree-edit", "check-warnings"].

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


def test_check_warnings_fires_on_the_ut_008_shape_with_no_check_warnings_call():
    before_state = {"tree_gedcomx_json": F2_BEFORE}
    after_state = {"tree_gedcomx_json": _f2_corrected()}
    with pytest.raises(AssertionError) as e:
        check_check_warnings(before_state, after_state, ["tree-edit"])
    assert "check-warnings" in str(e.value)


def test_check_warnings_passes_when_invoked_after_the_edit():
    before_state = {"tree_gedcomx_json": F2_BEFORE}
    after_state = {"tree_gedcomx_json": _f2_corrected()}
    check_check_warnings(before_state, after_state, ["tree-edit", "check-warnings"])


def test_check_warnings_skips_when_the_tree_did_not_change():
    """The ut_tree_edit_001/002 no-op shape: nothing to validate, regardless
    of what skills_invoked says."""
    before_state = {"tree_gedcomx_json": F2_BEFORE}
    after_state = {"tree_gedcomx_json": F2_BEFORE}
    with pytest.raises(pytest.skip.Exception):
        check_check_warnings(before_state, after_state, [])


def test_check_warnings_skips_when_tree_state_missing():
    with pytest.raises(pytest.skip.Exception):
        check_check_warnings({}, {}, ["tree-edit"])
