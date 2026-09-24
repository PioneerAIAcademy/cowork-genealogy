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
    test_stub_person_created_and_linked as check_stub,
    report_informant_fields_not_in_pe_confidence_reason as check_informant,
    report_chronological_contradiction_not_speculative as check_chrono,
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


def test_scored_accepts_the_project_relative_call_shape():
    """The cheap call (issue #1731) names its two sides by reference and carries
    no `primaryId1`/`primaryId2`, so `_same_person_pairs` has to credit it from
    `recordPersonaId`/`treePersonId`. Without that arm this check fails on every
    call in the new shape, which judge-skips the whole run.

    Pinned because the arm was added with nothing exercising it: setting
    `p2 = args.get("treePersonId")` to `None` broke no test at all.
    """
    check_scored(
        _state(_N7V_BEFORE, _tree("I1", "I2")),
        _state(_N7V_AFTER, _tree("I1", "I2")),
        [_call("same_person", projectPath="/p", assertionId="a_005",
               recordPersonaId="F1", treePersonId="I2"),
         _call("same_person", projectPath="/p", assertionId="a_008",
               recordPersonaId="M1", treePersonId="I2"),
         _call("research_append")],
    )


def test_scored_credits_the_second_party_named_by_role():
    """`recordRole` names the OTHER party of a relationship assertion, so the
    party being scored is not the assertion's own persona.

    Measured live on `ut_person_evidence_n7v`: scoring the father as the second
    party of the groom's relationship assertion resolved the GROOM's persona
    (`G1`) against the required `F1`, so a correct call went uncredited and the
    validator gate judge-skipped the run. `rubric.md` Score discipline
    prescribes exactly this call shape for a second party, so the check has to
    honour it.

    The converse is pinned below: a role no assertion on the record holds must
    still not credit the pairing.
    """
    by_role = [
        {"id": "a_004", "record_id": "r1", "record_role": "groom",
         "record_persona_id": "G1"},
        {"id": "a_006", "record_id": "r1", "record_role": "father_of_groom",
         "record_persona_id": "F1"},
    ]
    from validators.test_person_evidence import _same_person_pairs

    assertions = {a["id"]: a for a in by_role}
    call = {"tool": "mcp__genealogy__same_person",
            "args": {"projectPath": "/p", "assertionId": "a_004",
                     "treePersonId": "I1", "recordRole": "father_of_groom"}}
    assert ("F1", "I1") in _same_person_pairs([call], assertions)

    unheld = {"tool": "mcp__genealogy__same_person",
              "args": {"projectPath": "/p", "assertionId": "a_004",
                       "treePersonId": "I1", "recordRole": "witness"}}
    assert ("F1", "I1") not in _same_person_pairs([unheld], assertions)


def test_scored_credits_the_assertions_own_persona_on_a_role_form_call():
    """A role-form call attests BOTH personas, and which one the consumer asks
    about depends on the pe_ entry, not on the call.

    Measured live in `v1_2026-09-24_06-11-11`: `ut_person_evidence_013` called
    `{assertionId: a_003, treePersonId: I2, recordRole: head_of_household}` and
    linked a_003 (persona VP1) to I2, so the consumer wanted `(VP1, I2)` -- the
    assertion's OWN persona. Resolving only the role's persona, which is what
    the n7v fix shipped, produced `(head_of_household, I2)` and failed a correct
    call. n7v wants the opposite resolution, so both are indexed.
    """
    from validators.test_person_evidence import _same_person_pairs

    assertions = {
        "a_003": {"id": "a_003", "record_id": "r1", "record_role": "visiting_person",
                  "record_persona_id": "VP1"},
        "a_009": {"id": "a_009", "record_id": "r1", "record_role": "head_of_household",
                  "record_persona_id": "HH1"},
    }
    call = {"tool": "mcp__genealogy__same_person",
            "args": {"projectPath": "/p", "assertionId": "a_003",
                     "treePersonId": "I2", "recordRole": "head_of_household"}}
    pairs = _same_person_pairs([call], assertions)
    assert ("VP1", "I2") in pairs, "the assertion's own persona must be credited"
    assert ("HH1", "I2") in pairs, "the named second party must be credited too"
    # Neither of them against a tree person the call never named.
    assert ("VP1", "I9") not in pairs
    assert ("HH1", "I9") not in pairs


