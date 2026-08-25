"""Direct tests for the person-evidence validators added by deep dive #1646.

Same reason as `test_search_familysearch_wiki_validators.py`: `pyproject.toml`
sets `testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.
Each assertion is exercised against a state that must pass, the specific state
observed failing in a committed run log, and the preconditions under which it
must stand down rather than fire.

The violating states are drawn from the #1646 deep dive:
  - `ut_person_evidence_n7v`, run `v1_2026-08-20_15-53-03` — 9 of 9 assertions
    on `flynn-marriage-parent-match` carry a `record_persona_id`, no
    `same_person` call is made, and eleven `pe_` entries land, three of them at
    `confident` with a null `match_score`.
  - the materialization gap recorded on #1646 on 2026-08-22 — a single-person
    record matched to a person already in the tree gets a `pe_` link and no
    facts, because SKILL.md covered materialization only for a NEW person (§5)
    and for a household (§7.3).
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validators as tests of this module and error on their
# harness-supplied fixtures. Same pattern as test_init_project_validator.py.
from test_person_evidence import (  # noqa: E402
    test_check_warnings_runs_after_a_write as check_warnings_after_write,
    test_matched_persona_is_materialized_onto_its_person as check_materialized,
    test_same_person_called_when_persona_meets_existing_candidate as check_scored,
)


def _state(research, tree=None):
    return {
        "research_json": research,
        "tree_gedcomx_json": tree,
        "tree_gedcomx": None,
        "files": {},
        "skill_frontmatter": {},
    }


def _tree(*person_ids):
    return {"persons": [{"id": pid} for pid in person_ids]}


def _call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args}


# --- test_same_person_called_when_persona_meets_existing_candidate ------

# The n7v shape: record-search personas linked to tree persons that already
# existed, written at `confident` with no score behind them.
_N7V_AFTER = {
    "assertions": [
        {"id": "a_005", "record_persona_id": "F1", "fact_type": "name"},
        {"id": "a_008", "record_persona_id": "M1", "fact_type": "birth"},
    ],
    "person_evidence": [
        {"id": "pe_010", "assertion_id": "a_005", "person_id": "I2",
         "confidence": "confident", "match_score": None},
        {"id": "pe_011", "assertion_id": "a_008", "person_id": "I2",
         "confidence": "confident", "match_score": None},
    ],
}
_N7V_BEFORE = {"assertions": _N7V_AFTER["assertions"], "person_evidence": []}


def test_scored_fires_on_the_n7v_state():
    """The observed failure must actually fail."""
    with pytest.raises(AssertionError) as exc:
        check_scored(
            _state(_N7V_BEFORE, _tree("I1", "I2")),
            _state(_N7V_AFTER, _tree("I1", "I2")),
            [_call("research_append")],
        )
    assert "same_person was never called" in str(exc.value)
    assert "pe_010" in str(exc.value)


def test_scored_passes_when_same_person_was_called():
    check_scored(
        _state(_N7V_BEFORE, _tree("I1", "I2")),
        _state(_N7V_AFTER, _tree("I1", "I2")),
        [_call("same_person", primaryId1="F1", primaryId2="I2"),
         _call("research_append")],
    )


def test_scored_stands_down_when_persona_is_null():
    """FTS-, image- and PDF-sourced assertions have no score to obtain —
    SKILL.md §2. `ut_person_evidence_011`, `_022` and `_014` all look like
    skips until you check the assertion they actually linked."""
    after = {
        "assertions": [{"id": "a_004", "record_persona_id": None,
                        "fact_type": "relationship"}],
        "person_evidence": [{"id": "pe_009", "assertion_id": "a_004",
                             "person_id": "I1"}],
    }
    with pytest.raises(pytest.skip.Exception):
        check_scored(
            _state({"assertions": after["assertions"], "person_evidence": []}, _tree("I1")),
            _state(after, _tree("I1")),
            [],
        )


def test_scored_stands_down_when_the_person_is_newly_minted():
    """A person this run created is not an identity match against an existing
    candidate, so no score is owed."""
    after = {
        "assertions": [{"id": "a_001", "record_persona_id": "P1", "fact_type": "name"}],
        "person_evidence": [{"id": "pe_020", "assertion_id": "a_001", "person_id": "I9"}],
    }
    with pytest.raises(pytest.skip.Exception):
        check_scored(
            _state({"assertions": after["assertions"], "person_evidence": []}, _tree("I1")),
            _state(after, _tree("I1", "I9")),
            [],
        )


def test_scored_stands_down_without_research_json():
    with pytest.raises(pytest.skip.Exception):
        check_scored(_state(None), _state(None), [])


# --- test_matched_persona_is_materialized_onto_its_person ---------------

_TAGGED = {"tags": ["materialize"]}
_CW_TAGGED = {"tags": ["check-warnings-required"]}

# The death-certificate shape: a_011/a_012 on src_004 linked to Patrick (I1),
# who is already in the tree.
_DEATH_AFTER = {
    "assertions": [
        {"id": "a_011", "record_persona_id": None, "fact_type": "death"},
        {"id": "a_012", "record_persona_id": None, "fact_type": "birth"},
    ],
    "person_evidence": [
        {"id": "pe_007", "assertion_id": "a_011", "person_id": "I1"},
        {"id": "pe_008", "assertion_id": "a_012", "person_id": "I1"},
    ],
}
_DEATH_BEFORE = {"assertions": _DEATH_AFTER["assertions"], "person_evidence": []}


def test_materialized_fires_when_only_the_pe_link_lands():
    """The gap itself: links written, facts never materialized."""
    with pytest.raises(AssertionError) as exc:
        check_materialized(
            _state(_DEATH_BEFORE, _tree("I1", "I2")),
            _state(_DEATH_AFTER, _tree("I1", "I2")),
            [_call("research_append")],
            _TAGGED,
        )
    assert "never called materialize_facts" in str(exc.value)
    assert "I1" in str(exc.value)


def test_materialized_passes_on_the_flat_call_form():
    check_materialized(
        _state(_DEATH_BEFORE, _tree("I1", "I2")),
        _state(_DEATH_AFTER, _tree("I1", "I2")),
        [_call("materialize_facts", personId="I1",
               recordId="ark:/61903/1:1:MDEF", recordRole="deceased"),
         _call("research_append")],
        _TAGGED,
    )


def test_materialized_passes_on_the_batched_ops_form():
    """SKILL.md §7.3 requires one batched call per record, so the ops[] shape
    is the one a household run actually emits."""
    check_materialized(
        _state(_DEATH_BEFORE, _tree("I1", "I2")),
        _state(_DEATH_AFTER, _tree("I1", "I2")),
        [_call("materialize_facts", ops=[
            {"personId": "I1", "recordId": "ark:/61903/1:1:MDEF",
             "recordRole": "deceased"},
        ])],
        _TAGGED,
    )


def test_materialized_stands_down_on_unmaterializable_fact_types():
    """materialize_facts skips `relationship`, `marriage` and `age` outright
    (SKIP_TYPES in materialize-facts.ts), so a persona carrying only those has
    nothing owed. This is `ut_person_evidence_022`'s shape."""
    after = {
        "assertions": [{"id": "a_005", "record_persona_id": None,
                        "fact_type": "marriage"}],
        "person_evidence": [{"id": "pe_012", "assertion_id": "a_005",
                             "person_id": "I2"}],
    }
    with pytest.raises(pytest.skip.Exception):
        check_materialized(
            _state({"assertions": after["assertions"], "person_evidence": []}, _tree("I2")),
            _state(after, _tree("I2")),
            [],
            _TAGGED,
        )


