"""Tests for harness.validator_runner.

Runs against the actual seed validators in eval/harness/validators/ to verify
the runner can drive them with realistic inputs.
"""

import json
from pathlib import Path

import pytest

from harness.validator_runner import (
    ValidatorRunResult,
    all_passed,
    as_dicts,
    run_validators,
    split_observations,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
VALIDATORS_DIR = REPO_ROOT / "eval/harness/validators"


def _empty_research_state():
    """Schema-valid empty research.json. v1.5: project must include
    objective/created/updated per research.schema.json."""
    return {
        "research_json": {
            "project": {
                "id": "rp_1",
                "objective": "test stub",
                "status": "active",
                "created": "2026-01-01",
                "updated": "2026-01-01",
            },
            "questions": [],
            "plans": [],
            "log": [],
            "sources": [],
            "assertions": [],
            "conflicts": [],
            "hypotheses": [],
            "person_evidence": [],
            "proof_summaries": [],
            "timelines": [],
            "evaluations": [],
        },
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,  # alias some validators may use
    }


def test_universal_passes_on_clean_state():
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
    )
    assert len(results) > 0, "expected at least one validator from test_universal.py"
    # If any failed, the validators didn't like our stub state — surface so we can
    # fix the stub rather than silently ignoring.
    if not all_passed(results):
        fails = [(r.name, r.error) for r in results if not r.passed]
        pytest.fail(f"validators failed on clean state: {fails}")


def test_skill_specific_validator_loaded_when_present():
    state = _empty_research_state()
    results = run_validators(
        skill="conflict-resolution",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
    )
    # Skill validator (conflict-resolution) defines some test_* functions;
    # they should appear in results when called against a clean state.
    names = {r.name for r in results}
    # Must include at least one validator name unique to conflict-resolution.
    # Looking at the seed file, test_conflict_resolution_ownership_only_conflicts
    # exists; check that one or another skill-specific test is present.
    skill_only = [n for n in names if "conflict" in n.lower() or "ownership" in n.lower()]
    assert skill_only, f"expected skill-specific validator to load; got {names}"


def test_skill_without_specific_file_runs_only_universal():
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",  # no test_search_wiki.py exists
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
    )
    # All loaded validators must come from test_universal.py — none from a
    # nonexistent test_search_wiki.py. Universal validators don't have
    # "ownership" or skill-specific words in their names typically.
    assert len(results) >= 1


def test_assertion_error_captured_as_failure(tmp_path):
    # Write a one-off validator that always fails.
    bad = tmp_path / "test_universal.py"
    bad.write_text(
        "def test_always_fails(before_state, after_state, tool_calls):\n"
        "    assert False, 'intentional'\n", encoding="utf-8"
    )
    results = run_validators(
        skill="x",
        validators_dir=tmp_path,
        before_state={},
        after_state={},
        tool_calls=[],
    )
    assert len(results) == 1
    assert results[0].passed is False
    assert "intentional" in results[0].error


def test_unknown_parameter_is_a_failure_not_a_skip(tmp_path):
    """A validator asking for an arg the runner cannot supply is recorded
    FAILED — for every test it runs against, not once.

    The code comment beside this branch says "skip it gracefully", which reads
    as dormancy and is how PR #1764 shipped two validators declaring an
    unsupplied `text_response`: they did not lie idle, they failed every
    translation test. Pinned so the next reader learns it from a test rather
    than from a red suite.
    """
    v = tmp_path / "test_universal.py"
    v.write_text(
        "def test_wants_the_impossible(before_state, no_such_arg):\n"
        "    assert True\n", encoding="utf-8"
    )
    results = run_validators(
        skill="x", validators_dir=tmp_path,
        before_state={}, after_state={}, tool_calls=[],
    )
    assert len(results) == 1
    assert results[0].passed is False
    assert "no_such_arg" in results[0].error


def test_validator_with_no_args_still_runs(tmp_path):
    nullary = tmp_path / "test_universal.py"
    nullary.write_text("def test_no_args():\n    assert 1 == 1\n", encoding="utf-8")
    results = run_validators(
        skill="x", validators_dir=tmp_path,
        before_state={}, after_state={}, tool_calls=[],
    )
    assert len(results) == 1
    assert results[0].passed is True


