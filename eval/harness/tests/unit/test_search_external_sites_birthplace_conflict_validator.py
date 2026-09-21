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

import copy
import json
import re
import sys
from pathlib import Path

import pytest

from harness.validator_runner import _import_validator_module
from tests.unit.skip_blind import expect_fires, expect_passes

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
_REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(_VALIDATORS_DIR))

_VALIDATOR = _import_validator_module(
    _VALIDATORS_DIR / "test_search_external_sites.py", "_ses_validator_unrewritten"
)
_check = _VALIDATOR.test_resolved_birthplace_conflict_rejected_value_not_encoded

_RESEARCH = json.loads(
    (_REPO_ROOT / "eval/fixtures/scenarios/mid-research-flynn/research.json").read_text(
        encoding="utf-8"
    )
)


def _states(*new_log_entries):
    """Identical before/after by default. With entries, the after side carries
    them as extra log[] entries — enough for `_new_log_entries`'s before/after-
    length comparison to see them as new. Takes more than one so a test can
    build the real two-entry step-4-then-step-6 shape, which is what tells a
    re-log apart from a fresh generation."""
    entries = [e for e in new_log_entries if e is not None]
    if not entries:
        return {"research_json": _RESEARCH}, {"research_json": _RESEARCH}
    before_log = list(_RESEARCH.get("log") or [])
    before = {"research_json": {**_RESEARCH, "log": before_log}}
    after = {"research_json": {**_RESEARCH, "log": before_log + entries}}
    return before, after


def _tool_calls(birth_place=None, *, site="myheritage", **extra_attributes):
    """One `build_external_search_url` call, with `attributes.birthPlace`
    set to `birth_place` — or omitted entirely when `birth_place is None`,
    matching how a real call that never filled the field looks (no key, not
    a null value). Any other attribute (`deathPlace=...`) rides along in
    `extra_attributes`."""
    attributes = {"givenName": "Patrick", "surname": "Flynn", **extra_attributes}
    if birth_place is not None:
        attributes["birthPlace"] = birth_place
    return [
        {
            "tool": "mcp__genealogy__build_external_search_url",
            "args": {"site": site, "attributes": attributes},
        }
    ]


# Thin wrappers over `tests/unit/skip_blind.py`, which owns the skip-proofing
# for every validator suite. These keep this file's calling convention — the
# validator's four arguments, with `states`/`check` overridable — while the
# shared helpers take a zero-argument callable so one pair fits every validator
# signature.
#
# `match` is escaped: the shared `expect_fires` matches with `re.search` (the
# semantics `pytest.raises(match=)` uses), and this file's call sites pass
# literal substrings. Without the escape a caller's `(` or `.` would silently
# change meaning — which is the drift that having two copies of these helpers
# invited in the first place.
def _expect_fires(tool_calls, test, match, states=None, check=None):
    before, after = states or _states()
    expect_fires(lambda: (check or _check)(before, after, tool_calls, test), re.escape(match))


def _expect_passes(tool_calls, test, states=None, check=None):
    before, after = states or _states()
    expect_passes(lambda: (check or _check)(before, after, tool_calls, test))


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


def _stringified_call(**attributes):
    """The same call a model makes when it serializes `attributes` as JSON text
    instead of an object — the mis-serialization `coerceJsonArg` recovers."""
    return [{
        "tool": "mcp__genealogy__build_external_search_url",
        "args": {"site": "myheritage", "attributes": json.dumps(
            {"givenName": "Patrick", "surname": "Flynn", **attributes})},
    }]


def test_fires_when_attributes_arrive_as_a_json_string():
    """The tool RECOVERS from this and builds the URL, so the rejected value
    reaches the site exactly as if the argument had been well-formed.

    Reading the argument raw made this check raise AttributeError rather than
    grade, and a crash in a `test_`-prefixed validator is not an observation:
    `validator_runner` builds the result without `reporting_only`, so it gates
    and the run scores `fail`, while the judge sees only an opaque validator
    name. The one shape this check could not survive was the one it exists to
    catch."""
    _expect_fires(
        _stringified_call(birthPlace="Pennsylvania"),
        {"type": "positive"},
        "attributes.birthPlace='Pennsylvania'",
    )


