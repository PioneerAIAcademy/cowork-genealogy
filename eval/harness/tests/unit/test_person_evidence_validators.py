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

import json
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
    assert "no same_person call scored that pairing" in str(exc.value)
    assert "pe_010" in str(exc.value)
    assert "pe_011" in str(exc.value)


def test_scored_passes_when_every_persona_was_scored():
    """Both scored personas need their own call. The single-call version of this
    test used to pass, which was the per-run hole item 1 of the #1882 review
    caught: `_N7V_AFTER` links F1 and M1, so one call attests only half."""
    check_scored(
        _state(_N7V_BEFORE, _tree("I1", "I2")),
        _state(_N7V_AFTER, _tree("I1", "I2")),
        [_call("same_person", primaryId1="F1", primaryId2="I2"),
         _call("same_person", primaryId1="M1", primaryId2="I2"),
         _call("research_append")],
    )


def test_scored_fires_when_only_one_of_two_personas_was_scored():
    """The half-attested shape, pinned as a failure."""
    with pytest.raises(AssertionError) as exc:
        check_scored(
            _state(_N7V_BEFORE, _tree("I1", "I2")),
            _state(_N7V_AFTER, _tree("I1", "I2")),
            [_call("same_person", primaryId1="F1", primaryId2="I2")],
        )
    assert "pe_011" in str(exc.value)
    assert "pe_010" not in str(exc.value)


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
            [],
            _CW_TAGGED,
        )
    assert "ran no impossibility check" in str(exc.value)
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
            [],
            _CW_TAGGED,
        )
    assert "minted ['I4']" in str(exc.value)


def test_check_warnings_passes_when_invoked():
    check_warnings_after_write(
        _state(_LINKED_BEFORE, _tree("I1", "I2")),
        _state(_LINKED_AFTER, _tree("I1", "I2")),
        ["person-evidence", "check-warnings"],
        [],
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
            [],
            _CW_TAGGED,
        )


def test_check_warnings_stands_down_on_a_negative_test():
    """A declined routing test has no research.json diff to read."""
    with pytest.raises(pytest.skip.Exception):
        check_warnings_after_write(_state(None), _state(None), [], [], _CW_TAGGED)


def test_check_warnings_stands_down_without_the_tag():
    """Tag-gated: an untagged test must not be failed by it, which is what
    keeps the measured-but-unenforced ungated rate out of the suite."""
    with pytest.raises(pytest.skip.Exception):
        check_warnings_after_write(
            _state(_LINKED_BEFORE, _tree("I1", "I2")),
            _state(_LINKED_AFTER, _tree("I1", "I2")),
            ["person-evidence"],
            [],
            {"tags": []},
        )


def test_check_warnings_passes_when_the_agent_calls_the_tool_itself():
    """The route the paired agent actually takes. Since 2026-09-02 the agent
    calls `person_warnings` directly rather than the router invoking
    `check-warnings`, because `/research` may spawn a paired agent straight and
    nothing guarantees the router runs. Keyed on `skills_invoked` alone this
    assertion would fail every compliant agent run."""
    check_warnings_after_write(
        _state(_LINKED_BEFORE, _tree("I1", "I2")),
        _state(_LINKED_AFTER, _tree("I1", "I2")),
        ["person-evidence"],
        [{"tool": "mcp__genealogy__person_warnings"}],
        _CW_TAGGED,
    )


def test_check_warnings_accepts_the_tool_under_any_server_spelling():
    """The prefix is chosen by whoever registers the server, so a bare-name
    match on the qualified tool is the only form that works in all three."""
    for spelling in (
        "person_warnings",
        "mcp__genealogy__person_warnings",
        "mcp__remote-devices__Genealogy_Research__person_warnings",
        "mcp__Genealogy_Research__person_warnings",
    ):
        check_warnings_after_write(
            _state(_LINKED_BEFORE, _tree("I1", "I2")),
            _state(_LINKED_AFTER, _tree("I1", "I2")),
            ["person-evidence"],
            [{"tool": spelling}],
            _CW_TAGGED,
        )


