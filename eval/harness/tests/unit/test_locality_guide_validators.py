"""Direct tests for the locality-guide validators (issue #1886, deep dive #1664).

Same reason as `test_person_evidence_validators.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.
Each check is exercised so it FIRES on a bad state, ACCEPTS a legitimate
variant, and STANDS DOWN when not applicable.

Scope after PR #2579 review: VR1 checks only the two properties the shared
schema validator does not (source + four-section coverage); VR2 and VR3 were
dropped (VR2 was circular against project_context's read-back and duplicated
test_research_plan/provenance_report; VR3 is subsumed by VR4 and would only
false-fire — SKILL.md:82 makes volume_search a required Step-3 call and Step 4
derives every label from its result, so the only acceptance runs assigning a
label without a volume_search call are the two whose fixtures don't register
volume_search). VR4 gates that a records survey called both Step-3 searches.
"""

import sys
from copy import deepcopy
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise collect
# the imported validators as tests of this module and error on their
# harness-supplied fixtures. Same pattern as test_person_evidence_validators.py.
from test_locality_guide import (  # noqa: E402
    test_persisted_localities_entry_shape as check_shape,
    test_survey_run_calls_both_collections_and_volume_search as check_both_searches,
)


# --- helpers ------------------------------------------------------------


def _state(localities):
    return {
        "research_json": {"localities": localities} if localities is not None else {},
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,
        "files": {},
        "skill_frontmatter": {},
    }


def _entry(*, lid="loc_001", source="locality-guide",
           sections=("home", "getting_started", "online_records", "research_tips")):
    return {
        "id": lid,
        "place": "Pennsylvania, United States",
        "source": source,
        "created": "2026-09-15T00:00:00Z",
        "pages_read": [{"section": s, "found": True} for s in sections],
    }


def _call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args}


# --- VR1: test_persisted_localities_entry_shape (source + 4-section) -----


def test_shape_passes_on_a_valid_new_entry():
    check_shape(_state([]), _state([_entry()]))


def test_shape_fires_on_missing_wiki_section():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(
            sections=("home", "getting_started", "online_records"),
        )]))
    assert "missing wiki sections" in str(exc.value)
    assert "research_tips" in str(exc.value)


def test_shape_fires_on_wrong_source():
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([_entry(source="research-plan")]))
    assert "source" in str(exc.value)


def test_shape_stands_down_when_no_new_entry():
    with pytest.raises(pytest.skip.Exception):
        check_shape(_state([]), _state([]))


def test_shape_validates_only_the_new_entry_not_a_pre_existing_seed():
    """A seed entry present in both before and after is out of scope; only the
    entry this run wrote is checked. A wrong-source seed left unchanged must SKIP
    (nothing new written), while a new valid entry alongside it passes.

    The unchanged seed is a `deepcopy` in the after-state, not the same object:
    the harness parses before/after from separate JSON, so they hold value-equal
    but identity-distinct dicts. Reusing one object would let an identity check
    (`prior[eid] is not e`) pass here while over-reporting every unchanged entry
    in production — this mirrors the real shape so that mutation is caught."""
    seed = _entry(lid="loc_seed", source="research-plan")  # would fail VR1 if checked
    with pytest.raises(pytest.skip.Exception):
        check_shape(_state([seed]), _state([deepcopy(seed)]))  # unchanged seed → skip
    check_shape(_state([seed]), _state([deepcopy(seed), _entry(lid="loc_new")]))  # new → passes


def test_shape_checks_every_new_entry_not_just_the_first():
    """Two entries written in one run, the defective one SECOND. VR1's
    `for loc in written` must check both — truncating to `written[:1]` would
    validate only the first (valid) entry and skip the bad one, reading green."""
    good = _entry(lid="loc_a")
    bad = _entry(lid="loc_b", sections=("home", "getting_started", "online_records"))
    with pytest.raises(AssertionError) as exc:
        check_shape(_state([]), _state([good, bad]))
    assert "loc_b" in str(exc.value)
    assert "missing wiki sections" in str(exc.value)


def test_shape_fires_on_an_in_place_update_that_drops_a_section():
    """Exercises the `include_modified` diff branch: an entry rewritten in place
    (same id) that drops a wiki section must be caught, not skipped as a
    new-id-only diff would. A `skip` here is a FAILURE — reverting
    include_modified would return nothing and a plain `pytest.raises` would let
    that read green."""
    good = _entry(lid="loc_001")
    modified = _entry(lid="loc_001", sections=("home", "getting_started", "online_records"))
    try:
        check_shape(_state([good]), _state([modified]))
    except AssertionError as exc:
        assert "missing wiki sections" in str(exc)
    except pytest.skip.Exception:
        pytest.fail("VR1 skipped a modified same-id entry instead of validating it")
    else:
        pytest.fail("VR1 did not fire on a modified same-id entry")


# --- VR4: test_survey_run_calls_both_collections_and_volume_search ------


def test_both_searches_fires_when_only_collections_search_called():
    with pytest.raises(AssertionError) as exc:
        check_both_searches([_call("collections_search"), _call("wiki_place_page")])
    assert "volume_search" in str(exc.value)


def test_both_searches_fires_when_only_volume_search_called():
    with pytest.raises(AssertionError) as exc:
        check_both_searches([_call("volume_search")])
    assert "collections_search" in str(exc.value)


def test_both_searches_passes_when_both_called():
    check_both_searches([_call("collections_search"), _call("volume_search")])


def test_both_searches_skips_when_neither_called():
    """A run that searched neither is not a records survey (Q&A / wiki-only /
    decline). VR4 must SKIP — not record a bare-return pass on a run it never
    checked (review B7)."""
    with pytest.raises(pytest.skip.Exception):
        check_both_searches([_call("wiki_place_page"), _call("place_search")])
