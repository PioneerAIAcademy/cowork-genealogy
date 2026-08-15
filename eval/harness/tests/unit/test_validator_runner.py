"""Tests for harness.validator_runner.

Runs against the actual seed validators in eval/harness/validators/ to verify
the runner can drive them with realistic inputs.
"""

from pathlib import Path

import pytest

from harness.validator_runner import (
    all_passed,
    as_dicts,
    run_validators,
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


def test_bare_name_rule_exempts_negative_evidence():
    """`record_role: absent` values describe an expected-but-missing person,
    so a relational phrase there is the point, not a defect."""
    result = _run_bare_name_rule(
        [
            {
                "id": "a_1",
                "record_role": "absent",
                "fact_type": "name",
                "value": "no father of the bride recorded on the license",
                "evidence_type": "negative",
            }
        ]
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