def test_fts_accepts_a_score_backed_by_a_project_relative_call():
    """The live false-positive this replaced.

    `ut_person_evidence_011` called
    `{assertionId: "a_004", treePersonId: "I1"}`, recorded 0.005, and was
    flagged as fabricating the score. A full-text assertion has
    `record_persona_id: null` by definition, so the persona-pair helper could
    resolve no record party and contributed no pair, making the call invisible.
    """
    from validators.test_person_evidence import test_fts_assertion_no_score as check_fts

    before = {"assertions": [{"id": "a_004", "record_persona_id": None}], "person_evidence": []}
    after = {
        "assertions": before["assertions"],
        "person_evidence": [
            {"id": "pe_001", "assertion_id": "a_004", "person_id": "I1",
             "confidence": "probable", "match_score": 0.005},
        ],
    }
    call = {"tool": "mcp__genealogy__same_person",
            "args": {"projectPath": "/p", "assertionId": "a_004", "treePersonId": "I1"}}
    # Backed by a real call: must NOT fire.
    check_fts(_state(before), _state(after), {"tags": ["no-score-fallback"]}, [call])

    # The other direction: a score with no call anywhere still fires.
    with pytest.raises(AssertionError) as exc:
        check_fts(_state(before), _state(after), {"tags": ["no-score-fallback"]}, [])
    assert "pe_001" in str(exc.value)


def test_scored_accepts_the_DEFAULT_project_relative_shape_with_no_record_party():
    """The shape the agent actually sends, and the one that broke.

    `{projectPath, assertionId, treePersonId}` carries no `recordPersonaId` and
    no `recordRole`, so the record side has to be RESOLVED from the assertion.
    An earlier arm fell back to `treePersonId` for both sides, recording the
    pair `("I2","I2")`, which can never equal `(record_persona_id, person_id)`:
    the check then reported "no same_person call scored that pairing" for every
    link while the agent was scoring all of them. That shipped and failed six
    tests in one run.

    The sibling test above passes `recordPersonaId` explicitly, which is
    precisely why it did not catch this.
    """
    check_scored(
        _state(_N7V_BEFORE, _tree("I1", "I2")),
        _state(_N7V_AFTER, _tree("I1", "I2")),
        [_call("same_person", projectPath="/p", assertionId="a_005", treePersonId="I2"),
         _call("same_person", projectPath="/p", assertionId="a_008", treePersonId="I2"),
         _call("research_append")],
    )


def test_scored_still_fires_when_a_project_relative_call_covers_only_one_persona():
    """The other direction: the new arm must not turn the check into a rubber
    stamp. One cheap call attests one pairing, not both."""
    with pytest.raises(AssertionError) as exc:
        check_scored(
            _state(_N7V_BEFORE, _tree("I1", "I2")),
            _state(_N7V_AFTER, _tree("I1", "I2")),
            [_call("same_person", projectPath="/p", assertionId="a_005",
                   recordPersonaId="F1", treePersonId="I2")],
        )
    assert "pe_011" in str(exc.value)
    assert "pe_010" not in str(exc.value)


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
    """materialize_facts skips `relationship`, `marriage` and `age` as facts of
    the persona they sit on (SKIP_TYPES in materialize-facts.ts), so a persona
    carrying only those has nothing owed. Its named-party arm mints the OTHER
    party such an assertion names, which is a different person and a name
    rather than a fact, so it owes this persona nothing either. This is
    `ut_person_evidence_022`'s shape."""
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