def test_ownership_table_blocks_cross_skill_writes():
    """Universal: a skill that writes to a section it doesn't own must fail
    test_ownership_table, regardless of which skill is being tested."""
    research_before = {
        "project": {
            "id": "rp_1", "objective": "test", "status": "active",
            "created": "2026-01-01", "updated": "2026-01-01",
        },
        "questions": [], "plans": [], "log": [], "sources": [],
        "assertions": [], "person_evidence": [], "conflicts": [],
        "hypotheses": [], "timelines": [], "proof_summaries": [],
    }
    research_after = dict(research_before)
    # record-extraction wrote to conflicts — it owns sources/assertions/log,
    # NOT conflicts. The universal validator must catch this.
    research_after = {**research_before, "conflicts": [
        {"id": "c_1", "status": "unresolved"}
    ]}

    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state={
            "research_json": research_before, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        after_state={
            "research_json": research_after, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
    )
    ownership = next((r for r in results if r.name == "test_ownership_table"), None)
    assert ownership is not None
    assert ownership.passed is False
    assert "conflicts" in (ownership.error or "")
    assert "record-extraction" in (ownership.error or "")


def test_ownership_table_allows_owned_writes():
    """conflict-resolution writing to conflicts should pass ownership."""
    research_before = {
        "project": {
            "id": "rp_1", "objective": "test", "status": "active",
            "created": "2026-01-01", "updated": "2026-01-01",
        },
        "questions": [], "plans": [], "log": [], "sources": [],
        "assertions": [], "person_evidence": [], "conflicts": [],
        "hypotheses": [], "timelines": [], "proof_summaries": [],
    }
    research_after = {**research_before, "conflicts": [
        {"id": "c_1", "status": "unresolved"}
    ]}

    results = run_validators(
        skill="conflict-resolution",
        validators_dir=VALIDATORS_DIR,
        before_state={
            "research_json": research_before, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        after_state={
            "research_json": research_after, "tree_gedcomx_json": None,
            "tree_gedcomx": None, "files": {},
        },
        tool_calls=[],
        skill_frontmatter={"name": "conflict-resolution"},
    )
    ownership = next((r for r in results if r.name == "test_ownership_table"), None)
    assert ownership is not None
    assert ownership.passed is True, f"unexpected failure: {ownership.error}"


def _classification_state(assertions):
    """State pair for expected_classifications tests: empty before,
    `assertions` appended after."""
    before = _empty_research_state()
    before["files"] = {}
    after = _empty_research_state()
    after["files"] = {}
    after["research_json"] = {
        **after["research_json"],
        "assertions": assertions,
    }
    return before, after


def _run_expected_classifications(assertions, matchers):
    before, after = _classification_state(assertions)
    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
        test={"tags": [], "expected_classifications": matchers},
    )
    result = next(
        (r for r in results if r.name == "test_expected_classifications"), None
    )
    assert result is not None, "test_expected_classifications did not run"
    return result


def test_expected_classifications_pass_when_matchers_satisfied():
    """Existence + declared-value conformity on every matching new
    assertion → pass. A second assertion with a different pair is
    untouched by the matcher."""
    assertions = [
        {
            "id": "a_1",
            "record_role": "deceased",
            "fact_type": "age",
            "evidence_type": "indirect",
            "informant_proximity": "family_not_present",
            "information_quality": "secondary",
        },
        {
            "id": "a_2",
            "record_role": "deceased",
            "fact_type": "death",
            "evidence_type": "direct",
            "informant_proximity": "official_duty",
        },
    ]
    result = _run_expected_classifications(
        assertions,
        [
            {
                "record_role": "deceased",
                "fact_type": "age",
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            },
            {
                "record_role": "deceased",
                "fact_type": "death",
                "evidence_type": "direct",
                "informant_proximity": "official_duty",
            },
        ],
    )
    assert result.passed is True, f"unexpected failure: {result.error}"
    assert not (result.error or "").startswith("skipped")


def test_expected_classifications_fail_names_assertion_field_got_expected():
    """EVERY new assertion matching the pair must conform — a violation
    is reported with the assertion id, field, got, and expected."""
    assertions = [
        {
            "id": "a_1",
            "record_role": "deceased",
            "fact_type": "age",
            "evidence_type": "direct",  # doctrine says indirect
            "informant_proximity": "family_not_present",
        },
    ]
    result = _run_expected_classifications(
        assertions,
        [
            {
                "record_role": "deceased",
                "fact_type": "age",
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            }
        ],
    )
    assert result.passed is False
    for fragment in ("a_1", "evidence_type", "direct", "indirect"):
        assert fragment in (result.error or ""), (
            f"failure message missing {fragment!r}: {result.error}"
        )


def test_expected_classifications_fail_when_pair_missing_and_skip_when_absent():
    """A matcher whose (record_role, fact_type) pair no new assertion
    carries fails the existence half; a test without the block skips."""
    result = _run_expected_classifications(
        [],
        [{"record_role": "deceased", "fact_type": "age", "evidence_type": "indirect"}],
    )
    assert result.passed is False
    assert "no new assertion" in (result.error or "")
    assert "record_role='deceased'" in (result.error or "")

    skipped = _run_expected_classifications([], [])
    assert skipped.passed is True
    assert "skipped" in (skipped.error or "").lower()


def test_expected_classifications_normalizes_pascalcase_fact_types():
    """record_role/fact_type are open, model-chosen strings — PascalCase
    GedcomX-style persisted values must satisfy snake_case matchers
    (CauseOfDeath ≡ cause_of_death, Birth ≡ birth). Observed on
    ut_record_extraction_009: a doctrine-perfect run failed all 9 matchers
    on spelling alone. Event place is an attribute of the `birth` fact (not
    its own type), so the birthplace-claim is a `birth` assertion with `place`
    set, matched by `attribute: "place"`."""
    assertions = [
        {
            "id": "a_1",
            "record_role": "deceased",
            "fact_type": "CauseOfDeath",
            "evidence_type": "direct",
            "informant_proximity": "official_duty",
        },
        {
            "id": "a_2",
            "record_role": "Deceased",
            "fact_type": "Birth",
            "place": "Ireland",
            "evidence_type": "indirect",
            "informant_proximity": "family_not_present",
        },
    ]
    result = _run_expected_classifications(
        assertions,
        [
            {
                "record_role": "deceased",
                "fact_type": "cause_of_death",
                "evidence_type": "direct",
                "informant_proximity": "official_duty",
            },
            {
                "record_role": "deceased",
                "fact_type": "birth",
                "attribute": "place",
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            },
        ],
    )
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_expected_classifications_optional_skips_existence_but_checks_classification():
    """`optional: true` drops the existence requirement (a flappy-completeness
    fact isn't a hard fail when absent) but still verifies the classification
    when the assertion IS present."""
    # Absent + optional → passes (no existence requirement).
    absent = _run_expected_classifications(
        [{"id": "a_1", "record_role": "deceased", "fact_type": "death",
          "evidence_type": "direct"}],
        [{"record_role": "father_of_deceased", "fact_type": "name", "optional": True,
          "evidence_type": "indirect"}],
    )
    assert absent.passed is True, f"unexpected failure: {absent.error}"

    # Present + optional + WRONG classification → still fails (teeth on classification).
    wrong = _run_expected_classifications(
        [{"id": "a_1", "record_role": "father_of_deceased", "fact_type": "name",
          "evidence_type": "direct"}],  # doctrine says indirect
        [{"record_role": "father_of_deceased", "fact_type": "name", "optional": True,
          "evidence_type": "indirect"}],
    )
    assert wrong.passed is False
    assert "evidence_type" in (wrong.error or "")

    # Absent WITHOUT optional → fails existence (the default, unchanged).
    required = _run_expected_classifications(
        [{"id": "a_1", "record_role": "deceased", "fact_type": "death",
          "evidence_type": "direct"}],
        [{"record_role": "father_of_deceased", "fact_type": "name",
          "evidence_type": "indirect"}],
    )
    assert required.passed is False
    assert "expected at least one" in (required.error or "")


def test_expected_classifications_value_pins_the_fact_value():
    """`value` (#1108) checks the fact VALUE, not a layer. The ut_013 leak —
    Patrick's birthplace persisted 'Pennsylvania' where the record says
    'Ireland' — is `direct` either way, so only a value matcher catches it.
    Substring + case-insensitive, read from the attribute-relevant field."""
    # Correct value → passes.
    ok = _run_expected_classifications(
        [{"id": "a_1", "record_role": "child_2", "fact_type": "birth",
          "place": "Ireland", "evidence_type": "direct"}],
        [{"record_role": "child_2", "fact_type": "birth", "attribute": "place",
          "value": "Ireland", "evidence_type": "direct"}],
    )
    assert ok.passed is True, f"unexpected failure: {ok.error}"

    # The ut_013 leak: wrong birthplace value, still classified `direct` → the
    # value matcher fails where the evidence_type facet alone would pass.
    leak = _run_expected_classifications(
        [{"id": "a_1", "record_role": "child_2", "fact_type": "birth",
          "place": "Pennsylvania", "evidence_type": "direct"}],
        [{"record_role": "child_2", "fact_type": "birth", "attribute": "place",
          "value": "Ireland", "evidence_type": "direct"}],
    )
    assert leak.passed is False
    for frag in ("a_1", "Ireland", "Pennsylvania"):
        assert frag in (leak.error or ""), f"missing {frag!r}: {leak.error}"

    # Place standardization is tolerated ("Pennsylvania" ⊂ "Pennsylvania, United States").
    std = _run_expected_classifications(
        [{"id": "a_1", "record_role": "child_3", "fact_type": "birth",
          "place": "Pennsylvania", "standard_place": "Pennsylvania, United States",
          "evidence_type": "direct"}],
        [{"record_role": "child_3", "fact_type": "birth", "attribute": "place",
          "value": "Pennsylvania", "evidence_type": "direct"}],
    )
    assert std.passed is True, f"unexpected failure: {std.error}"


def test_expected_classifications_attribute_facet_separates_birth_claims():
    """A `birth` place-claim (place set, `direct`) and a `birth` date-claim
    (date set, `indirect`) share the `birth` fact_type but are independently
    checkable via `attribute`: the place matcher grades only the place-claim,
    the date matcher only the date-claim — even though a naive fact_type-only
    match would conflate them and fail the census direct/indirect split."""
    assertions = [
        {
            "id": "a_place",
            "record_role": "head_of_household",
            "fact_type": "birth",
            "place": "Ireland",
            "evidence_type": "direct",
        },
        {
            "id": "a_date",
            "record_role": "head_of_household",
            "fact_type": "birth",
            "date": "~1818",
            "evidence_type": "indirect",
        },
    ]
    result = _run_expected_classifications(
        assertions,
        [
            {"record_role": "head_of_household", "fact_type": "birth",
             "attribute": "place", "evidence_type": "direct"},
            {"record_role": "head_of_household", "fact_type": "birth",
             "attribute": "date", "evidence_type": "indirect"},
        ],
    )
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_expected_classifications_role_prefix_matches_of_form():
    """A short role satisfies the long form when the long form continues
    with 'of' after the prefix: persisted `father` matches matcher
    `father_of_deceased` (either direction)."""
    assertions = [
        {
            "id": "a_1",
            "record_role": "father",
            "fact_type": "Name",
            "evidence_type": "indirect",
            "informant_proximity": "family_not_present",
        },
    ]
    result = _run_expected_classifications(
        assertions,
        [
            {
                "record_role": "father_of_deceased",
                "fact_type": "name",
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            }
        ],
    )
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_expected_classifications_genuinely_wrong_values_still_fail():
    """Normalization must not become leniency: a role with no prefix-of
    relation to the matcher fails existence, the facet filter has teeth (a
    date-only `birth` must NOT satisfy an `attribute: "place"` matcher), and a
    matched pair with the wrong closed-enum classification value still fails —
    with the ORIGINAL strings in the message."""
    # Wrong role: `witness` has no prefix-of relation to father_of_deceased.
    wrong_role = _run_expected_classifications(
        [
            {
                "id": "a_1",
                "record_role": "witness",
                "fact_type": "name",
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            }
        ],
        [{"record_role": "father_of_deceased", "fact_type": "name",
          "evidence_type": "indirect"}],
    )
    assert wrong_role.passed is False
    assert "record_role='father_of_deceased'" in (wrong_role.error or "")

    # Facet filter: a `birth` assertion carrying only a DATE must NOT satisfy a
    # place-claim matcher (attribute='place' requires place/standard_place set).
    wrong_facet = _run_expected_classifications(
        [
            {
                "id": "a_1",
                "record_role": "deceased",
                "fact_type": "Birth",
                "date": "~1845",  # a date-claim, no place
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            }
        ],
        [{"record_role": "deceased", "fact_type": "birth", "attribute": "place",
          "evidence_type": "indirect"}],
    )
    assert wrong_facet.passed is False
    assert "attribute='place'" in (wrong_facet.error or "")

    # Matched (normalized + place-facet) pair, wrong classification value →
    # value failure naming the assertion, with original (PascalCase) strings.
    wrong_value = _run_expected_classifications(
        [
            {
                "id": "a_1",
                "record_role": "father",
                "fact_type": "Birth",
                "place": "Ireland",
                "evidence_type": "direct",  # doctrine says indirect
                "informant_proximity": "family_not_present",
            }
        ],
        [{"record_role": "father_of_deceased", "fact_type": "birth",
          "attribute": "place", "evidence_type": "indirect"}],
    )
    assert wrong_value.passed is False
    for fragment in ("a_1", "evidence_type", "direct", "indirect"):
        assert fragment in (wrong_value.error or ""), (
            f"failure message missing {fragment!r}: {wrong_value.error}"
        )


# --- compound birth assertions (year smuggled into a birthplace value) ---


def _run_birth_year_rule(assertions):
    before, after = _classification_state(assertions)
    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
        test={"tags": []},
    )
    result = next(
        (
            r
            for r in results
            if r.name == "test_birth_place_value_has_no_embedded_year"
        ),
        None,
    )
    assert result is not None, (
        "test_birth_place_value_has_no_embedded_year did not run"
    )
    return result


def _birth_assertion(**overrides):
    base = {
        "id": "a_1",
        "record_role": "child_1",
        "fact_type": "birth",
        "value": "Ohio",
        "place": "Ohio, United States",
        "date": None,
        "evidence_type": "direct",
    }
    base.update(overrides)
    return base


def test_birth_year_rule_flags_dateless_compound_value():
    """The defect (#1407): a place-keyed `direct` birth assertion carrying a
    year in `value` and NO structured `date` — two facts in one assertion,
    invisible to every structured matcher."""
    result = _run_birth_year_rule(
        [_birth_assertion(value="born about 1845, Ohio")]
    )
    assert result.passed is False
    for fragment in ("a_1", "1845", "child_1"):
        assert fragment in (result.error or ""), (
            f"failure message missing {fragment!r}: {result.error}"
        )


def test_birth_year_rule_passes_on_a_bare_birthplace():
    assert _run_birth_year_rule([_birth_assertion()]).passed is True