def test_passes_when_a_stringified_call_carries_the_preferred_value():
    """The other direction. Recovering the argument must not turn a correct
    call into a firing one, and a string that is not JSON at all reads as
    absent rather than inventing a value to judge."""
    _expect_passes(_stringified_call(birthPlace="Ireland"), {"type": "positive"})
    _expect_passes(
        [{
            "tool": "mcp__genealogy__build_external_search_url",
            "args": {"site": "myheritage", "attributes": "not json at all"},
        }],
        {"type": "positive"},
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


def test_fires_on_a_rejected_value_routed_through_deathplace():
    """On antenati and american_ancestors, `str(birthPlace) ?? str(deathPlace)`
    means deathPlace becomes the effective birthplace slot whenever birthPlace
    is absent — a rejected value reaching the URL through that fallback is the
    identical genealogical error, and review found this check missed it because
    it only ever read `attributes.birthPlace`.

    `archives_gov` used to belong on that list and no longer does: its place
    parameter was removed from the tool (spec §9, correction #4), so deathPlace
    reaches no slot there. `test_passes_a_rejected_deathplace_on_archives_gov`
    below pins that direction."""
    _expect_fires(
        _tool_calls(site="antenati", deathPlace="Pennsylvania"),
        {"type": "positive"},
        "attributes.deathPlace='Pennsylvania'",
    )


def test_passes_on_the_preferred_value_routed_through_deathplace():
    _expect_passes(_tool_calls(site="antenati", deathPlace="Ireland"), {"type": "positive"})


def test_does_not_crash_on_a_non_string_birthplace():
    """The tool itself accepts and templates whatever value it's given —
    `attributes.birthPlace: 1845` is real, live input, not a hypothetical.
    An unguarded `.split()` inside the place-matching helper turned that into
    an `AttributeError`, which `validator_runner` reports as `passed=False`
    with the exception text — indistinguishable in the outcome column from a
    genuine rejected-value violation. Must pass cleanly (skip the check for
    that value), not crash."""
    _expect_passes(_tool_calls(1845, site="antenati"), {"type": "positive"})


def test_does_not_crash_on_a_non_string_deathplace():
    _expect_passes(_tool_calls(site="antenati", deathPlace=1845), {"type": "positive"})


# --- test_no_hand_composed_external_site_url --------------------------

_HAND_COMPOSED_CHECK = _VALIDATOR.test_no_hand_composed_external_site_url


def test_fires_when_a_url_generation_entry_exists_with_no_tool_call():
    """Issue #1980 explicitly asks for a guard that checks the skill called
    the tool rather than hand-writing a URL — this fires exactly that case:
    a log entry recording a generated URL, but no build_external_search_url
    call anywhere in the run."""
    states = _states({
        "id": "log_999", "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "ancestry", "url_generated": "https://www.ancestry.com/search/?name=Flynn"},
    })
    # Through the skip-proof helper, not a bare `pytest.raises`: a gate that
    # over-matched would otherwise turn this into a silent SKIP at exit 0.
    _expect_fires([], {"type": "positive"}, "hand-composed", states=states, check=_HAND_COMPOSED_CHECK)


def test_passes_when_the_tool_was_actually_called():
    states = _states({
        "id": "log_999", "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "ancestry", "url_generated": "https://www.ancestry.com/search/?name=Flynn"},
    })
    _expect_passes(_tool_calls("Ireland"), {"type": "positive"}, states=states, check=_HAND_COMPOSED_CHECK)


def test_hand_composed_check_skips_when_no_url_generation_entry_this_run():
    with pytest.raises(pytest.skip.Exception):
        _HAND_COMPOSED_CHECK(*_states(), [], {"type": "positive"})


def test_hand_composed_check_skips_a_capture_entry_with_no_tool_call():
    """A capture-arrival entry re-logs the earlier URL without generating a
    new one this turn — not a "URL was hand-composed" situation, so no tool
    call is required and the check correctly has nothing to grade."""
    before, after = _states({
        "id": "log_999", "tool": "external_site", "outcome": "positive",
        "external_site": {"site": "ancestry", "url_generated": "https://www.ancestry.com/search/?name=Flynn", "capture_received": True},
    })
    with pytest.raises(pytest.skip.Exception):
        _HAND_COMPOSED_CHECK(before, after, [], {"type": "positive"})


def test_hand_composed_check_skips_an_error_entry_with_no_tool_call():
    """The no-access entry (`outcome: "error"`) asks whether to skip the
    site — also a re-log, not a fresh generation."""
    before, after = _states({
        "id": "log_999", "tool": "external_site", "outcome": "error",
        "external_site": {"site": "ancestry", "url_generated": "https://www.ancestry.com/search/?name=Flynn", "capture_received": False},
    })
    with pytest.raises(pytest.skip.Exception):
        _HAND_COMPOSED_CHECK(before, after, [], {"type": "positive"})


def test_hand_composed_check_skips_a_familysearch_web_entry_with_no_tool_call():
    """`familysearch_web` is the one `external_site` value the tool cannot
    build (SUPPORTED_SITES is a subset of the enum) — an ad-hoc URL logged
    under it never came from a tool call, so it is not hand-composed in the
    sense this check grades. Without the exclusion a legitimate entry fired
    the check the moment a fixture ever used the value."""
    before, after = _states({
        "id": "log_999", "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "familysearch_web", "url_generated": "https://glorecords.blm.gov/search/", "capture_received": False},
    })
    with pytest.raises(pytest.skip.Exception):
        _HAND_COMPOSED_CHECK(before, after, [], {"type": "positive"})


def test_hand_composed_check_does_not_crash_on_a_tool_call_with_no_tool_name():
    """`dict.get("tool", "")` substitutes the default only for an ABSENT key;
    a partial capture `{"tool": None}` returned `None` and `.split()` raised —
    reported by validator_runner as `passed=False`, indistinguishable from a
    real violation. Must grade normally: the real call is still present."""
    states = _states({
        "id": "log_999", "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "ancestry", "url_generated": "https://www.ancestry.com/search/?name=Flynn"},
    })
    calls = [{"tool": None, "args": {}}] + _tool_calls("Ireland")
    _expect_passes(calls, {"type": "positive"}, states=states, check=_HAND_COMPOSED_CHECK)


def test_hand_composed_check_skips_a_user_reported_nil_with_no_tool_call():
    """SKILL.md step 6: a nil the user reports without a capture re-logs the
    step-4 URL as `negative` / `capture_received: false`; rubric.md says the
    tool is not expected on that turn, so this check has nothing to grade.

    Built as the REAL two-entry shape — step 4's `partial` and step 6's
    `negative` carrying the same URL — because that is what makes the second
    one a re-log. The one-entry version this used to assert was not a shape a
    run produces: a lone `negative` entry carrying a URL nothing else in the
    log has is the autonomous-defer path, which does generate a URL, and
    excluding it by outcome was what let that path go ungraded (review
    round 5)."""
    url = "https://www.newspapers.com/search/?query=Flynn"
    before, after = _states(
        {
            "id": "log_998", "tool": "external_site", "outcome": "partial",
            "external_site": {"site": "newspapers", "url_generated": url, "capture_received": False},
        },
        {
            "id": "log_999", "tool": "external_site", "outcome": "negative",
            "external_site": {"site": "newspapers", "url_generated": url, "capture_received": False},
        },
    )
    # Step 4's own entry is still a fresh generation and is graded; the step-6
    # re-log adds no second grading target. With the tool called, that passes.
    _expect_passes(
        _tool_calls("Ireland"), {"type": "positive"}, states=(before, after), check=_HAND_COMPOSED_CHECK
    )
    # And the re-log alone, with step 4 already in the log before this run,
    # has nothing to grade at all.
    prior = {
        "id": "log_998", "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "newspapers", "url_generated": url, "capture_received": False},
    }
    before_log = list(_RESEARCH.get("log") or []) + [prior]
    relog_only = (
        {"research_json": {**_RESEARCH, "log": before_log}},
        {"research_json": {**_RESEARCH, "log": before_log + [{
            "id": "log_999", "tool": "external_site", "outcome": "negative",
            "external_site": {"site": "newspapers", "url_generated": url, "capture_received": False},
        }]}},
    )
    with pytest.raises(pytest.skip.Exception):
        _HAND_COMPOSED_CHECK(*relog_only, [], {"type": "positive"})


def test_hand_composed_check_grades_an_autonomous_defer_negative_entry():
    """The autonomous-defer path logs ONE `negative` entry carrying a freshly
    generated URL and presents it. Measured live on 2 of 13 positive tests in
    v1_2026-09-15_09-57-05.json (`_013`, `_008`), where the old
    `outcome != "partial"` gate skipped this check entirely. It must grade:
    pass when the tool was called, fire when it was not."""
    states = _states({
        "id": "log_999", "tool": "external_site", "outcome": "negative",
        "external_site": {"site": "ancestry", "url_generated": "https://www.ancestry.com/search/?name=Flynn", "capture_received": False},
    })
    _expect_passes(_tool_calls("Ireland"), {"type": "positive"}, states=states, check=_HAND_COMPOSED_CHECK)
    _expect_fires([], {"type": "positive"}, "hand-composed", states=states, check=_HAND_COMPOSED_CHECK)


# --- second review round: the conflict validator's own edge cases ------

def test_conflict_check_does_not_crash_on_a_tool_call_with_no_tool_name():
    """The same `{"tool": None}` partial capture the hand-composed check
    guards against; the real call beside it must still be graded normally."""
    calls = [{"tool": None, "args": {}}] + _tool_calls("Ireland")
    _expect_passes(calls, {"type": "positive"})


def test_passes_a_correct_death_place_on_a_site_with_no_birthplace_fallback():
    """Pennsylvania is c_001's REJECTED birthplace but the fixture's accepted
    death place. On findagrave nothing falls back to deathPlace, so a death
    search naming it is correct and must not read as the rejected birthplace."""
    _expect_passes(_tool_calls(site="findagrave", deathPlace="Pennsylvania"), {"type": "positive"})


def test_passes_death_place_when_birth_place_fills_the_fallback_slot():
    """On antenati deathPlace reaches `localita` only when birthPlace is absent."""
    _expect_passes(_tool_calls("Ireland", site="antenati", deathPlace="Pennsylvania"), {"type": "positive"})


def test_fires_on_a_finer_unit_prepended_to_the_rejected_place():
    """"Philadelphia, Pennsylvania" encodes the rejected "Pennsylvania" at a
    finer grain — the converse of a resolver appending broader context."""
    _expect_fires(
        _tool_calls("Philadelphia, Pennsylvania"),
        {"type": "positive"},
        "attributes.birthPlace='Philadelphia, Pennsylvania'",
    )


def test_fires_on_the_rejected_place_in_the_middle_of_a_resolved_string():
    """The shape place_search actually returns: a finer unit prepended AND the
    broader jurisdiction appended. Neither a leading- nor a trailing-segment
    match sees "Pennsylvania" here; only a contiguous window at any offset does."""
    _expect_fires(
        _tool_calls("Philadelphia, Pennsylvania, United States"),
        {"type": "positive"},
        "attributes.birthPlace='Philadelphia, Pennsylvania, United States'",
    )


def test_fires_on_findmypast_death_place_reaching_its_single_place_field():
    """FindMyPast has one place field, `keywordsplace`, filled birth-first and
    then from marriage/death/residence — so a rejected birthplace passed as
    deathPlace ships in the site's only place field (round-4 B2)."""
    _expect_fires(
        _tool_calls(site="findmypast", deathPlace="Pennsylvania"),
        {"type": "positive"},
        "attributes.deathPlace='Pennsylvania'",
    )


def test_fires_on_findmypast_marriage_and_residence_places_too():
    _expect_fires(
        _tool_calls(site="findmypast", marriagePlace="Pennsylvania"),
        {"type": "positive"},
        "attributes.marriagePlace='Pennsylvania'",
    )
    _expect_fires(
        _tool_calls(site="findmypast", residencePlace="Pennsylvania"),
        {"type": "positive"},
        "attributes.residencePlace='Pennsylvania'",
    )


def test_passes_findmypast_death_place_when_birth_place_fills_the_slot():
    _expect_passes(
        _tool_calls("Ireland", site="findmypast", deathPlace="Pennsylvania"),
        {"type": "positive"},
    )


@pytest.mark.parametrize("site,field", [
    ("findmypast", "marriagePlace"),
    ("findmypast", "residencePlace"),
    ("findmypast", "deathPlace"),
    ("antenati", "deathPlace"),
    ("american_ancestors", "deathPlace"),
])
def test_passes_an_accepted_place_through_a_fallback_field(site, field):
    """The scenario's accepted death and residence places are all "Schuylkill
    County, Pennsylvania", which CONTAINS the rejected birthplace
    "Pennsylvania" — so without the accepted-place exemption in
    `_effective_place_field`, a legitimate marriage, death or residence search
    naming its own correct place is flagged on every fallback site.

    `tests/tools/build-external-search-url.test.ts` pins that exact FindMyPast
    call as CORRECT ("lets a FindMyPast marriage search name its place through
    keywordsplace"), so the two halves of this PR contradicted each other until
    the exemption landed.

    This is the test the exemption was missing: the pre-existing
    `test_does_not_false_positive_on_a_legitimate_residence_place` pins
    `site="ancestry"` WITH a birthPlace, so it never reaches the fallback
    branch, and deleting the whole exemption left the suite green at exit 0."""
    _expect_passes(_tool_calls(site=site, **{field: "Schuylkill County, Pennsylvania"}), {"type": "positive"})


def test_passes_a_rejected_deathplace_on_archives_gov():
    """archives_gov reads NO place attribute since the tool dropped
    `geographicReference` (spec §9, correction #4) — the real tool reports
    `'deathPlace' is not used by archives_gov` and builds a URL from
    personOrOrg/q alone. So a death place there cannot carry a rejected
    birthplace into any URL, and flagging it fails a legitimate call.

    This is the test that was missing when `_PLACE_SLOT_CHAIN` still listed
    archives_gov: the table is a hand-maintained mirror of the tool's own
    parameter tables, the TypeScript side guards its copy with a recording
    Proxy and nothing guards this one, and a blind adversarial pass caught the
    drift after two commits had gone by."""
    _expect_passes(
        _tool_calls(site="archives_gov", deathPlace="Pennsylvania"),
        {"type": "positive"},
    )
    # The sites that DO still fall back are unaffected.
    _expect_fires(
        _tool_calls(site="antenati", deathPlace="Pennsylvania"),
        {"type": "positive"},
        "attributes.deathPlace='Pennsylvania'",
    )


def test_the_accepted_place_exemption_never_reaches_birthplace():
    """The other direction, so the exemption cannot be widened silently:
    `birthPlace` is judged whatever its value, because naming a place there IS
    the birthplace assertion. "Schuylkill County, Pennsylvania" is an accepted
    RESIDENCE, not an accepted birthplace, and still carries the rejected
    value."""
    _expect_fires(
        _tool_calls("Schuylkill County, Pennsylvania", site="findmypast"),
        {"type": "positive"},
        "attributes.birthPlace='Schuylkill County, Pennsylvania'",
    )


def test_hand_composed_check_skips_a_negative_relog_beside_a_captured_sibling():
    """The same-run sibling exclusion: a `negative` entry re-logging a URL that
    a `partial` entry in the same run already carries is a re-log, even when
    that sibling is itself excluded from grading (here by `capture_received`).
    Without this clause the re-log becomes its own grading target and demands a
    tool call the generating turn already made."""
    url = "https://www.ancestry.com/search/?name=Flynn"
    states = _states(
        {
            "id": "log_998", "tool": "external_site", "outcome": "partial",
            "external_site": {"site": "ancestry", "url_generated": url, "capture_received": True},
        },
        {
            "id": "log_999", "tool": "external_site", "outcome": "negative",
            "external_site": {"site": "ancestry", "url_generated": url, "capture_received": False},
        },
    )
    with pytest.raises(pytest.skip.Exception):
        _HAND_COMPOSED_CHECK(*states, [], {"type": "positive"})


def test_hand_composed_check_still_grades_two_partials_sharing_one_url():
    """The sibling exclusion must be one-directional.

    It was symmetric: each of two `partial` entries on one URL excluded the
    other, the candidate list emptied, and the whole check — the one issue
    #1980 asks for by name — skipped at exit 0. Measured before the fix: one
    such entry fired, two identical ones skipped.

    So the earliest entry for a URL stays a grading target and only the ones
    after it are treated as re-logs.

    Asserted through `_expect_fires`, not a bare `pytest.raises`: under the old
    symmetric rule the check *skips*, and a bare raises-block would itself be
    reported SKIPPED — passing at exit 0 and pinning nothing. That is the same
    skip-blind shape this suite exists to close."""
    url = "https://www.ancestry.com/search/?name=Flynn"
    entry = {
        "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "ancestry", "url_generated": url, "capture_received": False},
    }
    states = _states({**entry, "id": "log_996"}, {**entry, "id": "log_997"})
    _expect_passes(_tool_calls("Ireland"), {"type": "positive"}, states=states, check=_HAND_COMPOSED_CHECK)
    _expect_fires([], {"type": "positive"}, "hand-composed", states=states, check=_HAND_COMPOSED_CHECK)


def test_passes_a_place_sharing_only_a_leaf_name_with_the_rejected_value():
    """"Paris, Texas, United States" against a rejected "Paris, France": the
    rejected value's own second segment must line up too, at whatever offset."""
    research = copy.deepcopy(_RESEARCH)
    for assertion in research["assertions"]:
        if assertion["id"] == "a_012":
            assertion["place"] = "Paris, France"
    states = ({"research_json": research}, {"research_json": research})
    _expect_passes(_tool_calls("Paris, Texas, United States"), {"type": "positive"}, states=states)


def test_a_case_variant_of_the_preferred_value_is_not_a_rejected_value():
    """A competing assertion reading "IRELAND" agrees with the preferred
    "Ireland" (a transcription's casing); it must not become a rejected value
    that then casefold-matches the correctly encoded "Ireland"."""
    research = copy.deepcopy(_RESEARCH)
    for assertion in research["assertions"]:
        if assertion["id"] == "a_009":
            assertion["place"] = "IRELAND"
    states = ({"research_json": research}, {"research_json": research})
    _check(*states, _tool_calls("Ireland"), {"type": "positive"})  # must not raise