# --- report_informant_fields_not_in_pe_confidence_reason ------------------
#
# The pe_005 conflation: rationale for a pe_ confidence tier cites informant-
# quality fields (information_quality / informant_proximity) instead of
# identity-corroboration evidence.

_INFORMANT_BEFORE = {"assertions": [{"id": "a_001"}], "person_evidence": []}
_INFORMANT_AFTER_BAD = {
    "assertions": [{"id": "a_001"}],
    "person_evidence": [
        {
            "id": "pe_001",
            "assertion_id": "a_001",
            "person_id": "I1",
            "confidence": "confident",
            "rationale": (
                "The information_quality is primary and informant was present "
                "at the event, so this source is considered highly reliable."
            ),
        }
    ],
}
_INFORMANT_AFTER_GOOD = {
    "assertions": [{"id": "a_001"}],
    "person_evidence": [
        {
            "id": "pe_001",
            "assertion_id": "a_001",
            "person_id": "I1",
            "confidence": "probable",
            "rationale": (
                "Name and approximate birth year match; single source with no "
                "corroboration — probable, not confident."
            ),
        }
    ],
}


def test_informant_fires_on_information_quality_in_rationale():
    """The pe_005 conflation shape: rationale cites information_quality."""
    with pytest.raises(AssertionError) as exc:
        check_informant(
            _state(_INFORMANT_BEFORE),
            _state(_INFORMANT_AFTER_BAD),
        )
    assert "information_quality" in str(exc.value)
    assert "pe_001" in str(exc.value)


def test_informant_fires_on_informant_proximity_in_rationale():
    """Both banned terms are caught, not just the first one."""
    after = {
        "assertions": [{"id": "a_002"}],
        "person_evidence": [
            {
                "id": "pe_002",
                "assertion_id": "a_002",
                "person_id": "I2",
                "confidence": "probable",
                "rationale": "informant_proximity is high; original registrant present.",
            }
        ],
    }
    with pytest.raises(AssertionError) as exc:
        check_informant(
            _state({"assertions": [{"id": "a_002"}], "person_evidence": []}),
            _state(after),
        )
    assert "informant_proximity" in str(exc.value)
    assert "pe_002" in str(exc.value)


def test_informant_passes_when_rationale_uses_identity_evidence():
    """A rationale citing name, age, and location does not trip the check."""
    check_informant(
        _state(_INFORMANT_BEFORE),
        _state(_INFORMANT_AFTER_GOOD),
    )


def test_informant_ignores_pre_existing_pe_entries():
    """The check is new-only: a pre-existing entry with the bad wording must not
    retroactively fail a run that did not touch it."""
    pre_existing = {
        "assertions": [{"id": "a_001"}],
        "person_evidence": [
            {
                "id": "pe_001",
                "assertion_id": "a_001",
                "person_id": "I1",
                "confidence": "confident",
                "rationale": "information_quality is primary — existing entry.",
            }
        ],
    }
    # After state is identical to before — no new pe_ entries.
    check_informant(_state(pre_existing), _state(pre_existing))


def test_informant_stands_down_without_research_json():
    with pytest.raises(pytest.skip.Exception):
        check_informant(_state(None), _state(None))


# --- report_chronological_contradiction_not_speculative -------------------
#
# The ut_024 shape: a Kilrush baptism christening dated 1858 is linked at
# `probable` to a tree person born ~1845 — a 13-year gap that rules out the
# same birth event. Irish Catholic baptisms follow birth within days.

def _tree_with_birth(person_id: str, birth_year: int) -> dict:
    return {
        "persons": [
            {
                "id": person_id,
                "facts": [{"type": "Birth", "date": str(birth_year)}],
            }
        ]
    }