@pytest.mark.parametrize(
    ("value", "date"),
    [
        ("January 1845", "January 1845"),  # ut_026 — month-year mirrored
        ("Born 11 July 1817, Stavanger, Norway", "11 July 1817"),  # ut_016
        ("born Ireland, circa 1845", "~1845"),  # ut_005
        ("born ca. 1845, Ireland", "~1845"),  # ut_006
    ],
)
def test_birth_year_rule_does_not_flag_measured_false_positive_shapes(value, date):
    """The four shapes measured across the committed run logs that carry a
    year in `value` and are NOT the defect: each populates `date` with THAT
    year, so the year mirrors a structured fact. Flagging any of them would
    redden a correct test — the plan's explicit acceptance bar. The date is
    the real one per shape, not a stand-in: exemption 1 is year-specific, so
    pairing an 1817 value with a 1845 date would pass for the wrong reason
    and hide a regression in that check."""
    result = _run_birth_year_rule([_birth_assertion(value=value, date=date)])
    assert result.passed is True, (
        f"false positive on a date-backed value: {result.error}"
    )


def test_birth_year_rule_reports_every_year_in_the_label():
    """When nothing states a date, the message names all the years it found,
    so the annotator sees the whole label rather than its first match."""
    result = _run_birth_year_rule(
        [_birth_assertion(value="1870 census: born about 1845, Ohio",
                          date=None)]
    )
    assert result.passed is False
    for year in ("1870", "1845"):
        assert year in (result.error or ""), result.error


def test_birth_year_rule_exempts_a_year_the_before_state_already_stated():
    """`sibling_years` reads the whole after-state, so a birth date seeded by
    the scenario (every mid-research-flynn fixture has them) exempts a run
    that adds only the birthplace — it smuggled nothing."""
    seeded = _birth_assertion(
        id="seed_1", value="about 1845", place=None, date="~1845",
        evidence_type="indirect",
    )
    before = _empty_research_state()
    before["files"] = {}
    before["research_json"] = {
        **before["research_json"], "assertions": [seeded],
    }
    after = _empty_research_state()
    after["files"] = {}
    after["research_json"] = {
        **after["research_json"],
        "assertions": [seeded, _birth_assertion(value="born about 1845, Ohio")],
    }
    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
        test={"tags": []},
    )
    result = next(
        r
        for r in results
        if r.name == "test_birth_place_value_has_no_embedded_year"
    )
    assert result.passed is True, f"false positive on a seeded year: {result.error}"


def test_birth_year_rule_exempts_a_year_stated_by_a_sibling_assertion():
    """The ut_028 shape, from the 2026-08-14 paid run. The party gets TWO
    atomic birth assertions — a `direct` place-claim whose label redundantly
    repeats the year, beside an `indirect` date-claim that states it
    structurally. Atomicity is correct and nothing is lost, so this must not
    fail; the pre-fix rule reddened it."""
    result = _run_birth_year_rule(
        [
            _birth_assertion(
                id="a_1",
                record_role="groom",
                value="about 1887, Cincinnati, Ohio",
                place="Cincinnati, Ohio",
                date=None,
                evidence_type="direct",
            ),
            _birth_assertion(
                id="a_2",
                record_role="groom",
                value="about 1887",
                place=None,
                date="~1887",
                evidence_type="indirect",
            ),
        ]
    )
    assert result.passed is True, f"false positive on an atomic pair: {result.error}"


def test_birth_year_rule_exemption_is_scoped_to_the_same_role():
    """A sibling under a DIFFERENT role does not vouch: the bride stating 1845
    cannot excuse a year smuggled into the groom's birthplace label."""
    result = _run_birth_year_rule(
        [
            _birth_assertion(
                id="a_1", record_role="groom",
                value="born about 1845, Ohio", date=None,
            ),
            _birth_assertion(
                id="a_2", record_role="bride", value="about 1845",
                place=None, date="~1845", evidence_type="indirect",
            ),
        ]
    )
    assert result.passed is False
    assert "a_1" in (result.error or "")


def test_birth_year_rule_exemption_is_scoped_to_the_same_record():
    """And not across records — `child_1` on one record must not vouch for
    `child_1` on another, which would suppress a genuine leak in any
    multi-record project."""
    smuggled = _birth_assertion(
        id="b_1", value="born about 1845, Ohio", date=None,
    )
    smuggled["record_id"] = "recB"
    other = _birth_assertion(
        id="a_2", value="about 1845", place=None, date="~1845",
        evidence_type="indirect",
    )
    other["record_id"] = "recA"
    result = _run_birth_year_rule([smuggled, other])
    assert result.passed is False
    assert "b_1" in (result.error or "")


def test_birth_year_rule_tolerates_a_second_year_in_the_label():
    """A label carrying an enumeration year besides the birth year must not
    fire when the birth year IS captured on a sibling. `search` took the FIRST
    year, so "1870 census: born in Ohio" failed on 1870 even though ~1845 sat
    correctly on the sibling — and a validator failure suppresses the judge,
    so that false positive cost the whole test's grade."""
    result = _run_birth_year_rule(
        [
            _birth_assertion(
                id="a_1", value="1870 census: born in Ohio", date=None,
            ),
            _birth_assertion(
                id="a_2", value="about 1845", place=None, date="~1845",
                evidence_type="indirect",
            ),
        ]
    )
    assert result.passed is True, (
        f"false positive on a label carrying a second year: {result.error}"
    )


def test_birth_year_rule_ignores_indirect_and_placeless_assertions():
    """Scope guards, each isolated so it is the ONLY thing that can spare the
    assertion — with a `date` present too, exemption 1 would carry these and
    the guard itself would be untested (deleting it would keep the suite
    green)."""
    # placeless: no place/standard_place, and no date to fall back on.
    assert _run_birth_year_rule(
        [_birth_assertion(value="born about 1845", place=None, date=None)]
    ).passed is True
    # indirect: place-keyed and dateless, spared only by evidence_type.
    assert _run_birth_year_rule(
        [_birth_assertion(value="born about 1845, Ohio", date=None,
                          evidence_type="indirect")]
    ).passed is True
    # non-birth fact_type, likewise place-keyed, dateless and direct.
    assert _run_birth_year_rule(
        [_birth_assertion(value="born about 1845, Ohio", date=None,
                          fact_type="residence")]
    ).passed is True


# --- pre-1880 census writes no relationship assertions (#1626) ---


def _run_pre1880_rule(assertions, tags):
    before, after = _classification_state(assertions)
    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
        test={"tags": tags},
    )
    result = next(
        (
            r
            for r in results
            if r.name == "test_pre_1880_census_creates_no_relationship_assertions"
        ),
        None,
    )
    assert result is not None, "the pre-1880 validator did not run"
    return result


def _relationship(rel_type, evidence_type="indirect"):
    return {
        "id": "a_1",
        "record_role": "child_1",
        "fact_type": "relationship",
        "value": "child of Thomas Flynn",
        "structured_value": {"relationship_type": rel_type},
        "evidence_type": evidence_type,
    }


@pytest.mark.parametrize(
    "rel_type,evidence_type",
    [
        ("child_inferred", "indirect"),  # the OLD policy's correct output
        ("spouse_inferred", "indirect"),
        ("child", "direct"),  # and the plainly-wrong one
    ],
)
def test_pre_1880_rule_rejects_any_relationship_assertion(rel_type, evidence_type):
    """The `_inferred`/`indirect` form is rejected too — that is the whole
    reversal (#1626, decided 2026-08-15). Labelling the doubt is still
    asserting the relationship."""
    result = _run_pre1880_rule(
        [_relationship(rel_type, evidence_type)], ["census", "1870"]
    )
    assert result.passed is False
    assert "no relationship column" in (result.error or ""), result.error


def test_pre_1880_rule_passes_when_only_stated_facts_are_written():
    """The doctrine-correct output: people and their facts, no links."""
    result = _run_pre1880_rule(
        [
            {
                "id": "a_1",
                "record_role": "child_1",
                "fact_type": "name",
                "value": "John Baker",
                "evidence_type": "direct",
            },
            {
                "id": "a_2",
                "record_role": "head_of_household",
                "fact_type": "residence",
                "place": "Cincinnati, Hamilton, Ohio",
                "evidence_type": "direct",
            },
        ],
        ["census", "1870"],
    )
    assert result.passed is True, result.error


@pytest.mark.parametrize("tags", [["census", "1850-census"], ["census", "1860"]])
def test_pre_1880_rule_gate_derives_the_year_from_tags(tags):
    """Both tag spellings gate: bare (`1860`) and suffixed (`1850-census`)."""
    result = _run_pre1880_rule([_relationship("child_inferred")], tags)
    assert result.passed is False


@pytest.mark.parametrize(
    "tags",
    [
        ["census", "1880"],  # the column exists from 1880
        ["census", "1900"],
        ["extraction", "marriage-record"],  # not a census at all
        ["census"],  # census with no year — cannot be gated
    ],
)
def test_pre_1880_rule_skips_everything_it_should_not_gate(tags):
    """1880+ census relationships are STATED and stay `direct`; a
    non-census record is out of scope entirely."""
    result = _run_pre1880_rule([_relationship("child", "direct")], tags)
    assert result.passed is True, result.error


# --- name values must be bare names (#1627) ---


def _run_bare_name_rule(assertions):
    before, after = _classification_state(assertions)
    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
        test={"tags": []},
    )
    result = next(
        (r for r in results if r.name == "test_name_value_is_a_bare_name"), None
    )
    assert result is not None, "test_name_value_is_a_bare_name did not run"
    return result