# --- Pinning tests (review of #1882, item 3) ----------------------------
#
# The failing-input cases above prove each assertion fires. These pin the
# load-bearing CONSTANTS and the per-persona matching, so an edit that guts a
# validator goes red instead of staying green. Three mutations were confirmed
# to survive the original 17: adding "death" to _UNMATERIALIZABLE, dropping
# "age" from it, and broadening validator 1 to accept a `record_search` call as
# the attestation (which makes it a no-op, since every record-search test calls
# record_search).


def test_scored_fires_per_persona_not_per_run():
    """Pins the per-persona match on two INDEPENDENT identity claims — two
    `name` personas, no `matchRelatives` call. Goes red if the assertion is
    weakened back to "a same_person call exists anywhere".

    Deliberately not a household: SKILL.md §2.4 pairs a household in ONE
    `matchRelatives: true` call whose relative scores live in the response, so
    demanding a call per relative would fail the compliant path. An earlier
    version of this test described itself as the household case and so pinned
    that false-fail as correct (caught in review of #1882);
    `test_scored_stands_down_on_a_matchRelatives_household` now pins the
    opposite."""
    after = {
        "assertions": [
            {"id": "a_1", "record_persona_id": "P1", "fact_type": "name"},
            {"id": "a_2", "record_persona_id": "P2", "fact_type": "name"},
        ],
        "person_evidence": [
            {"id": "pe_1", "assertion_id": "a_1", "person_id": "I1"},
            {"id": "pe_2", "assertion_id": "a_2", "person_id": "I2"},
        ],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    with pytest.raises(AssertionError) as exc:
        check_scored(
            _state(before, _tree("I1", "I2")),
            _state(after, _tree("I1", "I2")),
            [_call("same_person", primaryId1="P1", primaryId2="I1")],
        )
    assert "a_2/P2 -> I2" in str(exc.value)
    assert "pe_1" not in str(exc.value)


def test_scored_fires_when_the_only_call_scored_an_unrelated_pairing():
    """A `same_person` call for a different persona/candidate is not an
    attestation for this one."""
    after = {
        "assertions": [{"id": "a_1", "record_persona_id": "P1", "fact_type": "name"}],
        "person_evidence": [{"id": "pe_1", "assertion_id": "a_1", "person_id": "I1"}],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    with pytest.raises(AssertionError):
        check_scored(
            _state(before, _tree("I1", "I9")),
            _state(after, _tree("I1", "I9")),
            [_call("same_person", primaryId1="P9", primaryId2="I9")],
        )


def test_scored_accepts_a_transposed_call():
    """primaryId1/primaryId2 the other way round still scored the pairing."""
    after = {
        "assertions": [{"id": "a_1", "record_persona_id": "P1", "fact_type": "name"}],
        "person_evidence": [{"id": "pe_1", "assertion_id": "a_1", "person_id": "I1"}],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    check_scored(
        _state(before, _tree("I1")),
        _state(after, _tree("I1")),
        [_call("same_person", primaryId1="I1", primaryId2="P1")],
    )


def test_scored_is_not_satisfied_by_another_matching_tool():
    """Pins that the attestation is `same_person` specifically, not any matching
    tool. The call here carries the exact primaryId pair, so broadening the tool
    match — e.g. to anything containing "match" or "search" — WOULD satisfy the
    check and this test goes red. An earlier version passed a `record_search`
    call with no primaryIds, which no widening could have satisfied, so it
    pinned nothing."""
    after = {
        "assertions": [{"id": "a_1", "record_persona_id": "P1", "fact_type": "name"}],
        "person_evidence": [{"id": "pe_1", "assertion_id": "a_1", "person_id": "I1"}],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    with pytest.raises(AssertionError):
        check_scored(
            _state(before, _tree("I1")),
            _state(after, _tree("I1")),
            [_call("person_person_matches", primaryId1="P1", primaryId2="I1"),
             _call("research_append")],
        )


def test_materialized_survives_a_stringified_ops_payload():
    """`materialize_facts` recovers a JSON-string `ops` via coerceJsonArg and the
    mock records the raw model args, so the validator must too. Iterating the
    string used to raise AttributeError, which validator_runner turns into a
    FAILED validator — a false gate that also deletes the judge scores."""
    check_materialized(
        _state(_DEATH_BEFORE, _tree("I1")),
        _state(_DEATH_AFTER, _tree("I1")),
        [_call("materialize_facts", ops=json.dumps(
            [{"personId": "I1", "recordId": "ark:/61903/1:1:MDEF",
              "recordRole": "deceased"}])),
         _call("research_append")],
        _TAGGED,
    )


def test_materialized_still_fires_on_an_unparseable_ops_string():
    """A malformed `ops` string must not silently satisfy the check."""
    with pytest.raises(AssertionError):
        check_materialized(
            _state(_DEATH_BEFORE, _tree("I1")),
            _state(_DEATH_AFTER, _tree("I1")),
            [_call("materialize_facts", ops="{not json")],
            _TAGGED,
        )


def test_unmaterializable_pins_death_as_owed():
    """Pins `death` OUT of _UNMATERIALIZABLE: a death-only persona linked to an
    existing person is owed a materialize. Goes red if `death` is added to the
    set (a mutation the original 17 survived)."""
    after = {
        "assertions": [{"id": "a_11", "record_persona_id": None, "fact_type": "death"}],
        "person_evidence": [{"id": "pe_7", "assertion_id": "a_11", "person_id": "I1"}],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    # A skip here is the mutation surviving, not a pass: adding "death" to the
    # set makes the check stand down, and pytest reports that as skipped rather
    # than failed. Convert it to a failure explicitly.
    try:
        check_materialized(
            _state(before, _tree("I1")),
            _state(after, _tree("I1")),
            [_call("research_append")],
            _TAGGED,
        )
    except pytest.skip.Exception:
        pytest.fail(
            "a death-only persona linked to an existing person was treated as "
            "owing nothing — 'death' must NOT be in _UNMATERIALIZABLE"
        )
    except AssertionError as exc:
        assert "I1" in str(exc)
    else:
        pytest.fail("expected the materialize check to fire and it did not")


def test_unmaterializable_pins_age_as_not_owed():
    """Pins `age` IN _UNMATERIALIZABLE: the tool skips that fact_type, so
    nothing is owed. Goes red if `age` is dropped from the set."""
    after = {
        "assertions": [{"id": "a_9", "record_persona_id": None, "fact_type": "age"}],
        "person_evidence": [{"id": "pe_9", "assertion_id": "a_9", "person_id": "I1"}],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    with pytest.raises(pytest.skip.Exception):
        check_materialized(
            _state(before, _tree("I1")),
            _state(after, _tree("I1")),
            [],
            _TAGGED,
        )


# --- Re-scope pins (second review of #1882) ----------------------------
#
# The per-persona match is right for an identity claim, but the precondition it
# ran under was too broad and fired on compliant runs. Each test below pins one
# exclusion; without them the validator false-fails a PASSING run.


def test_scored_ignores_a_relationship_assertion():
    """The n7v shape, and the one that was actually breaking. `a_004` is
    `fact_type: relationship` on the GROOM persona G1 ("child of Thomas") and
    links to the FATHER I1. The identity match runs through the parent persona
    (F1->I1), which the passing runs call; demanding same_person(G1, I1) would
    compare the groom to his father. Replaying the pre-fix validator against the
    passing v1_2026-08-12_17-18-54 n7v run fired on exactly this."""
    after = {
        "assertions": [
            {"id": "a_004", "record_persona_id": "G1", "fact_type": "relationship"},
            {"id": "a_006", "record_persona_id": "F1", "fact_type": "name"},
        ],
        "person_evidence": [
            {"id": "pe_4", "assertion_id": "a_004", "person_id": "I1"},
            {"id": "pe_6", "assertion_id": "a_006", "person_id": "I1"},
        ],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    # F1->I1 is scored; the relationship link to the same person is not owed one.
    check_scored(
        _state(before, _tree("I1", "I2")),
        _state(after, _tree("I1", "I2")),
        [_call("same_person", primaryId1="F1", primaryId2="I1")],
    )


def test_scored_still_fires_on_a_name_assertion_beside_a_relationship_one():
    """Excluding relationship types must not blunt the check: the persona's own
    `name` assertion still carries the demand."""
    after = {
        "assertions": [
            {"id": "a_004", "record_persona_id": "G1", "fact_type": "relationship"},
            {"id": "a_006", "record_persona_id": "F1", "fact_type": "name"},
        ],
        "person_evidence": [
            {"id": "pe_4", "assertion_id": "a_004", "person_id": "I1"},
            {"id": "pe_6", "assertion_id": "a_006", "person_id": "I1"},
        ],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    with pytest.raises(AssertionError) as exc:
        check_scored(
            _state(before, _tree("I1", "I2")),
            _state(after, _tree("I1", "I2")),
            [_call("research_append")],
        )
    assert "a_006/F1 -> I1" in str(exc.value)
    assert "a_004" not in str(exc.value)


def test_scored_stands_down_on_a_matchRelatives_household():
    """SKILL.md §2.4 pairs a household in one `matchRelatives: true` call and
    returns the relative scores in the RESPONSE's `matches` array, which this
    tier does not record (F4). The pairings are unreadable from args, so the
    check must stand down rather than demand a call per relative."""
    after = {
        "assertions": [
            {"id": "a_1", "record_persona_id": "P1", "fact_type": "name"},
            {"id": "a_2", "record_persona_id": "P2", "fact_type": "name"},
        ],
        "person_evidence": [
            {"id": "pe_1", "assertion_id": "a_1", "person_id": "I1"},
            {"id": "pe_2", "assertion_id": "a_2", "person_id": "I2"},
        ],
    }
    before = {"assertions": after["assertions"], "person_evidence": []}
    with pytest.raises(pytest.skip.Exception):
        check_scored(
            _state(before, _tree("I1", "I2")),
            _state(after, _tree("I1", "I2")),
            [_call("same_person", primaryId1="P1", primaryId2="I1",
                   matchRelatives=True)],
        )


def test_scored_stands_down_when_the_log_entry_has_no_results_ref():
    """SKILL.md §2: a search predating result retention has `results_ref: null`,
    so `gedcomx1` cannot be built and correlation stands alone."""
    after = {
        "assertions": [{"id": "a_1", "record_persona_id": "P1",
                        "fact_type": "name", "log_entry_id": "log_009"}],
        "person_evidence": [{"id": "pe_1", "assertion_id": "a_1", "person_id": "I1"}],
        "log": [{"id": "log_009", "results_ref": None}],
    }
    before = {"assertions": after["assertions"], "person_evidence": [],
              "log": after["log"]}
    with pytest.raises(pytest.skip.Exception):
        check_scored(_state(before, _tree("I1")), _state(after, _tree("I1")), [])


def test_scored_still_fires_when_the_log_entry_has_a_results_ref():
    """The mirror of the above — a sidecar exists, so the score is owed."""
    after = {
        "assertions": [{"id": "a_1", "record_persona_id": "P1",
                        "fact_type": "name", "log_entry_id": "log_001"}],
        "person_evidence": [{"id": "pe_1", "assertion_id": "a_1", "person_id": "I1"}],
        "log": [{"id": "log_001", "results_ref": "results/log_001.json"}],
    }
    before = {"assertions": after["assertions"], "person_evidence": [],
              "log": after["log"]}
    with pytest.raises(AssertionError):
        check_scored(_state(before, _tree("I1")), _state(after, _tree("I1")), [])