def _sp_call_with_gedcomx(
    persona_id: str, tree_person_id: str, fact_type: str, fact_date: str
) -> dict:
    """Build a same_person tool-call dict with embedded GedcomX facts."""
    return {
        "tool": "mcp__genealogy__same_person",
        "args": {
            "primaryId1": persona_id,
            "primaryId2": tree_person_id,
            "gedcomx1": {
                "persons": [
                    {
                        "id": persona_id,
                        "facts": [{"type": fact_type, "date": fact_date}],
                    }
                ]
            },
            "gedcomx2": {
                "persons": [{"id": tree_person_id, "facts": []}]
            },
        },
    }


# The ut_024 observation: BP1 (christening 1858) linked at probable to I1
# (birth ~1845), gap = 13 years.
_CHRONO_BEFORE = {
    "assertions": [
        {"id": "a_001", "record_persona_id": "BP1"},
    ],
    "person_evidence": [],
}
_CHRONO_AFTER_BAD = {
    "assertions": _CHRONO_BEFORE["assertions"],
    "person_evidence": [
        {
            "id": "pe_001",
            "assertion_id": "a_001",
            "person_id": "I1",
            "confidence": "probable",
            "rationale": "Name and record match.",
        }
    ],
}
_CHRONO_TREE_1845 = _tree_with_birth("I1", 1845)
_CHRONO_SP_CALL = _sp_call_with_gedcomx("BP1", "I1", "Christening", "12 March 1858")


def test_chrono_fires_on_13yr_gap_at_probable():
    """The ut_024 shape: 13-year gap at probable must fire."""
    with pytest.raises(AssertionError) as exc:
        check_chrono(
            _state(_CHRONO_BEFORE, _CHRONO_TREE_1845),
            _state(_CHRONO_AFTER_BAD, _CHRONO_TREE_1845),
            [_CHRONO_SP_CALL],
        )
    assert "pe_001" in str(exc.value)
    assert "1858" in str(exc.value)
    assert "1845" in str(exc.value)


def test_chrono_still_fires_on_the_project_relative_call_shape():
    """The same 13-year gap, scored with the cheap call (issue #1731).

    That shape names its two sides by reference and carries no `gedcomx1`, so
    reading facts out of the call args yields nothing and this check would go
    permanently silent the moment the agent adopted it. The fallback rebuilds
    the record party's facts from the project's own assertions, which is the
    same grouping the engine's projection uses.
    """
    before = {
        "assertions": [
            {
                "id": "a_001",
                "record_id": "ark:/61903/1:1:KILR-B58",
                "record_role": "child_1",
                "record_persona_id": None,
                "fact_type": "christening",
                "date": "12 March 1858",
            }
        ],
        "person_evidence": [],
    }
    after = {
        "assertions": before["assertions"],
        "person_evidence": [
            {
                "id": "pe_001",
                "assertion_id": "a_001",
                "person_id": "I1",
                "confidence": "probable",
                "rationale": "Name and record match.",
            }
        ],
    }
    sp_call = {
        "tool": "mcp__genealogy__same_person",
        "args": {"projectPath": "/p", "assertionId": "a_001", "treePersonId": "I1"},
    }
    with pytest.raises(AssertionError) as exc:
        check_chrono(
            _state(before, _CHRONO_TREE_1845),
            _state(after, _CHRONO_TREE_1845),
            [sp_call],
        )
    assert "pe_001" in str(exc.value)
    assert "1858" in str(exc.value)
    assert "1845" in str(exc.value)


def test_chrono_ignores_an_absent_role_when_rebuilding_from_assertions():
    """`record_role: "absent"` is negative evidence describing no persona, so it
    must not supply a date the check then contradicts a tree person with."""
    before = {
        "assertions": [
            {
                "id": "a_001",
                "record_id": "ark:/61903/1:1:KILR-B58",
                "record_role": "absent",
                "record_persona_id": None,
                "fact_type": "christening",
                "date": "12 March 1858",
            }
        ],
        "person_evidence": [],
    }
    after = {
        "assertions": before["assertions"],
        "person_evidence": [
            {
                "id": "pe_001",
                "assertion_id": "a_001",
                "person_id": "I1",
                "confidence": "probable",
                "rationale": "Name and record match.",
            }
        ],
    }
    sp_call = {
        "tool": "mcp__genealogy__same_person",
        "args": {"projectPath": "/p", "assertionId": "a_001", "treePersonId": "I1"},
    }
    check_chrono(
        _state(before, _CHRONO_TREE_1845),
        _state(after, _CHRONO_TREE_1845),
        [sp_call],
    )