def test_bare_name_rule_flags_the_persona_collapse_shape():
    """The ut_025 defect, from `v1_2026-08-14_16-03-27`: the groom's father
    captured as a name assertion ON the groom, with the tie fused into the
    value, so no `father_of_groom` persona exists for person-evidence to
    bind."""
    result = _run_bare_name_rule(
        [
            {
                "id": "a_1",
                "record_role": "groom",
                "fact_type": "name",
                "value": "John Becker (father of Frank Becker)",
                "evidence_type": "direct",
            }
        ]
    )
    assert result.passed is False
    for fragment in ("a_1", "groom", "father of"):
        assert fragment in (result.error or ""), result.error


def test_bare_name_rule_flags_a_relational_note_even_under_the_right_role():
    """The ut_017 shape: the persona IS correct (`daughter_in_law_1`), but the
    value carries a relational clause instead of the bare name. Milder than
    the collapse, same rule — a name value is a name."""
    result = _run_bare_name_rule(
        [
            {
                "id": "a_1",
                "record_role": "daughter_in_law_1",
                "fact_type": "name",
                "value": "Linda (given name only; spouse of Robert Whitaker)",
                "evidence_type": "direct",
            }
        ]
    )
    assert result.passed is False


@pytest.mark.parametrize(
    "value",
    [
        "Mary (Johnson) Smith",  # maiden surname parenthetical — one person
        "John Becker",
        "Tollev [Nadnesen?]",  # faithful-capture uncertainty marker
        "Emma Schmidt",
        # Relation words that are really surnames or titles, OUTSIDE brackets.
        # All three fired under the first version of this rule (senior review,
        # 2026-08-16). A false positive costs the test's whole grade, because a
        # failing validator suppresses the judge.
        "Joseph Parent of Quebec",   # Parent is a common surname
        "Julia Child of Boston",     # Child is a surname
        "Mary, Mother of Sorrows",   # a devotional name
    ],
)
def test_bare_name_rule_leaves_legitimate_name_values_alone(value):
    """A maiden-name parenthetical, an uncertainty marker, and plain names all
    pass: the rule needs a relation word followed by `of`/`to`."""
    result = _run_bare_name_rule(
        [
            {
                "id": "a_1",
                "record_role": "bride",
                "fact_type": "name",
                "value": value,
                "evidence_type": "direct",
            }
        ]
    )
    assert result.passed is True, f"false positive on {value!r}: {result.error}"



@pytest.mark.parametrize(
    "value,expected",
    [
        ("John Becker (grandfather of Frank)", "grandfather of"),
        ("Rosa (great-grandmother of Emma)", "great-grandmother of"),
        ("Wm (stepfather of Charles)", "stepfather of"),
        ("Anna (father-in-law of X)", "father-in-law of"),
        ("Jacob (s/o Henry Lang)", "s/o"),
        ("Ellen (d/o Patrick)", "d/o"),
    ],
)
def test_bare_name_rule_catches_the_wider_relation_vocabulary(value, expected):
    """Shapes the first version missed (senior review, 2026-08-16): step- and
    grand- prefixes, `-in-law`, and the abbreviated `s/o` / `d/o` / `w/o`
    forms. Safe to broaden precisely BECAUSE the scan is bracket-scoped — the
    surname false positives above live in the bare part of the value."""
    result = _run_bare_name_rule(
        [
            {
                "id": "a_1",
                "record_role": "groom",
                "fact_type": "name",
                "value": value,
                "evidence_type": "direct",
            }
        ]
    )
    assert result.passed is False
    assert expected in (result.error or ""), result.error

def test_bare_name_rule_exempts_negative_evidence():
    """`record_role: absent` values describe an expected-but-missing person,
    so a relational phrase there is the point, not a defect."""
    result = _run_bare_name_rule(
        [
            {
                "id": "a_1",
                "record_role": "absent",
                "fact_type": "name",
                # The relation must sit INSIDE brackets, or the bracket-scoped
                # regex never matches and this test passes without ever reaching
                # the exemption it names (which is what it did before #1631's
                # review — deleting the exemption left all 16 tests green).
                "value": "not recorded (father of the bride)",
                "evidence_type": "negative",
            }
        ]
    )
    assert result.passed is True, result.error


def test_bare_name_rule_only_scans_name_facts():
    """A relational phrase in a non-`name` fact is not the collapse shape — a
    relationship fact's whole job is to say "X of Y". Without the fact_type
    filter this value would be flagged, so this is what pins the filter:
    dropping it left the rest of the suite green."""
    result = _run_bare_name_rule(
        [
            {
                "id": "a_1",
                "record_role": "groom",
                "fact_type": "relationship",
                "value": "listed as son (son of Frank Becker)",
            }
        ]
    )
    assert result.passed is True, result.error


# --- relationship_type must agree with its own value (found while annotating) ---


def _run_rel_agreement(assertions):
    before, after = _classification_state(assertions)
    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
        test={"tags": []},
    )
    result = next(
        (r for r in results
         if r.name == "test_relationship_type_agrees_with_its_value"), None
    )
    assert result is not None, "the relationship-agreement validator did not run"
    return result


def _rel(rel_type, value):
    return [{
        "id": "a_1", "record_role": "child_1", "fact_type": "relationship",
        "value": value, "structured_value": {"relationship_type": rel_type},
        "evidence_type": "direct",
    }]


@pytest.mark.parametrize(
    "rel_type,value,states",
    [
        # The genealogist's find on ut_017: a sister typed as a child.
        ("child", "sister of Harold Dean Whitaker", "sibling"),
        ("child", "Sibling of Grace (Whitaker) Tolman", "sibling"),
        ("parent", "sibling of Grace Tolman (nee Whitaker)", "sibling"),
        # ut_027: the edge written BACKWARDS — typed parent, value says child of.
        ("parent", "child of Louise Becker", "child"),
        ("parent", "child of Edward Becker", "child"),
    ],
)
def test_rel_agreement_catches_the_corpus_disagreements(rel_type, value, states):
    """The 7 genuine instances in the committed run logs reduce to these two
    shapes: a category swap and a direction inversion."""
    result = _run_rel_agreement(_rel(rel_type, value))
    assert result.passed is False
    assert states in (result.error or ""), result.error


@pytest.mark.parametrize(
    "rel_type,value",
    [
        # Category-equivalent, NOT disagreements. A literal string comparison
        # flags all of these — 39 hits corpus-wide, only 7 of them real.
        ("spouse", "wife of George Bennett"),
        ("spouse", "husband of Mary Flynn"),
        ("child", "son of George Bennett"),
        ("child", "daughter of John Becker"),
        ("child_inferred", "son of Sarah Bennett (inferred)"),
        ("parent", "father of Louise Becker"),
        ("parent", "mother of Louise Becker"),
        ("child", "daughter of head of household John Becker"),
        ("sibling", "brother of Harold"),
    ],
)
def test_rel_agreement_accepts_category_equivalents(rel_type, value):
    result = _run_rel_agreement(_rel(rel_type, value))
    assert result.passed is True, f"false positive on {rel_type}/{value}: {result.error}"


@pytest.mark.parametrize(
    "rel_type,value",
    [
        ("stepfather", "stepfather of Charles Ferber"),   # type not in the table
        ("father_in_law", "father-in-law of X"),          # ditto
        ("child", "Jacob Lang"),                          # value names no relation
        ("child", ""),                                     # no value at all
    ],
)
def test_rel_agreement_skips_what_it_cannot_compare(rel_type, value):
    """Fails OPEN. An unrecognised relationship_type or a value naming no
    relation is not evidence of disagreement, and guessing would cost the whole
    test's grade — a failing validator suppresses the judge."""
    result = _run_rel_agreement(_rel(rel_type, value))
    assert result.passed is True, result.error


def test_rel_agreement_accepts_a_value_naming_several_relations():
    """`want in found` — the type only has to match one of them."""
    result = _run_rel_agreement(
        _rel("child", "child of Thomas Flynn and brother of Mary Flynn")
    )
    assert result.passed is True, result.error


# --- record_persona_id corruption signature (shared persona across roles) ---

_PERSONA_ARK = "https://www.familysearch.org/ark:/61903/1:1:ABCD-123"


def _persona_sidecar_files(persona_ids):
    """A staged search sidecar (results/log_001.json) holding ONE record
    with the given gedcomx persona ids (first id = the result's primaryId)."""
    import json

    sidecar = {
        "log_id": "log_001",
        "tool": "record_search",
        "retrieved": "2026-01-01T00:00:00Z",
        "returned_count": 1,
        "payload": {
            "results": [
                {
                    "recordId": _PERSONA_ARK,
                    "primaryId": persona_ids[0],
                    "gedcomx": {"persons": [{"id": p} for p in persona_ids]},
                }
            ]
        },
    }
    return {"results/log_001.json": json.dumps(sidecar)}


def _run_persona_id_set(assertions, persona_ids=("p_1", "p_2", "p_3")):
    before = _empty_research_state()
    before["files"] = _persona_sidecar_files(list(persona_ids))
    after = _empty_research_state()
    after["files"] = dict(before["files"])
    after["research_json"] = {**after["research_json"], "assertions": assertions}
    results = run_validators(
        skill="record-extraction",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "record-extraction"},
        test={"tags": []},
    )
    result = next(
        (r for r in results if r.name == "test_record_persona_id_set"), None
    )
    assert result is not None, "test_record_persona_id_set did not run"
    return result