def test_materialized_stands_down_when_the_person_is_new():
    """§5 already owns the newly minted case and its own validator checks it."""
    after = {
        "assertions": [{"id": "a_005", "record_persona_id": None, "fact_type": "name"}],
        "person_evidence": [{"id": "pe_013", "assertion_id": "a_005", "person_id": "I4"}],
    }
    with pytest.raises(pytest.skip.Exception):
        check_materialized(
            _state({"assertions": after["assertions"], "person_evidence": []}, _tree("I1")),
            _state(after, _tree("I1", "I4")),
            [],
            _TAGGED,
        )


def test_materialized_stands_down_without_the_tag():
    with pytest.raises(pytest.skip.Exception):
        check_materialized(
            _state(_DEATH_BEFORE, _tree("I1")),
            _state(_DEATH_AFTER, _tree("I1")),
            [],
            {"tags": []},
        )


# --- test_check_warnings_runs_after_a_write -----------------------------
#
# Violating states are real: `_014` (v1_2026-08-20_15-53-03) minted a stub
# and linked it with skills_invoked == ["person-evidence"]; `_002`
# (v1_2026-08-24_18-17-08) wrote a pe_ entry with the same. Five different
# tests skipped it across those two runs, each scoring 3 on all eight
# dimensions in the run where it skipped.

