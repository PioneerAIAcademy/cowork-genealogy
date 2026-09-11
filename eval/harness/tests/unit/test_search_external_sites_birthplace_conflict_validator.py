"""Direct tests for `test_resolved_birthplace_conflict_rejected_value_not_encoded`
(issue #1980 review finding).

Same reason as `test_conflict_resolution_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and the validator's real pass/fail set would otherwise
appear only inside a paid per-skill run. Loaded unrewritten via
`spec_from_file_location` for the same reason that file documents — a plain
`import` under pytest gets its `AssertionError` message mutated by pytest's
assertion-rewrite import hook, which would make these tests grade a
pytest-generated explanation rather than the exact string the harness (and a
genealogist reading a failed run) actually sees.

The fixture cases replay the real `mid-research-flynn` scenario, not a
synthetic conflict — its `conflicts[]` c_001 has the exact shape that broke a
first draft of this validator: `competing_assertion_ids` names three
assertions, and two of them (a_002, a_009) independently agree with the
*preferred* value ("Ireland"); only the third (a_012) actually disagrees
("Pennsylvania"). A version of this validator that read "not the preferred
id" as "rejected" flagged a_009's own agreeing "Ireland" as a violation. Using
the real fixture is what caught that before it shipped.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
_REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(_VALIDATORS_DIR))


def _load_validator_unrewritten():
    path = _VALIDATORS_DIR / "test_search_external_sites.py"
    spec = importlib.util.spec_from_file_location(
        "_ses_validator_unrewritten", path
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_VALIDATOR = _load_validator_unrewritten()
_check = _VALIDATOR.test_resolved_birthplace_conflict_rejected_value_not_encoded

_RESEARCH = json.loads(
    (_REPO_ROOT / "eval/fixtures/scenarios/mid-research-flynn/research.json").read_text(
        encoding="utf-8"
    )
)


def _states(url: str, site: str = "myheritage"):
    before_state = {"research_json": _RESEARCH}
    after_research = dict(_RESEARCH)
    after_research["log"] = list(_RESEARCH.get("log", [])) + [
        {
            "id": "log_999",
            "tool": "external_site",
            "outcome": "partial",
            "external_site": {"site": site, "url_generated": url, "capture_received": False},
        }
    ]
    return before_state, {"research_json": after_research}


def test_fires_on_the_real_captured_defect():
    """The exact URL a live run produced (issue #1980 review) before this fix."""
    before, after = _states(
        "https://www.myheritage.com/research?action=query&first=Patrick&last=Flynn"
        "&birth_year=1845&birth_place=Pennsylvania"
    )
    with pytest.raises(AssertionError, match=r"birth_place='Pennsylvania'"):
        _check(before, after, {"type": "positive"})


def test_passes_when_the_preferred_value_is_encoded():
    before, after = _states(
        "https://www.myheritage.com/research?action=query&first=Patrick&last=Flynn"
        "&birth_year=1845&birth_place=Ireland"
    )
    _check(before, after, {"type": "positive"})  # must not raise


def test_passes_when_the_field_is_omitted():
    before, after = _states(
        "https://www.myheritage.com/research?action=query&first=Patrick&last=Flynn&birth_year=1845"
    )
    _check(before, after, {"type": "positive"})  # must not raise


def test_does_not_false_positive_on_a_legitimate_residence_place():
    """`residencePlace` ("Schuylkill County, Pennsylvania") legitimately
    contains the rejected birthplace value as a substring — a whole-URL
    substring search would wrongly flag this."""
    before, after = _states(
        "https://www.ancestry.com/search/?name=Patrick_Flynn&birth=1845&birthplace=Ireland"
        "&residence=1870_Schuylkill+County%2C+Pennsylvania",
        site="ancestry",
    )
    _check(before, after, {"type": "positive"})  # must not raise


def test_does_not_flag_a_competing_assertion_that_agrees_with_the_preferred_value():
    """a_009 is a `competing_assertion_id` on c_001 but is not itself the
    disagreeing assertion — it independently says "Ireland" too, the same as
    the preferred a_002. Only a_012 ("Pennsylvania") actually disagrees."""
    conflict = next(c for c in _RESEARCH["conflicts"] if c["id"] == "c_001")
    assert conflict["competing_assertion_ids"] == ["a_002", "a_009", "a_012"]
    assertions_by_id = {a["id"]: a for a in _RESEARCH["assertions"]}
    assert assertions_by_id["a_009"]["place"] == "Ireland"
    assert assertions_by_id["a_002"]["place"] == "Ireland"
    assert assertions_by_id["a_012"]["place"] == "Pennsylvania"

    before, after = _states(
        "https://www.myheritage.com/research?action=query&first=Patrick&last=Flynn&birth_place=Ireland"
    )
    _check(before, after, {"type": "positive"})  # must not raise


@pytest.mark.parametrize(
    "site,param",
    [("ancestry", "birthplace"), ("findmypast", "keywordsplace")],
)
def test_fires_on_other_sites_own_birthplace_parameter(site, param):
    before, after = _states(f"https://example.com/search?{param}=Pennsylvania", site=site)
    with pytest.raises(AssertionError, match=rf"{param}='Pennsylvania'"):
        _check(before, after, {"type": "positive"})


def test_skips_a_non_positive_test():
    before, after = _states(
        "https://www.myheritage.com/research?action=query&birth_place=Pennsylvania"
    )
    with pytest.raises(pytest.skip.Exception):
        _check(before, after, {"type": "negative"})


def test_skips_when_the_scenario_has_no_resolved_birthplace_conflict():
    research = dict(_RESEARCH)
    research["conflicts"] = []
    before = {"research_json": research}
    after_research = dict(research)
    after_research["log"] = list(research.get("log", [])) + [
        {
            "id": "log_999",
            "tool": "external_site",
            "outcome": "partial",
            "external_site": {
                "site": "myheritage",
                "url_generated": "https://www.myheritage.com/research?birth_place=Pennsylvania",
                "capture_received": False,
            },
        }
    ]
    after = {"research_json": after_research}
    with pytest.raises(pytest.skip.Exception):
        _check(before, after, {"type": "positive"})