def test_record_persona_id_distinct_personas_pass():
    """Correct multi-persona extraction: each record_role carries its own
    persona id — no corruption signature."""
    result = _run_persona_id_set(
        [
            {"id": "a_1", "record_id": _PERSONA_ARK,
             "record_role": "deceased", "record_persona_id": "p_1"},
            {"id": "a_2", "record_id": _PERSONA_ARK,
             "record_role": "father_of_deceased", "record_persona_id": "p_2"},
        ]
    )
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_record_persona_id_shared_across_roles_fails():
    """ut_006 corruption signature: the focus persona's id (p_1) stamped
    onto a DIFFERENT record_role's assertion on a multi-persona record."""
    result = _run_persona_id_set(
        [
            {"id": "a_1", "record_id": _PERSONA_ARK,
             "record_role": "deceased", "record_persona_id": "p_1"},
            {"id": "a_2", "record_id": _PERSONA_ARK,
             "record_role": "father_of_deceased", "record_persona_id": "p_1"},
        ]
    )
    assert result.passed is False
    for fragment in ("p_1", "a_1", "a_2", "different record_roles"):
        assert fragment in (result.error or ""), (
            f"failure message missing {fragment!r}: {result.error}"
        )


def test_record_persona_id_role_spelling_variants_not_flagged():
    """`father` vs `father_of_deceased` are ONE role in two spellings
    (the normalized prefix-of matcher) — sharing a persona id across them
    is not the corruption signature."""
    result = _run_persona_id_set(
        [
            {"id": "a_1", "record_id": _PERSONA_ARK,
             "record_role": "father", "record_persona_id": "p_2"},
            {"id": "a_2", "record_id": _PERSONA_ARK,
             "record_role": "father_of_deceased", "record_persona_id": "p_2"},
        ]
    )
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_record_persona_id_single_persona_record_exempt():
    """A single-persona record cannot cross-contaminate — the shared-id
    check gates on 2+ personas in the sidecar's gedcomx."""
    result = _run_persona_id_set(
        [
            {"id": "a_1", "record_id": _PERSONA_ARK,
             "record_role": "deceased", "record_persona_id": "p_1"},
            {"id": "a_2", "record_id": _PERSONA_ARK,
             "record_role": "informant", "record_persona_id": "p_1"},
        ],
        persona_ids=("p_1",),
    )
    assert result.passed is True, f"unexpected failure: {result.error}"


# --- Hand-edit detector (project files must go through writer tools) ---

def _hand_edit_states(research_changed):
    """Before/after state pair; when research_changed, after grows a
    person_evidence entry (the ut_012 hand-edit shape)."""
    before = _empty_research_state()
    before["files"] = {}
    after = _empty_research_state()
    after["files"] = {}
    if research_changed:
        after["research_json"] = {
            **after["research_json"],
            "person_evidence": [
                {
                    "id": "pe_001",
                    "assertion_id": "a_001",
                    "person_id": "I1",
                    "confidence": "confident",
                    "rationale": "hand-added",
                    "created": "2026-07-12",
                    "superseded_by": None,
                }
            ],
        }
    return before, after


def _run_hand_edit_detector(research_changed, tool_calls):
    before, after = _hand_edit_states(research_changed)
    results = run_validators(
        skill="person-evidence",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=tool_calls,
        skill_frontmatter={"name": "person-evidence"},
    )
    result = next(
        (
            r
            for r in results
            if r.name == "test_project_file_changes_route_through_writer_tools"
        ),
        None,
    )
    assert result is not None, "hand-edit detector did not run"
    return result


def test_hand_edit_detector_passes_when_writer_tool_called():
    """(a) research.json changed + a writer-tool call present → pass."""
    result = _run_hand_edit_detector(
        research_changed=True,
        tool_calls=[
            {
                "tool": "mcp__genealogy__research_append",
                "args": {"section": "person_evidence", "op": "append"},
            }
        ],
    )
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_hand_edit_detector_fails_on_change_with_zero_writer_calls():
    """(b) research.json changed + ZERO writer-tool calls → fail, naming
    the file and pointing at the writer tools (the ut_012 incident: empty
    tool_calls yet a person_evidence entry appeared with a fabricated
    created date, and every validator passed)."""
    result = _run_hand_edit_detector(
        research_changed=True,
        tool_calls=[
            # A read-only call must not legitimize the write.
            {"tool": "mcp__genealogy__person_read", "args": {"personId": "I1"}},
        ],
    )
    assert result.passed is False
    assert "research.json" in (result.error or "")
    assert "no writer-tool call" in (result.error or "")
    assert "research_append" in (result.error or "")


def test_hand_edit_detector_passes_when_nothing_changed():
    """(c) no project-file changes + no tool calls → pass."""
    result = _run_hand_edit_detector(research_changed=False, tool_calls=[])
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_pytest_skip_is_treated_as_pass_with_skipped_marker(tmp_path):
    """Validators using `pytest.skip()` should not abort the run."""
    bad = tmp_path / "test_universal.py"
    bad.write_text(
        "import pytest\n"
        "def test_uses_skip(before_state, after_state, tool_calls):\n"
        "    pytest.skip('not applicable to this state')\n", encoding="utf-8"
    )
    results = run_validators(
        skill="x",
        validators_dir=tmp_path,
        before_state={},
        after_state={},
        tool_calls=[],
    )
    assert len(results) == 1
    assert results[0].passed is True
    assert "skipped" in results[0].error.lower()


def test_as_dicts_shape():
    from harness.validator_runner import ValidatorRunResult
    items = [
        ValidatorRunResult(name="a", passed=True, error=None),
        ValidatorRunResult(name="b", passed=False, error="boom"),
    ]
    out = as_dicts(items)
    assert out == [
        {"name": "a", "passed": True, "error": None},
        {"name": "b", "passed": False, "error": "boom"},
    ]


# --- #987: full project-file validation + duplicate-id universal validators ---

_VALID_TREE = {
    "persons": [
        {"id": "I1", "gender": "Male", "names": [{"id": "N1", "given": "A", "surname": "B", "preferred": True}]},
        {"id": "I2", "gender": "Female", "names": [{"id": "N2", "given": "C", "surname": "B", "preferred": True}]},
    ],
    "relationships": [{"id": "R1", "type": "ParentChild", "parent": "I2", "child": "I1"}],
    "sources": [],
}


def _run_universal(after_tree):
    before = _empty_research_state()
    after = {**before, "tree_gedcomx_json": after_tree, "tree_gedcomx": after_tree}
    return run_validators(
        skill="x",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
    )


def _named(results, name):
    return next((r for r in results if r.name == name), None)


def test_no_duplicate_tree_ids_flags_a_repeat():
    dup = {
        **_VALID_TREE,
        "persons": _VALID_TREE["persons"]
        + [{"id": "I1", "gender": "Male", "names": [{"id": "N3", "given": "D", "surname": "B", "preferred": True}]}],
    }
    bad = _named(_run_universal(dup), "test_no_duplicate_tree_ids")
    assert bad is not None and not bad.passed, "a repeated person id must fail test_no_duplicate_tree_ids"
    ok = _named(_run_universal(_VALID_TREE), "test_no_duplicate_tree_ids")
    assert ok is not None and ok.passed


@pytest.mark.requires_engine_build
def test_full_validation_catches_reference_integrity():
    # Drives the compiled TS validateParsed via _run_universal; the marker skips
    # (never fails) when build/ is absent, matching the skip-not-fail contract.
    # A dangling ParentChild endpoint passes jsonschema but must fail full
    # validation (reference integrity jsonschema cannot express).
    dangling = {
        **_VALID_TREE,
        "relationships": [{"id": "R1", "type": "ParentChild", "parent": "GONE", "child": "I1"}],
    }
    bad = _named(_run_universal(dangling), "test_project_files_pass_full_validation")
    assert bad is not None and not bad.passed, "a dangling ParentChild endpoint must fail full validation"

    ok = _named(_run_universal(_VALID_TREE), "test_project_files_pass_full_validation")
    assert ok is not None and ok.passed, "a clean project must pass full validation"


@pytest.mark.requires_engine_build
def test_full_validation_catches_cross_file_subject_person_id():
    # #987 plan §2/§6: the most likely init-project defect — subject_person_ids
    # naming a person the tree does not contain (init-project hand-writes both).
    from harness.ts_validator import validate_parsed

    research = _empty_research_state()["research_json"]
    research = {**research, "project": {**research["project"], "subject_person_ids": ["I9"]}}
    errors = validate_parsed(research, _VALID_TREE)  # tree has I1/I2, not I9
    assert errors, "a subject_person_ids ref absent from the tree must fail"
    assert any("subject_person_ids" in e and "I9" in e for e in errors), errors


@pytest.mark.requires_engine_build
def test_validator_crash_is_not_reported_as_missing_build():
    # #987 review finding 1: a node crash (non-zero exit, empty stdout) must NOT
    # be reported as None ("build missing") and silently passed. A bare string in
    # persons trips a TypeError in the TS validator — exactly the malformed tree
    # this feature exists to catch.
    from harness.ts_validator import validate_parsed

    research = _empty_research_state()["research_json"]
    crash_tree = {"persons": ["I1"], "relationships": [], "sources": []}
    result = validate_parsed(research, crash_tree)
    assert result is not None, "a crash must not be reported as missing-build (None)"
    assert result, "a crash must surface a non-empty error"


# --- V1: write-then-validate -------------------------------------------

_CITATION_FRONTMATTER = {
    "name": "citation",
    "allowed-tools": ["research_append", "validate_research_schema"],
}


def _v1_states(modify_research):
    """State pair for V1 tests. `modify_research=True` makes after differ."""
    before = _empty_research_state()
    after = _empty_research_state()
    if modify_research:
        after["research_json"] = {
            **after["research_json"],
            "sources": [{"id": "src_001", "citation": "test"}],
        }
    return before, after