def test_chrono_fires_on_13yr_gap_at_confident():
    """Confident links with the same gap also fire."""
    after = {
        "assertions": _CHRONO_BEFORE["assertions"],
        "person_evidence": [
            {
                "id": "pe_001",
                "assertion_id": "a_001",
                "person_id": "I1",
                "confidence": "confident",
                "rationale": "Strong match.",
            }
        ],
    }
    with pytest.raises(AssertionError) as exc:
        check_chrono(
            _state(_CHRONO_BEFORE, _CHRONO_TREE_1845),
            _state(after, _CHRONO_TREE_1845),
            [_CHRONO_SP_CALL],
        )
    assert "pe_001" in str(exc.value)


def test_chrono_passes_when_confidence_is_speculative():
    """`speculative` explicitly acknowledges the uncertainty — not flagged."""
    after = {
        "assertions": _CHRONO_BEFORE["assertions"],
        "person_evidence": [
            {
                "id": "pe_001",
                "assertion_id": "a_001",
                "person_id": "I1",
                "confidence": "speculative",
                "rationale": "Dates do not align — speculative only.",
            }
        ],
    }
    check_chrono(
        _state(_CHRONO_BEFORE, _CHRONO_TREE_1845),
        _state(after, _CHRONO_TREE_1845),
        [_CHRONO_SP_CALL],
    )


def test_chrono_passes_when_gap_is_within_threshold():
    """A 3-year gap (within the 5-year threshold) is not flagged."""
    sp_call = _sp_call_with_gedcomx("BP1", "I1", "Christening", "1848")
    check_chrono(
        _state(_CHRONO_BEFORE, _CHRONO_TREE_1845),
        _state(_CHRONO_AFTER_BAD, _CHRONO_TREE_1845),
        [sp_call],
    )


def test_chrono_passes_when_no_same_person_call_exists():
    """Without a same_person call there is no embedded date to check."""
    check_chrono(
        _state(_CHRONO_BEFORE, _CHRONO_TREE_1845),
        _state(_CHRONO_AFTER_BAD, _CHRONO_TREE_1845),
        [],
    )


def test_chrono_passes_when_tree_has_no_birth_fact():
    """If the tree person carries no birth year we cannot compute a gap."""
    tree_no_birth = {"persons": [{"id": "I1", "facts": []}]}
    check_chrono(
        _state(_CHRONO_BEFORE, tree_no_birth),
        _state(_CHRONO_AFTER_BAD, tree_no_birth),
        [_CHRONO_SP_CALL],
    )


def test_chrono_passes_when_record_persona_has_no_birth_class_fact():
    """If the record persona has no birth/christening fact there is nothing to compare."""
    sp_call = _sp_call_with_gedcomx("BP1", "I1", "Residence", "12 March 1858")
    check_chrono(
        _state(_CHRONO_BEFORE, _CHRONO_TREE_1845),
        _state(_CHRONO_AFTER_BAD, _CHRONO_TREE_1845),
        [sp_call],
    )


def test_chrono_fires_on_uri_fact_type():
    """URI fact types (http://gedcomx.org/Christening) must be matched the same
    as bare names — 9 of 10 facts in v1_2026-09-15_08-11-26.json use this form."""
    sp_call = _sp_call_with_gedcomx(
        "BP1", "I1", "http://gedcomx.org/Christening", "12 March 1858"
    )
    with pytest.raises(AssertionError) as exc:
        check_chrono(
            _state(_CHRONO_BEFORE, _CHRONO_TREE_1845),
            _state(_CHRONO_AFTER_BAD, _CHRONO_TREE_1845),
            [sp_call],
        )
    assert "pe_001" in str(exc.value)


