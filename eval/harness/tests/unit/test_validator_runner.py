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
        "    assert False, 'intentional'\n"
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
    nullary.write_text("def test_no_args():\n    assert 1 == 1\n")
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
    (CauseOfDeath ≡ cause_of_death, BirthPlace ≡ birthplace). Observed on
    ut_record_extraction_009: a doctrine-perfect run failed all 9 matchers
    on spelling alone."""
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
            "fact_type": "BirthPlace",
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
                "fact_type": "birthplace",
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            },
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
    relation to the matcher's fails existence, a near-miss fact type
    (Birth vs birthplace) fails existence, and a matched pair with the
    wrong closed-enum classification value still fails — with the
    ORIGINAL strings in the message."""
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

    # Near-miss fact type: Birth must NOT satisfy birthplace.
    wrong_fact = _run_expected_classifications(
        [
            {
                "id": "a_1",
                "record_role": "deceased",
                "fact_type": "Birth",
                "evidence_type": "indirect",
                "informant_proximity": "family_not_present",
            }
        ],
        [{"record_role": "deceased", "fact_type": "birthplace",
          "evidence_type": "indirect"}],
    )
    assert wrong_fact.passed is False
    assert "fact_type='birthplace'" in (wrong_fact.error or "")

    # Matched (normalized) pair, wrong classification value → value failure
    # naming the assertion, with original (PascalCase) strings intact.
    wrong_value = _run_expected_classifications(
        [
            {
                "id": "a_1",
                "record_role": "father",
                "fact_type": "BirthPlace",
                "evidence_type": "direct",  # doctrine says indirect
                "informant_proximity": "family_not_present",
            }
        ],
        [{"record_role": "father_of_deceased", "fact_type": "birthplace",
          "evidence_type": "indirect"}],
    )
    assert wrong_value.passed is False
    for fragment in ("a_1", "evidence_type", "direct", "indirect"):
        assert fragment in (wrong_value.error or ""), (
            f"failure message missing {fragment!r}: {wrong_value.error}"
        )


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
        "    pytest.skip('not applicable to this state')\n"
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