def test_write_then_validate_passes_when_validator_called():
    before, after = _v1_states(modify_research=True)
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[
            {"tool": "mcp__genealogy__research_append", "args": {}},
            {"tool": "mcp__genealogy__validate_research_schema", "args": {}},
        ],
        skill_frontmatter=_CITATION_FRONTMATTER,
    )
    result = next(
        (r for r in results if r.name == "test_write_then_validate"), None
    )
    assert result is not None, "test_write_then_validate did not run"
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_write_then_validate_fails_when_validator_missing():
    before, after = _v1_states(modify_research=True)
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[
            {"tool": "mcp__genealogy__research_append", "args": {}},
        ],
        skill_frontmatter=_CITATION_FRONTMATTER,
    )
    result = next(
        (r for r in results if r.name == "test_write_then_validate"), None
    )
    assert result is not None, "test_write_then_validate did not run"
    assert result.passed is False
    assert "validate_research_schema" in (result.error or "")


# --- V5: creator not in custody ----------------------------------------

def _v5_states(author_in_where_paren):
    """State pair for V5 tests. Both carry a tree with source authors."""
    tree = {
        "persons": [],
        "relationships": [],
        "sources": [
            {"id": "S1", "author": "County Recorder of Deeds"},
        ],
    }
    src_before = {
        "id": "src_001",
        "gedcomx_source_description_id": "S1",
        "citation": "",
        "citation_detail": {"who": "", "where": "FamilySearch.org"},
    }
    src_after = dict(src_before)
    if author_in_where_paren:
        src_after = {
            **src_after,
            "citation_detail": {
                "who": "",
                "where": "FamilySearch.org (County Recorder of Deeds, Pennsylvania)",
            },
        }
    else:
        src_after = {
            **src_after,
            "citation_detail": {
                "who": "County Recorder of Deeds",
                "where": "FamilySearch.org (Pennsylvania State Archives)",
            },
        }

    before = _empty_research_state()
    before["research_json"]["sources"] = [src_before]
    before["tree_gedcomx_json"] = tree
    before["tree_gedcomx"] = tree

    after = _empty_research_state()
    after["research_json"]["sources"] = [src_after]
    after["tree_gedcomx_json"] = tree
    after["tree_gedcomx"] = tree

    return before, after


def test_creator_not_in_custody_passes_on_clean():
    before, after = _v5_states(author_in_where_paren=False)
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
    )
    result = next(
        (r for r in results if r.name == "test_creator_not_in_custody"), None
    )
    assert result is not None, "test_creator_not_in_custody did not run"
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_creator_not_in_custody_fails_when_author_in_parenthetical():
    before, after = _v5_states(author_in_where_paren=True)
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
    )
    result = next(
        (r for r in results if r.name == "test_creator_not_in_custody"), None
    )
    assert result is not None, "test_creator_not_in_custody did not run"
    assert result.passed is False
    assert "custody" in (result.error or "").lower()
    assert "County Recorder of Deeds" in (result.error or "")


# --- V10: informant not in who ------------------------------------------

def _v10_states(informant_in_who):
    """State pair for V10 tests."""
    src_before = {
        "id": "src_001",
        "citation": "",
        "citation_detail": {"who": "Pennsylvania Department of Health"},
        "notes": "Informant is son-in-law James Brown.",
    }
    if informant_in_who:
        src_after = {
            **src_before,
            "citation_detail": {
                "who": "Pennsylvania Department of Health; informant: James Brown",
            },
        }
    else:
        src_after = dict(src_before)

    before = _empty_research_state()
    before["research_json"]["sources"] = [src_before]
    after = _empty_research_state()
    after["research_json"]["sources"] = [src_after]
    return before, after


def test_informant_not_in_who_passes_when_clean():
    before, after = _v10_states(informant_in_who=False)
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
    )
    result = next(
        (r for r in results if r.name == "test_informant_not_in_who"), None
    )
    assert result is not None, "test_informant_not_in_who did not run"
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_informant_not_in_who_fails_when_who_contains_informant():
    before, after = _v10_states(informant_in_who=True)
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
    )
    result = next(
        (r for r in results if r.name == "test_informant_not_in_who"), None
    )
    assert result is not None, "test_informant_not_in_who did not run"
    assert result.passed is False
    assert "informant" in (result.error or "").lower()


def test_informant_not_in_who_ignores_preexisting_informant():
    """Pre-existing 'informant' in who that the skill did not change must
    not trigger a false positive — the mid-research-flynn null-run case."""
    src = {
        "id": "src_004",
        "citation": "",
        "citation_detail": {
            "who": "Pennsylvania Department of Health; informant: James Brown",
        },
        "notes": "Informant is son-in-law James Brown.",
    }
    before = _empty_research_state()
    before["research_json"]["sources"] = [src]
    after = _empty_research_state()
    after["research_json"]["sources"] = [dict(src)]  # identical — skill changed nothing

    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
    )
    result = next(
        (r for r in results if r.name == "test_informant_not_in_who"), None
    )
    assert result is not None, "test_informant_not_in_who did not run"
    assert result.passed is True, (
        f"false positive on pre-existing informant data: {result.error}"
    )
# --- text_response plumbing (#1662) ------------------------------------
#
# A validator that reads the reply is inert if the harness stops supplying it.
# Because the natural guard inside such a validator is "no reply -> skip",
# that breakage reads as a pass, so these pin the wiring itself rather than
# any one validator's behaviour.

def test_text_response_reaches_a_validator(tmp_path):
    """`text_response` is injected by name, verbatim."""
    seen = {}
    module = tmp_path / "test_probe_skill.py"
    module.write_text(
        "def test_capture(text_response):\n"
        "    import json, pathlib\n"
        "    pathlib.Path(__file__).with_name('seen.json').write_text(\n"
        "        json.dumps({'reply': text_response}), encoding='utf-8')\n",
        encoding="utf-8",
    )
    results = run_validators(
        skill="probe-skill",
        validators_dir=tmp_path,
        before_state=_empty_research_state(),
        after_state=_empty_research_state(),
        tool_calls=[],
        text_response="Saved the Wikipedia summary to `x.md`.",
    )
    assert [r.name for r in results] == ["test_capture"], results
    assert results[0].passed, results[0].error
    seen = json.loads((tmp_path / "seen.json").read_text(encoding="utf-8"))
    assert seen["reply"] == "Saved the Wikipedia summary to `x.md`."


def test_text_response_defaults_to_empty_string_not_none(tmp_path):
    """Omitting it yields "" — so a validator can treat it as a string
    without a None guard, and an inert-because-unwired validator sees the
    same value it would see for a genuinely silent run."""
    module = tmp_path / "test_probe_skill.py"
    module.write_text(
        "def test_is_str(text_response):\n"
        "    assert isinstance(text_response, str)\n"
        "    assert text_response == ''\n",
        encoding="utf-8",
    )
    results = run_validators(
        skill="probe-skill",
        validators_dir=tmp_path,
        before_state=_empty_research_state(),
        after_state=_empty_research_state(),
        tool_calls=[],
    )
    assert results[0].passed, results[0].error


# The orchestrator end of this wiring is pinned behaviourally in
# test_orchestrator.py::test_orchestrator_passes_text_response_to_validators.
# A source grep was tried here first and is NOT sufficient: the string
# `text_response=result.text_response` appears three times in orchestrator.py
# (derive_activated, run_validators, grade), so asserting its presence stays
# green when the run_validators one specifically is removed.


# --- Tier-2 reporting mechanism (issue #1749) ----------------------------


def test_report_function_is_collected_and_marked_reporting_only(tmp_path):
    """report_* functions are collected with reporting_only=True."""
    module = tmp_path / "test_probe_skill.py"
    module.write_text(
        "def report_example_check(text_response):\n"
        "    assert 'hello' in text_response, 'no hello found'\n",
        encoding="utf-8",
    )
    results = run_validators(
        skill="probe-skill",
        validators_dir=tmp_path,
        before_state=_empty_research_state(),
        after_state=_empty_research_state(),
        tool_calls=[],
        text_response="hello world",
    )
    assert len(results) == 1
    assert results[0].name == "report_example_check"
    assert results[0].passed is True
    assert results[0].reporting_only is True


def test_report_finding_fires_on_assertion(tmp_path):
    """A report_* that raises AssertionError gets passed=False, reporting_only=True."""
    module = tmp_path / "test_probe_skill.py"
    module.write_text(
        "def report_example_check(text_response):\n"
        "    assert False, 'pattern X found in response'\n",
        encoding="utf-8",
    )
    results = run_validators(
        skill="probe-skill",
        validators_dir=tmp_path,
        before_state=_empty_research_state(),
        after_state=_empty_research_state(),
        tool_calls=[],
    )
    assert len(results) == 1
    r = results[0]
    assert r.passed is False
    assert r.reporting_only is True
    assert "pattern X found in response" in r.error


def test_report_finding_does_not_gate():
    """A failed report_* does not make compute_validators_passed() false."""
    from harness.orchestrator import compute_validators_passed

    results = [
        ValidatorRunResult(name="test_ok", passed=True, error=None),
        ValidatorRunResult(
            name="report_fired", passed=False,
            error="observation text", reporting_only=True,
        ),
    ]
    assert compute_validators_passed(results, intentionally_invalid=False) is True


def test_as_dicts_omits_reporting_only():
    """Reporting-only results don't appear in the run-log validators block."""
    results = [
        ValidatorRunResult(name="test_ok", passed=True, error=None),
        ValidatorRunResult(
            name="report_fired", passed=False,
            error="obs", reporting_only=True,
        ),
    ]
    dicts = as_dicts(results)
    assert len(dicts) == 1
    assert dicts[0]["name"] == "test_ok"


