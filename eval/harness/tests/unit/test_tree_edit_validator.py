"""Direct tests for the two tree-edit validators added in the #1657 deep dive
(place-resolution provenance, post-edit check-warnings).

Same reason as test_search_full_text_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
make harness-test, and these checks would otherwise run their real
pass/fail set exactly once, inside a paid make eval-skill run. Firing and
passing cases are drawn from committed run logs wherever one exists
(traceable back to the exact test/run that produced or avoided the defect).
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_tree_edit import (  # noqa: E402
    test_new_standard_place_traces_to_a_real_resolution as check_place_resolution,
    test_check_warnings_runs_after_any_tree_write as check_check_warnings,
)


def place_search_call(place_name, standard_place, tool="mcp__genealogy__place_search"):
    return {
        "tool": tool,
        "args": {"placeName": place_name},
        "response": {"results": [{"standardPlace": standard_place, "type": "Country"}]},
    }


# --- test_new_standard_place_traces_to_a_real_resolution ----------------
# Deep dive #1657 finding E: ut_tree_edit_006, run v1_2026-07-22_13-43-35
# (and three siblings) -- F6 (Birth, ~1849, Ireland) landed on I4 with
# standard_place: "Ireland" and zero place_search calls anywhere in the
# run. I3 own source fact (F4) carried no standard_place to copy from.

I3_I4_BEFORE = {
    "persons": [
        {
            "id": "I3",
            "gender": "Male",
            "names": [{"id": "N3", "preferred": True, "given": "James", "surname": "Flynn", "type": "BirthName"}],
            "facts": [
                {
                    "id": "F4",
                    "type": "Birth",
                    "primary": True,
                    "date": "~1849",
                    "place": "Ireland",
                    "sources": [{"ref": "S5", "page": "1880 U.S. Census, Schuylkill Co., dwelling 142"}],
                }
            ],
        },
        {
            "id": "I4",
            "gender": "Male",
            "names": [{"id": "N4", "preferred": True, "given": "James Patrick", "surname": "Flynn", "type": "BirthName"}],
            "facts": [
                {
                    "id": "F5",
                    "type": "Birth",
                    "primary": True,
                    "date": "~1848",
                    "place": "Branch Township, Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S6", "page": "St. Patrick RC Church baptismal register, 22 Mar 1848, entry 47"}],
                }
            ],
            "ark": "https://familysearch.org/ark:/61903/4:1:KWCJ-JAM7",
        },
    ],
    "relationships": [],
}


def _after_with_f6(standard_place="Ireland"):
    import copy

    after = copy.deepcopy(I3_I4_BEFORE)
    f6 = {
        "id": "F6",
        "type": "Birth",
        "date": "~1849",
        "place": "Ireland",
        "sources": [{"ref": "S5", "page": "1880 U.S. Census, Schuylkill Co., dwelling 142"}],
    }
    if standard_place is not None:
        f6["standard_place"] = standard_place
    after["persons"][1]["facts"].append(f6)
    return after


def test_place_resolution_fires_on_the_ut_006_shape_with_no_place_search_call():
    before_state = {"tree_gedcomx_json": I3_I4_BEFORE}
    after_state = {"tree_gedcomx_json": _after_with_f6()}
    with pytest.raises(AssertionError) as e:
        check_place_resolution(before_state, after_state, [])
    assert "Ireland" in str(e.value)


def test_place_resolution_passes_when_a_real_place_search_call_backs_it():
    before_state = {"tree_gedcomx_json": I3_I4_BEFORE}
    after_state = {"tree_gedcomx_json": _after_with_f6()}
    tool_calls = [place_search_call("Ireland", "Ireland")]
    check_place_resolution(before_state, after_state, tool_calls)


def test_place_resolution_passes_when_copied_verbatim_from_an_existing_fact():
    """A standard_place already resolved elsewhere in the tree may be reused
    with no fresh call -- places-guidance.md says the converter-resolved
    value may be copied when the source record already carries one.
    Simulated here by seeding an already-resolved Ireland fact on I3 before
    the edit."""
    import copy

    before = copy.deepcopy(I3_I4_BEFORE)
    before["persons"][0]["facts"][0]["standard_place"] = "Ireland"
    before_state = {"tree_gedcomx_json": before}
    after_state = {"tree_gedcomx_json": _after_with_f6()}
    check_place_resolution(before_state, after_state, [])


def test_place_resolution_skips_when_no_new_standard_place_is_written():
    before_state = {"tree_gedcomx_json": I3_I4_BEFORE}
    after_state = {"tree_gedcomx_json": _after_with_f6(standard_place=None)}
    # No new standard_place at all (F6 omits it) -- nothing to trace, passes.
    check_place_resolution(before_state, after_state, [])


def test_place_resolution_skips_when_tree_state_missing():
    with pytest.raises(pytest.skip.Exception):
        check_place_resolution({}, {}, [])


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