def test_chrono_fires_on_dict_date():
    """Dict dates ({\"original\": \"abt 1845\"}) must not cause TypeError — the same
    corpus carries this form on both record and tree facts."""
    sp_call = _sp_call_with_gedcomx(
        "BP1", "I1", "http://gedcomx.org/Christening", {"original": "12 March 1858"}
    )
    tree = {
        "persons": [
            {
                "id": "I1",
                "facts": [{"type": "http://gedcomx.org/Birth", "date": {"original": "abt 1845"}}],
            }
        ]
    }
    with pytest.raises(AssertionError) as exc:
        check_chrono(
            _state(_CHRONO_BEFORE, tree),
            _state(_CHRONO_AFTER_BAD, tree),
            [sp_call],
        )
    assert "pe_001" in str(exc.value)


def test_chrono_fires_when_record_persona_id_is_null():
    """The flynn-baptism-names-mother shape: assertion has no record_persona_id
    (came from record_read with no search sidecar), so the validator must fall
    back to scanning sp_by_pair by person_id rather than skipping silently."""
    before = {
        "assertions": [{"id": "a_002"}],  # record_persona_id absent/null
        "person_evidence": [],
    }
    after = {
        "assertions": before["assertions"],
        "person_evidence": [
            {
                "id": "pe_002",
                "assertion_id": "a_002",
                "person_id": "I1",
                "confidence": "confident",
                "rationale": "Name match.",
            }
        ],
    }
    with pytest.raises(AssertionError) as exc:
        check_chrono(
            _state(before, _CHRONO_TREE_1845),
            _state(after, _CHRONO_TREE_1845),
            [_CHRONO_SP_CALL],  # primaryId1=BP1, primaryId2=I1 — same_person call exists
        )
    assert "pe_002" in str(exc.value)
    assert "1858" in str(exc.value)


def test_chrono_stands_down_without_research_json():
    with pytest.raises(pytest.skip.Exception):
        check_chrono(_state(None), _state(None), [])


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


# --- check_stub: the minted-by rule ---------------------------------------
#
# The eval suite does not exercise this assertion: neutering it left
# `make harness-test` at an identical pass count. It is also the one most worth
# a meta-test, because its first version was DEFEATED in review. That version
# checked the after-state for "a name with some ref", and `tree_edit
# add_person` copies a caller-supplied `names[].sources` through untouched (its
# mandatory-ref guard covers inline FACTS only), so a hand-written ref naming
# the wrong record passed the guard meant to catch exactly that.

_STUB_TAG = {"tags": ["stub-creation"]}
_SOURCED = [{"id": "N3", "given": "Mary", "surname": "Doyle",
             "sources": [{"ref": "S5", "quality": 3}]}]
_BARE = [{"id": "N3", "given": "Mary", "surname": "Doyle"}]
_MF_NAMED = [{"tool": "mcp__genealogy__materialize_facts",
              "args": {"assertionId": "a_005", "relatedRole": "bride"}}]
_MF_PERSONA = [{"tool": "mcp__genealogy__materialize_facts",
                "args": {"recordId": "REC", "recordRole": "mother"}}]
_ADD_PERSON = [{"tool": "mcp__genealogy__tree_edit",
                "args": {"operation": "add_person", "person": {"gender": "Female"}}}]


def _stub_verdict(names, calls, test=None):
    """True when the check accepts. A downstream skip counts as acceptance: it
    means a LATER, unrelated rule (match_score reachability) skipped."""
    person = {"id": "I1", "gender": "Male",
              "names": [{"id": "N1", "given": "Thomas", "surname": "Flynn"}]}
    assertions = [{"id": "a_005", "record_persona_id": None, "fact_type": "name"}]
    before = _state({"assertions": assertions, "person_evidence": [], "log": []},
                    {"persons": [person]})
    after = _state({"assertions": assertions,
                    "person_evidence": [{"id": "pe_9", "assertion_id": "a_005",
                                         "person_id": "I3", "match_score": None}],
                    "log": []},
                   {"persons": [person, {"id": "I3", "gender": "Female",
                                         "names": names}]})
    try:
        check_stub(before, after, calls, test or _STUB_TAG)
        return True
    except AssertionError:
        return False
    except BaseException as exc:  # pytest.skip
        if type(exc).__name__.endswith("Skipped"):
            return True
        raise