def test_new_args_are_injectable(tmp_path):
    """activated, num_turns, output_tokens, aborted_reason are available
    to validator functions."""
    module = tmp_path / "test_probe_skill.py"
    module.write_text(
        "def test_new_args(activated, num_turns, output_tokens, aborted_reason):\n"
        "    assert activated is True\n"
        "    assert num_turns == 5\n"
        "    assert output_tokens == 1000\n"
        "    assert aborted_reason is None\n",
        encoding="utf-8",
    )
    results = run_validators(
        skill="probe-skill",
        validators_dir=tmp_path,
        before_state=_empty_research_state(),
        after_state=_empty_research_state(),
        tool_calls=[],
        activated=True,
        num_turns=5,
        output_tokens=1000,
        aborted_reason=None,
    )
    assert len(results) == 1
    assert results[0].passed, results[0].error


def test_report_and_test_coexist(tmp_path):
    """Both test_* and report_* in the same file are collected."""
    module = tmp_path / "test_probe_skill.py"
    module.write_text(
        "def test_gating(text_response):\n"
        "    pass\n"
        "\n"
        "def report_advisory(text_response):\n"
        "    assert False, 'advisory finding'\n",
        encoding="utf-8",
    )
    results = run_validators(
        skill="probe-skill",
        validators_dir=tmp_path,
        before_state=_empty_research_state(),
        after_state=_empty_research_state(),
        tool_calls=[],
    )
    names = {r.name for r in results}
    assert "test_gating" in names
    assert "report_advisory" in names
    gating = [r for r in results if r.name == "test_gating"][0]
    advisory = [r for r in results if r.name == "report_advisory"][0]
    assert gating.reporting_only is False
    assert advisory.reporting_only is True


# --- V8: Activated run must produce a response ---------------------------

def test_v8_fires_on_dead_activated_run():
    """V8: activated=True, num_turns=0, output_tokens=0, short response → fail."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        num_turns=0,
        output_tokens=0,
        text_response="Short.",
        aborted_reason=None,
        skills_invoked=[],
    )
    result = _named(results, "test_activated_run_produces_response")
    assert result is not None, "test_activated_run_produces_response did not run"
    assert result.passed is False
    assert "no meaningful output" in (result.error or "")


def test_v8_passes_when_telemetry_present():
    """V8 passes when num_turns > 0 (work happened)."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        num_turns=3,
        output_tokens=500,
        text_response="Did some work.",
        aborted_reason=None,
    )
    result = _named(results, "test_activated_run_produces_response")
    assert result is not None
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_v8_passes_on_long_response_despite_missing_telemetry():
    """V8: if text_response >= 200 chars, pass even with zero telemetry."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        num_turns=0,
        output_tokens=0,
        text_response="A" * 200,
        aborted_reason=None,
        skills_invoked=[],
    )
    result = _named(results, "test_activated_run_produces_response")
    assert result is not None
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_v8_skips_when_not_activated():
    """V8 skips when activated is not True."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=False,
        num_turns=0,
        output_tokens=0,
        text_response="",
    )
    result = _named(results, "test_activated_run_produces_response")
    assert result is not None
    assert result.passed is True  # skipped = passed
    assert "skipped" in (result.error or "").lower()


def test_v8_passes_when_skills_invoked():
    """V8: a run that invoked a sub-skill is not a dead run, even with zero
    telemetry — skills_invoked is the direct signal."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        num_turns=0,
        output_tokens=0,
        text_response="Short routing announcement.",
        aborted_reason=None,
        skills_invoked=["citation"],
    )
    result = _named(results, "test_activated_run_produces_response")
    assert result is not None
    assert result.passed is True, f"unexpected failure: {result.error}"


# --- Anti-bias constraint (issue #1749) -----------------------------------

def test_judge_observations_carry_text_not_validator_names():
    """Anti-bias constraint (#1749): the judge sees the observation text,
    never the function name — a name is a verdict. And only fired findings
    appear — a passing report_* must not reach the judge."""
    results = [
        ValidatorRunResult(
            name="report_x", passed=False,
            error="the response names a volume", reporting_only=True,
        ),
        ValidatorRunResult(
            name="report_ok", passed=True,
            error=None, reporting_only=True,
        ),
        ValidatorRunResult(
            name="report_skipped", passed=True,
            error="skipped: not applicable", reporting_only=True,
        ),
    ]
    obs = split_observations(results)
    assert obs == ["the response names a volume"]
    # The function name must never leak into observation text
    assert not any("report_" in o for o in obs)


def _broken_validator_results(tmp_path, body: str):
    """Run one deliberately broken report_* through the real runner."""
    (tmp_path / "test_universal.py").write_text(
        "def test_ok():\n    pass\n", encoding="utf-8"
    )
    (tmp_path / "test_citation.py").write_text(body, encoding="utf-8")
    return run_validators(
        skill="citation",
        validators_dir=tmp_path,
        before_state={},
        after_state={},
        tool_calls=[],
        text_response="a normal answer",
    )


def test_report_with_bad_signature_gates_and_is_not_an_observation(tmp_path):
    """A report_* that declares an argument the harness does not supply is a
    validator bug, not a finding about the run.

    Left as reporting_only it would be invisible three ways over: it would not
    gate, as_dicts would drop it from the run log, and split_observations would
    hand the harness's own error text — the full arg roster included — to the
    judge under "Harness observations on the response text", which tells the
    judge to weigh it against the response. Standalone pytest cannot catch it
    either unless python_functions collects report_*.
    """
    from harness.orchestrator import compute_validators_passed

    results = _broken_validator_results(
        tmp_path,
        "def report_typo(text_response, skil_frontmatter):\n    pass\n",
    )
    broken = [r for r in results if r.name == "report_typo"]
    assert broken, f"report_typo did not run: {[r.name for r in results]}"
    assert broken[0].passed is False
    assert broken[0].reporting_only is False
    # It gates, it is recorded, and the judge is told nothing about it.
    assert compute_validators_passed(results, intentionally_invalid=False) is False
    assert "report_typo" in {d["name"] for d in as_dicts(results)}
    assert split_observations(results) == []


def test_report_that_crashes_gates_and_is_not_an_observation(tmp_path):
    """Same rule for a runtime crash: a TypeError is a validator bug, so it
    gates whatever the prefix, and its traceback text never reaches the judge.
    """
    from harness.orchestrator import compute_validators_passed

    results = _broken_validator_results(
        tmp_path,
        "def report_crashes(text_response):\n    return text_response['nope']\n",
    )
    broken = [r for r in results if r.name == "report_crashes"]
    assert broken, f"report_crashes did not run: {[r.name for r in results]}"
    assert broken[0].passed is False
    assert broken[0].reporting_only is False
    assert "TypeError" in (broken[0].error or "")
    assert compute_validators_passed(results, intentionally_invalid=False) is False
    assert split_observations(results) == []


def test_a_genuine_report_finding_still_reports(tmp_path):
    """The guard above must not swallow the tier-2 mechanism itself: an
    AssertionError from a report_* is a finding, so it still does not gate and
    still reaches the judge as anonymous text."""
    from harness.orchestrator import compute_validators_passed

    results = _broken_validator_results(
        tmp_path,
        "def report_real_finding(text_response):\n"
        "    raise AssertionError('the response names a volume')\n",
    )
    fired = [r for r in results if r.name == "report_real_finding"]
    assert fired and fired[0].reporting_only is True
    assert compute_validators_passed(results, intentionally_invalid=False) is True
    assert split_observations(results) == ["the response names a volume"]
    assert "report_real_finding" not in {d["name"] for d in as_dicts(results)}


def test_standalone_pytest_collects_report_validators():
    """python_functions must collect report_* or `pytest validators/ -v` — the
    debugging path unit-test-spec.md points developers at — silently runs none
    of the tier-2 validators."""
    import tomllib
    from pathlib import Path

    pyproject = Path(__file__).resolve().parents[2] / "pyproject.toml"
    cfg = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    patterns = cfg["tool"]["pytest"]["ini_options"]["python_functions"]
    assert "report_*" in patterns, (
        "pytest collects only "
        f"{patterns} — every report_* validator is invisible to "
        "`pytest eval/harness/validators/ -v`"
    )


# --- V7: In-body decline tests -------------------------------------------

def test_v7a_decline_nonempty_fires_on_empty_response():
    """V7(a): activated negative test with empty response → fail."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        text_response="",
        test={"type": "negative", "negative": {"correct_skill": ["citation"]}},
    )
    result = _named(results, "test_decline_response_nonempty")
    assert result is not None
    assert result.passed is False
    assert "empty response" in (result.error or "")


def test_v7a_passes_with_nonempty_response():
    """V7(a): activated negative test with response → pass."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        text_response="I'll route this to the citation skill.",
        test={"type": "negative", "negative": {"correct_skill": ["citation"]}},
    )
    result = _named(results, "test_decline_response_nonempty")
    assert result is not None
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_v7b_report_names_skill_fires_when_missing():
    """V7(b): decline response that doesn't name the correct skill → report fires."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        text_response="I can help you with that request.",
        test={"type": "negative", "negative": {"correct_skill": ["citation"]}},
    )
    result = _named(results, "report_decline_names_routed_skill")
    assert result is not None
    assert result.reporting_only is True
    assert result.passed is False
    assert "citation" in (result.error or "")


