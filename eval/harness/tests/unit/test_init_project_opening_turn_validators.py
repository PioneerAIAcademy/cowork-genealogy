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
)


OBJECTIVE_TAGGED = {"tags": ["objective-default"]}
UNTAGGED = {"tags": []}
PROFILE_TAGGED = {"tags": ["opening-turn-all-defaults"]}


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


def test_experience_default_present_passes():
    check_profile(_research({"experience_level": "intermediate"}), PROFILE_TAGGED)


def test_absent_subscriptions_passes():
    """The site-access question was dropped on 2026-08-31, so the field is left
    absent rather than defaulted. This is the shape the validator must accept —
    it is the whole point of the ruling, not an omission."""
    check_profile(_research({"experience_level": "intermediate"}), PROFILE_TAGGED)


def test_absent_profile_fails():
    with pytest.raises(AssertionError, match="researcher_profile is absent"):
        check_profile(_research(None), PROFILE_TAGGED)


def test_wrong_experience_level_fails():
    with pytest.raises(AssertionError, match="experience_level"):
        check_profile(
            _research({"experience_level": "novice"}),
            PROFILE_TAGGED,
        )


def test_volunteered_subscriptions_do_not_fail():
    """A researcher can still volunteer access and it can still be recorded — the
    ruling dropped the question, not the field. The validator must not reject a
    profile that carries one."""
    check_profile(
        _research({"experience_level": "intermediate", "subscriptions": ["Ancestry"]}),
        PROFILE_TAGGED,
    )


def test_defaulted_none_subscriptions_fails():
    """The regression guard. `["none"]` is the pre-2026-08-31 default: it asserts
    the researcher told us they have nothing, the opposite of what the ruling now
    assumes. Nothing else catches a reintroduction — the value is schema-valid,
    so `validate_research_schema` passes it happily."""
    with pytest.raises(AssertionError, match="subscriptions"):
        check_profile(
            _research({"experience_level": "intermediate", "subscriptions": ["none"]}),
            PROFILE_TAGGED,
        )


def test_defaulted_empty_subscriptions_fails():
    """The same defect wearing a different shape, and equally schema-valid."""
    with pytest.raises(AssertionError, match="subscriptions"):
        check_profile(
            _research({"experience_level": "intermediate", "subscriptions": []}),
            PROFILE_TAGGED,
        )
