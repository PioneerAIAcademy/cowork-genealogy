"""Direct tests for the init-project opening-turn default validators.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test` and its real pass/fail set appears only inside a paid
per-skill run. Flagged in the #1735 review as a coverage gap for the two
validators added for issue #1510 (`test_objective_default_verbatim`,
`test_profile_defaults_when_all_default`) — mutation-tested there (9/9
fired), so this closes the gap rather than proving the checks work for
the first time.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_init_project import (  # noqa: E402
    _DEFAULT_OBJECTIVE,
    test_objective_default_verbatim as check_objective,
    test_profile_defaults_when_all_default as check_profile,
    test_volunteered_subscriptions_normalized as check_volunteered,
)


OBJECTIVE_TAGGED = {"tags": ["objective-default"]}
UNTAGGED = {"tags": []}
PROFILE_TAGGED = {"tags": ["opening-turn-all-defaults"]}
VOLUNTEERED_TAGGED = {"tags": ["volunteered-access"]}


# --- test_objective_default_verbatim ------------------------------------


def test_untagged_objective_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_objective({"research_json": {}}, UNTAGGED)


def test_verbatim_default_passes():
    after_state = {"research_json": {"project": {"objective": _DEFAULT_OBJECTIVE}}}
    check_objective(after_state, OBJECTIVE_TAGGED)


def test_a_paraphrase_fails():
    after_state = {
        "research_json": {
            "project": {"objective": "General research on this family."}
        }
    }
    with pytest.raises(AssertionError) as e:
        check_objective(after_state, OBJECTIVE_TAGGED)
    assert "verbatim" in str(e.value)


def test_a_hallucinated_specific_objective_fails():
    after_state = {
        "research_json": {"project": {"objective": "Trace migration from Ireland."}}
    }
    with pytest.raises(AssertionError):
        check_objective(after_state, OBJECTIVE_TAGGED)


def test_missing_research_json_fails():
    with pytest.raises(AssertionError, match="objective-default requires"):
        check_objective({"research_json": None}, OBJECTIVE_TAGGED)


# --- test_profile_defaults_when_all_default -----------------------------


def _research(profile=None):
    project = {"objective": _DEFAULT_OBJECTIVE}
    research = {"project": project}
    if profile is not None:
        research["researcher_profile"] = profile
    return {"research_json": research}


def test_untagged_profile_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_profile(_research(), UNTAGGED)


def test_fixed_level_passes():
    check_profile(_research({"experience_level": "novice"}), PROFILE_TAGGED)


def test_absent_subscriptions_passes():
    """The site-access question was dropped on 2026-08-31, so the field is left
    absent rather than defaulted. This is the shape the validator must accept —
    it is the whole point of the ruling, not an omission."""
    check_profile(_research({"experience_level": "novice"}), PROFILE_TAGGED)


def test_absent_profile_fails():
    with pytest.raises(AssertionError, match="researcher_profile is absent"):
        check_profile(_research(None), PROFILE_TAGGED)


def test_wrong_experience_level_fails():
    """A volunteered or mapped level is a defect now: the profile is fixed at
    `novice` and the question is never asked (lead ruling 2026-09-18)."""
    with pytest.raises(AssertionError, match="experience_level"):
        check_profile(
            _research({"experience_level": "intermediate"}),
            PROFILE_TAGGED,
        )


def test_volunteered_subscriptions_do_not_fail():
    """A researcher can still volunteer access and it can still be recorded — the
    ruling dropped the question, not the field. The validator must not reject a
    profile that carries one."""
    check_profile(
        _research({"experience_level": "novice", "subscriptions": ["Ancestry"]}),
        PROFILE_TAGGED,
    )


def test_defaulted_none_subscriptions_fails():
    """The regression guard. `["none"]` is the pre-2026-08-31 default: it asserts
    the researcher told us they have nothing, the opposite of what the ruling now
    assumes. Nothing else catches a reintroduction — the value is schema-valid,
    so `validate_research_schema` passes it happily."""
    with pytest.raises(AssertionError, match="subscriptions"):
        check_profile(
            _research({"experience_level": "novice", "subscriptions": ["none"]}),
            PROFILE_TAGGED,
        )


def test_defaulted_empty_subscriptions_fails():
    """The same defect wearing a different shape, and equally schema-valid."""
    with pytest.raises(AssertionError, match="subscriptions"):
        check_profile(
            _research({"experience_level": "novice", "subscriptions": []}),
            PROFILE_TAGGED,
        )


# --- test_volunteered_subscriptions_normalized --------------------------


def _vol_research(subscriptions):
    return {
        "research_json": {
            "project": {"objective": "Identify the parents of Patrick Flynn."},
            "researcher_profile": {
                "experience_level": "novice",
                "subscriptions": subscriptions,
            },
        }
    }


def test_untagged_volunteered_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_volunteered(_vol_research(["Ancestry", "LibraryAccess"]), UNTAGGED)


def test_normalized_set_passes():
    """The accept direction: the exact normalized set the scenario produces
    (Ancestry + the family history centre as LibraryAccess) must pass, in any
    order."""
    check_volunteered(_vol_research(["Ancestry", "LibraryAccess"]), VOLUNTEERED_TAGGED)
    check_volunteered(_vol_research(["LibraryAccess", "Ancestry"]), VOLUNTEERED_TAGGED)


def test_familysearch_stored_fails():
    """A bare FamilySearch account is the baseline, not an enum value — storing
    it verbatim is the exact defect this test's name calls out."""
    with pytest.raises(AssertionError, match="FamilySearch"):
        check_volunteered(
            _vol_research(["Ancestry", "LibraryAccess", "FamilySearch"]),
            VOLUNTEERED_TAGGED,
        )


def test_family_history_centre_flattened_to_other_fails():
    """The family history centre has its own enum value (LibraryAccess); mapping
    it to `other` loses that and must fail."""
    with pytest.raises(AssertionError, match="Ancestry|LibraryAccess|added or dropped"):
        check_volunteered(_vol_research(["Ancestry", "other"]), VOLUNTEERED_TAGGED)


def test_dropped_library_access_fails():
    """Dropping a volunteered route (only Ancestry survives) is a departure from
    the normalized set."""
    with pytest.raises(AssertionError, match="added or dropped"):
        check_volunteered(_vol_research(["Ancestry"]), VOLUNTEERED_TAGGED)


def test_absent_subscriptions_fails_when_volunteered():
    """The user volunteered access, so the field must be written — absence here is
    the opposite defect to the all-defaults case, where absence is correct."""
    with pytest.raises(AssertionError, match="must be written"):
        check_volunteered(_vol_research(None), VOLUNTEERED_TAGGED)


def test_missing_research_json_fails_volunteered():
    with pytest.raises(AssertionError, match="volunteered-access requires"):
        check_volunteered({"research_json": None}, VOLUNTEERED_TAGGED)