def test_v7b_report_passes_when_skill_named():
    """V7(b): decline response naming the correct skill → pass."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        text_response="I'll route this to the citation skill for formatting.",
        test={"type": "negative", "negative": {"correct_skill": ["citation"]}},
    )
    result = _named(results, "report_decline_names_routed_skill")
    assert result is not None
    assert result.passed is True


def test_v7c_report_commitment_fires():
    """V7(c): first-person commitment to out-of-scope act → report fires."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        text_response="I'll create the source record and format the citation.",
        test={"type": "negative", "negative": {"correct_skill": ["citation"]}},
    )
    result = _named(results, "report_decline_no_first_person_commitment")
    assert result is not None
    assert result.reporting_only is True
    assert result.passed is False


def test_v7c_passes_when_no_commitment():
    """V7(c): no first-person commitment → pass."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        text_response="The citation skill handles source formatting.",
        test={"type": "negative", "negative": {"correct_skill": ["citation"]}},
    )
    result = _named(results, "report_decline_no_first_person_commitment")
    assert result is not None
    assert result.passed is True


def test_v7_skips_on_grade_on_invariant():
    """V7 all parts skip on grade_on_invariant tests per lead's ruling."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        activated=True,
        text_response="",
        test={
            "type": "negative",
            "negative": {
                "correct_skill": ["citation"],
                "grade_on_invariant": True,
            },
        },
    )
    for name in ("test_decline_response_nonempty",
                 "report_decline_names_routed_skill",
                 "report_decline_no_first_person_commitment"):
        result = _named(results, name)
        assert result is not None, f"{name} did not run"
        assert result.passed is True, f"{name} should skip (pass) on grade_on_invariant"
        assert "skipped" in (result.error or "").lower()


# --- V2: No unbacked validation claim ------------------------------------

def test_v2_fires_on_unbacked_claim():
    """V2: response claims validation but no validate call → report fires."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[
            {"tool": "mcp__genealogy__research_append", "args": {}},
        ],
        text_response="I've written the source to research.json (validated ✓).",
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "report_unbacked_validation_claim")
    assert result is not None
    assert result.reporting_only is True
    assert result.passed is False
    assert "validate_research_schema" in (result.error or "")


def test_v2_passes_when_validate_called():
    """V2: response claims validation AND validate was called → pass."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[
            {"tool": "mcp__genealogy__research_append", "args": {}},
            {"tool": "mcp__genealogy__validate_research_schema", "args": {}},
        ],
        text_response="I've written the source to research.json (validated ✓).",
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "report_unbacked_validation_claim")
    assert result is not None
    assert result.passed is True


def test_v2_passes_when_no_validation_language():
    """V2: response without validation language → pass (nothing to flag)."""
    state = _empty_research_state()
    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        text_response="I've updated the research notes.",
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "report_unbacked_validation_claim")
    assert result is not None
    assert result.passed is True


# --- V3: No invented locators (citation-specific) ------------------------

def _v3_states(before_locators, after_locators):
    """State pair for V3 tests with locator values in citation fields."""
    src_before = {
        "id": "src_001",
        "citation": before_locators.get("citation", ""),
        "citation_detail": {
            "who": "",
            "where": before_locators.get("where", ""),
            "where_within": before_locators.get("where_within", ""),
        },
        "notes": before_locators.get("notes", ""),
    }
    src_after = {
        "id": "src_001",
        "citation": after_locators.get("citation", ""),
        "citation_detail": {
            "who": "",
            "where": after_locators.get("where", ""),
            "where_within": after_locators.get("where_within", ""),
        },
        "notes": after_locators.get("notes", ""),
    }
    before = _empty_research_state()
    before["research_json"]["sources"] = [src_before]
    after = _empty_research_state()
    after["research_json"]["sources"] = [src_after]
    return before, after


def test_v3_persisted_fires_on_invented_locator():
    """V3 persisted: a locator numeral not in the before-state → fail."""
    before, after = _v3_states(
        before_locators={"notes": "Searched for records in the county."},
        after_locators={"where_within": "Will Book 7, p. 214"},
    )
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "test_no_invented_locators_persisted")
    assert result is not None
    assert result.passed is False
    assert "on-file data" in (result.error or "")


def test_v3_persisted_passes_on_known_locator():
    """V3 persisted: a locator numeral present in the before-state → pass."""
    before, after = _v3_states(
        before_locators={"notes": "Will Book 12, p. 45"},
        after_locators={"where_within": "Will Book 12, p. 45"},
    )
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "test_no_invented_locators_persisted")
    assert result is not None
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_v3_response_fires_on_invented_locator():
    """V3 response: a locator numeral not in the before-state → report fires."""
    before, _ = _v3_states(
        before_locators={"notes": "Searched county records."},
        after_locators={},
    )
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=_empty_research_state(),
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        text_response="Check Will Book 7, p. 214 for the record.",
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "report_invented_locators_response")
    assert result is not None
    assert result.reporting_only is True
    assert result.passed is False


# --- V4: Skill example values in persisted / response ---------------------


def test_v4_persisted_does_not_fire_on_digit_superstring():
    r"""V4 persisted: `pp. 88` in the deny list must not match `pp. 880-884`.

    The digit-boundary bug: a plain `in` check sees `88` inside `880`, so any
    harvested value fires on its next-digit sibling. The fix adds a negative
    lookahead `(?!\d)` after the escaped value."""
    before = _empty_research_state()
    after = _empty_research_state()
    # The source must exist in before so V4 checks it.
    before["research_json"]["sources"] = [{
        "id": "src_001", "citation": "", "citation_detail": {}, "notes": "",
    }]
    # The after-state persists a citation with `pp. 880-884`, which is NOT the
    # example value `pp. 88` — it just happens to contain the substring.
    after["research_json"]["sources"] = [{
        "id": "src_001",
        "citation": "Some County, Will Book 41, pp. 880-884",
        "citation_detail": {"who": "", "where": "", "where_within": "pp. 880-884"},
        "notes": "",
    }]
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "test_no_skill_example_values_persisted")
    if result is None:
        pytest.skip("V4 validator did not run (SKILL.md may be absent)")
    assert result.passed is True, (
        f"V4 false-flagged a digit superstring: {result.error}"
    )


def test_v4_persisted_fires_on_exact_example_value():
    """V4 persisted: an exact example value from SKILL.md → fail."""
    before = _empty_research_state()
    after = _empty_research_state()
    # The source must exist in before (empty fields) so V4 checks its after
    # fields — it only inspects sources that already existed, not new ones.
    before["research_json"]["sources"] = [{
        "id": "src_001", "citation": "", "citation_detail": {}, "notes": "",
    }]
    # `Will Book 9` and `p. 113` are both in the harvested deny list.
    after["research_json"]["sources"] = [{
        "id": "src_001",
        "citation": "Some County, Will Book 9, p. 113",
        "citation_detail": {"who": "", "where": "", "where_within": "p. 113"},
        "notes": "",
    }]
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "test_no_skill_example_values_persisted")
    if result is None:
        pytest.skip("V4 validator did not run (SKILL.md may be absent)")
    assert result.passed is False
    assert "example values from SKILL.md" in (result.error or "")


def test_v4_persisted_passes_when_example_value_on_file_in_log():
    """V4 persisted: a deny-list value present in a before-state log entry's
    notes is subtracted and does not fire — the log entry is on-file data."""
    before = _empty_research_state()
    after = _empty_research_state()
    # The source must exist in before so V4 checks it.
    before["research_json"]["sources"] = [{
        "id": "src_001", "citation": "", "citation_detail": {}, "notes": "",
    }]
    # Put the example value in the before-state log notes so it is on file.
    before["research_json"]["log"] = [
        {"notes": "Searched Will Book 9, p. 113 in the county office."}
    ]
    after["research_json"]["sources"] = [{
        "id": "src_001",
        "citation": "Some County, Will Book 9, p. 113",
        "citation_detail": {"who": "", "where": "", "where_within": "p. 113"},
        "notes": "",
    }]
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "test_no_skill_example_values_persisted")
    if result is None:
        pytest.skip("V4 validator did not run (SKILL.md may be absent)")
    assert result.passed is True, (
        f"V4 fired despite the value being on file in log notes: {result.error}"
    )


# --- V12: No framework walkthrough (citation-specific) --------------------

def test_v12_fires_on_field_label_headings():
    """V12: 3+ field labels as headings outside code blocks → report fires."""
    state = _empty_research_state()
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        text_response=(
            "Here's the citation breakdown:\n"
            "**Who**: County Recorder\n"
            "**What**: Death certificate\n"
            "**When created**: 1923\n"
            "**Where**: Pennsylvania\n"
        ),
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "report_no_framework_walkthrough")
    assert result is not None
    assert result.reporting_only is True
    assert result.passed is False
    assert "field labels as headings" in (result.error or "")


def test_v12_passes_when_labels_inside_code_block():
    """V12: field labels inside a fenced code block → pass."""
    state = _empty_research_state()
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        text_response=(
            "Here's the citation:\n"
            "```json\n"
            '{"who": "Recorder", "what": "Certificate", '
            '"when_created": "1923", "where": "PA"}\n'
            "```\n"
        ),
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "report_no_framework_walkthrough")
    assert result is not None
    assert result.passed is True, f"unexpected failure: {result.error}"


def test_v12_passes_when_fewer_than_three_labels():
    """V12: fewer than 3 field labels as headings → pass."""
    state = _empty_research_state()
    results = run_validators(
        skill="citation",
        validators_dir=VALIDATORS_DIR,
        before_state=state,
        after_state=state,
        tool_calls=[],
        skill_frontmatter=_CITATION_FRONTMATTER,
        text_response="**Who**: Recorder\n**Where**: PA\n",
        test={"type": "positive", "tags": []},
    )
    result = _named(results, "report_no_framework_walkthrough")
    assert result is not None
    assert result.passed is True, f"unexpected failure: {result.error}"
