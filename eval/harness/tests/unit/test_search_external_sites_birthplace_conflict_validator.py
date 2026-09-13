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

`_expect_fires` / `_expect_passes` below exist because a bare
`with pytest.raises(AssertionError, ...)` has a silent failure mode: if the
validator raises `pytest.skip.Exception` instead of `AssertionError` (e.g. a
broken gate that now over-matches and skips a case that should have fired),
`pytest.raises(AssertionError)` does not catch it — it propagates out of THIS
test function uncaught, and pytest's own runner reports an uncaught `Skipped`
as the *calling test being skipped*, not failed. A skip reads as green in any
summary that counts passed+skipped as "nothing broke," so nine independent
mutations of the validator's five skip gates were run against the previous
version of this file and only two were caught — the other seven silently
turned a "must fire" or "must pass" assertion into a skip (issue #1980
review, round 2). Both helpers convert an unexpected `Skipped` into an
explicit `pytest.fail(...)`, which cannot be mistaken for a pass.
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


def _states():
    return {"research_json": _RESEARCH}, {"research_json": _RESEARCH}


def _tool_calls(birth_place=None, *, site="myheritage"):
    """One `build_external_search_url` call, with `attributes.birthPlace`
    set to `birth_place` — or omitted entirely when `birth_place is None`,
    matching how a real call that never filled the field looks (no key, not
    a null value)."""
    attributes = {"givenName": "Patrick", "surname": "Flynn"}
    if birth_place is not None:
        attributes["birthPlace"] = birth_place
    return [
        {
            "tool": "mcp__genealogy__build_external_search_url",
            "args": {"site": site, "attributes": attributes},
        }
    ]


def _expect_fires(tool_calls, test, match, states=None):
    before, after = states or _states()
    try:
        _check(before, after, tool_calls, test)
    except pytest.skip.Exception:
        pytest.fail(
            f"expected AssertionError (match={match!r}), but the validator "
            "skipped instead — one of its skip gates over-matched"
        )
    except AssertionError as e:
        assert match in str(e), f"AssertionError message doesn't contain {match!r}: {e}"
        return
    pytest.fail(f"expected AssertionError (match={match!r}), but the validator raised nothing")


def _expect_passes(tool_calls, test, states=None):
    before, after = states or _states()
    try:
        _check(before, after, tool_calls, test)
    except pytest.skip.Exception:
        pytest.fail(
            "expected the validator to run and pass, but it skipped instead "
            "— one of its skip gates over-matched"
        )
    # An unexpected AssertionError propagates naturally and fails this test —
    # no special handling needed for that direction.


def test_fires_on_the_real_captured_defect():
    """The exact argument a live run produced (issue #1980 review) before this fix."""
    _expect_fires(
        _tool_calls("Pennsylvania"),
        {"type": "positive"},
        "attributes.birthPlace='Pennsylvania'",
    )


def test_fires_when_the_rejected_value_is_reformatted_with_extra_jurisdiction():
    """A place-resolution tool commonly returns a broader-context string
    ("Pennsylvania, United States") for what the fixture's own assertion
    records as the bare place name ("Pennsylvania") — the same rejected fact,
    differently formatted. This is the exact argument a live run produced
    (issue #1980 review round 3, 2026-09-11): the original exact-string check
    missed it, and only the LLM judge caught it."""
    _expect_fires(
        _tool_calls("Pennsylvania, United States"),
        {"type": "positive"},
        "attributes.birthPlace='Pennsylvania, United States'",
    )


def test_passes_when_the_preferred_value_is_encoded():
    _expect_passes(_tool_calls("Ireland"), {"type": "positive"})


def test_passes_when_the_field_is_omitted():
    _expect_passes(_tool_calls(None), {"type": "positive"})


def test_does_not_false_positive_on_a_different_place_sharing_a_leading_segment():
    """A rejected value that already carries its own disambiguating context
    ("Paris, France") must not collide with a different, correctly-encoded
    place that merely shares a leading token ("Paris, Texas, United States")
    — common in genealogy for American towns named after Old World cities
    (Paris, Dublin, Rome, Athens, Berlin, Vienna). A version of this check
    that compared only the first comma-segment on both sides flagged this
    correct answer as if it had encoded the rejected fact (code-review
    finding, 2026-09-13) — the exact false positive the fix for the
    reformatted-value case (above) introduced."""
    research = dict(_RESEARCH)
    research["conflicts"] = [{
        "id": "c_synthetic",
        "conflict_type": "fact",
        "disputed_attribute": "birthplace",
        "status": "resolved",
        "preferred_assertion_id": "a_synthetic_preferred",
        "competing_assertion_ids": ["a_synthetic_preferred", "a_synthetic_rejected"],
    }]
    research["assertions"] = list(_RESEARCH["assertions"]) + [
        {"id": "a_synthetic_preferred", "place": "Paris, Texas, United States"},
        {"id": "a_synthetic_rejected", "place": "Paris, France"},
    ]
    states = ({"research_json": research}, {"research_json": research})
    _expect_passes(_tool_calls("Paris, Texas, United States"), {"type": "positive"}, states=states)


def test_does_not_false_positive_on_a_legitimate_residence_place():
    """`residencePlace` ("Schuylkill County, Pennsylvania") legitimately
    contains the rejected birthplace value as a substring — reading the
    structured `attributes.birthPlace` argument directly (not the rendered
    URL string) cannot confuse the two fields regardless."""
    calls = _tool_calls("Ireland", site="ancestry")
    calls[0]["args"]["attributes"]["residencePlace"] = "Schuylkill County, Pennsylvania"
    _expect_passes(calls, {"type": "positive"})


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

    _expect_passes(_tool_calls("Ireland"), {"type": "positive"})


@pytest.mark.parametrize("site", ["ancestry", "findmypast", "findagrave", "newspapers"])
def test_fires_on_any_site_regardless_of_its_own_url_parameter_name(site):
    """Reading `attributes.birthPlace` directly needs no per-site knowledge of
    which URL query parameter that site templates it into — unlike the URL-
    string approach this replaced, which needed a per-site parameter-name
    table and had no entry for every site at all (e.g. `newspapers`, which
    has no birthplace slot in its own URL)."""
    _expect_fires(
        _tool_calls("Pennsylvania", site=site),
        {"type": "positive"},
        "attributes.birthPlace='Pennsylvania'",
    )


def test_skips_a_non_positive_test():
    with pytest.raises(pytest.skip.Exception):
        _check(*_states(), _tool_calls("Pennsylvania"), {"type": "negative"})


def test_skips_when_the_scenario_has_no_resolved_birthplace_conflict():
    research = dict(_RESEARCH)
    research["conflicts"] = []
    before = {"research_json": research}
    after = {"research_json": research}
    with pytest.raises(pytest.skip.Exception):
        _check(before, after, _tool_calls("Pennsylvania"), {"type": "positive"})


def test_skips_when_no_build_external_search_url_call_was_made():
    with pytest.raises(pytest.skip.Exception):
        _check(*_states(), [], {"type": "positive"})