_LINKED_AFTER = {
    "assertions": [{"id": "a_010", "record_persona_id": None, "fact_type": "relationship"}],
    "person_evidence": [{"id": "pe_009", "assertion_id": "a_010", "person_id": "I2"}],
}
_LINKED_BEFORE = {"assertions": _LINKED_AFTER["assertions"], "person_evidence": []}


def test_check_warnings_fires_when_links_were_written():
    with pytest.raises(AssertionError) as exc:
        check_warnings_after_write(
            _state(_LINKED_BEFORE, _tree("I1", "I2")),
            _state(_LINKED_AFTER, _tree("I1", "I2")),
            ["person-evidence"],
            _CW_TAGGED,
        )
    assert "never invoked check-warnings" in str(exc.value)
    assert "1 new pe_ entr" in str(exc.value)


def test_check_warnings_fires_when_a_person_was_minted_without_links():
    """`_014`'s shape is a mint; the trigger must not depend on pe_ entries
    alone, because the stub is exactly what needs the impossibility check."""
    same = {"assertions": [], "person_evidence": []}
    with pytest.raises(AssertionError) as exc:
        check_warnings_after_write(
            _state(same, _tree("I1")),
            _state(same, _tree("I1", "I4")),
            ["person-evidence"],
            _CW_TAGGED,
        )
    assert "minted ['I4']" in str(exc.value)


def test_check_warnings_passes_when_invoked():
    check_warnings_after_write(
        _state(_LINKED_BEFORE, _tree("I1", "I2")),
        _state(_LINKED_AFTER, _tree("I1", "I2")),
        ["person-evidence", "check-warnings"],
        _CW_TAGGED,
    )


def test_check_warnings_stands_down_on_a_read_only_run():
    """A review/audit invocation writes nothing, so §8 has nothing to cover.
    This is `ut_person_evidence_015`'s shape."""
    same = {"assertions": [], "person_evidence": [{"id": "pe_001"}]}
    with pytest.raises(pytest.skip.Exception):
        check_warnings_after_write(
            _state(same, _tree("I1")),
            _state(same, _tree("I1")),
            ["person-evidence"],
            _CW_TAGGED,
        )


def test_check_warnings_stands_down_on_a_negative_test():
    """A declined routing test has no research.json diff to read."""
    with pytest.raises(pytest.skip.Exception):
        check_warnings_after_write(_state(None), _state(None), [], _CW_TAGGED)


def test_check_warnings_stands_down_without_the_tag():
    """Tag-gated: an untagged test must not be failed by it, which is what
    keeps the measured-but-unenforced ungated rate out of the suite."""
    with pytest.raises(pytest.skip.Exception):
        check_warnings_after_write(
            _state(_LINKED_BEFORE, _tree("I1", "I2")),
            _state(_LINKED_AFTER, _tree("I1", "I2")),
            ["person-evidence"],
            {"tags": []},
        )