@pytest.mark.parametrize("calls", [_MF_NAMED, _MF_PERSONA])
def test_stub_accepts_either_materialize_arm(calls):
    """Both arms resolve the ref from the assertion, so both are correct on an
    untagged stub-creation fixture. (Until the `named-party` gate below existed
    these two cases asserted the same thing: the check read only the tool name,
    never the args, so the parametrization was decorative.)"""
    assert _stub_verdict(_SOURCED, calls) is True


_NAMED_PARTY_TAG = {"tags": ["stub-creation", "named-party"]}


def test_named_party_fixture_requires_the_named_party_ARM():
    """The one behaviour this change introduces. Without this, nothing
    distinguishes branch 3 from branch 2 and the arm goes unverified by
    anything but a human reading a transcript."""
    assert _stub_verdict(_SOURCED, _MF_NAMED, test=_NAMED_PARTY_TAG) is True
    # the persona form is the WRONG arm on a fixture the record gives no persona
    assert _stub_verdict(_SOURCED, _MF_PERSONA, test=_NAMED_PARTY_TAG) is False


def test_stub_rejects_add_person_carrying_a_hand_written_ref():
    """The defeat this check was rewritten for: the ref can name any record."""
    assert _stub_verdict(_SOURCED, _ADD_PERSON) is False


def test_stub_rejects_add_person_with_no_ref():
    assert _stub_verdict(_BARE, _ADD_PERSON) is False


def test_stub_rejects_add_person_used_alongside_materialize_facts():
    """Calling the right tool somewhere does not license the wrong one here."""
    assert _stub_verdict(_SOURCED, _MF_NAMED + _ADD_PERSON) is False


def test_stub_rejects_a_mint_with_no_tool_call_at_all():
    assert _stub_verdict(_SOURCED, []) is False


def test_stub_accepts_a_tree_edit_that_merely_mentions_add_person():
    """False-fail guard. The first version matched "add_person" anywhere in the
    serialized args, so an unrelated tree_edit whose text happens to contain the
    word was refused. A check that blocks correct work is worse than the gap."""
    mentions = [
        {"tool": "mcp__genealogy__tree_edit",
         "args": {"operation": "add_fact",
                  "fact": {"type": "Occupation", "value": "clerk (not via add_person)"}}},
    ]
    assert _stub_verdict(_SOURCED, _MF_NAMED + mentions) is True


def test_stub_still_catches_add_person_inside_a_BATCH():
    """The batch form is how this skill is told to write, so the check has to
    see into `ops[]` rather than only the flat call."""
    batched = [{"tool": "mcp__genealogy__tree_edit",
                "args": {"ops": [{"operation": "add_relationship"},
                                 {"operation": "add_person", "person": {"gender": "Female"}}]}}]
    assert _stub_verdict(_SOURCED, _MF_NAMED + batched) is False


def test_stub_catches_add_person_inside_a_STRINGIFIED_batch():
    """The shape a hand-rolled isinstance(list) check misses. The mock records
    raw model args and models do stringify a large `ops`, which is why the
    shared `_ops_arg` recovers it; a private normalizer that did not would let
    a disallowed mint through silently."""
    stringified = [{"tool": "mcp__genealogy__tree_edit",
                    "args": {"ops": '[{"operation": "add_person", "person": {"gender": "Female"}}]'}}]
    assert _stub_verdict(_SOURCED, _MF_NAMED + stringified) is False
