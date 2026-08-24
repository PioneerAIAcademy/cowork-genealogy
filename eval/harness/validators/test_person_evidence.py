"""Skill-specific validators for the person-evidence skill.

These check structural invariants that should hold for every
person-evidence test, regardless of the specific test case.

See test_universal.py module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

person-evidence creates / updates entries in `research.json.person_evidence`,
linking assertions (in research.json) to persons (in tree.gedcomx.json).
Ownership of the `person_evidence` section is enforced by
test_universal.py::test_ownership_table; this file holds the structural
rules + tag-gated regression checks.
"""

from __future__ import annotations

import pytest

from validators_lib import (
    assert_foreign_keys_valid,
    assert_no_section_deletions,
)


# --- Append-only / no-delete on the owned section ---

def test_person_evidence_no_deletions(before_state, after_state):
    """Existing person_evidence entries must not be deleted.

    person-evidence may modify in place (e.g., upgrade confidence after
    new evidence comes in) but must not drop entries — that would erase
    the evidence trail back to a person.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "person_evidence")


# --- Foreign-key integrity for new person_evidence entries ---

def test_new_person_evidence_references_valid_assertion(before_state, after_state):
    """Every new person_evidence entry's assertion_id must resolve.

    The whole point of person_evidence is to bind an assertion to a
    person; a dangling assertion_id makes the binding meaningless.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("person_evidence", "assertion_id", "assertions")],
        before=before,
    )


# --- Per-entry structural rules ---

def test_new_person_evidence_have_required_fields(before_state, after_state):
    """Every new person_evidence entry must have person_id, assertion_id,
    confidence, and a non-empty rationale.

    A pe entry without person_id or assertion_id is structurally broken.
    Missing confidence collapses the confidence-calibration grading. An
    empty rationale defeats the audit-trail purpose of person_evidence.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {e.get("id") for e in before.get("person_evidence", [])}

    errors = []
    for e in after.get("person_evidence", []):
        if e.get("id") in before_ids:
            continue
        eid = e.get("id", "?")
        if not e.get("person_id"):
            errors.append(f"person_evidence[{eid}]: missing person_id")
        if not e.get("assertion_id"):
            errors.append(f"person_evidence[{eid}]: missing assertion_id")
        if not e.get("confidence"):
            errors.append(f"person_evidence[{eid}]: missing confidence")
        if not e.get("rationale"):
            errors.append(f"person_evidence[{eid}]: missing/empty rationale")

    assert not errors, "Incomplete new person_evidence:\n" + "\n".join(errors)


# --- Tag-gated "review confirms, doesn't churn" checks ---

def _pe_by_id(research: dict, pe_id: str) -> dict | None:
    for e in research.get("person_evidence", []):
        if e.get("id") == pe_id:
            return e
    return None


def test_pe005_unchanged_when_review_confirms(before_state, after_state, test):
    """If the test is a confirmation review of pe_005, the entry must not
    be modified — confirming review doesn't churn the existing record."""
    if "pe_005" not in test.get("tags", []):
        pytest.skip("not a pe_005 review scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_pe = _pe_by_id(before, "pe_005")
    after_pe = _pe_by_id(after, "pe_005")
    if before_pe is None:
        pytest.skip("pe_005 not present in before_state")
    assert after_pe == before_pe, (
        f"pe_005 was modified during a confirmation review.\n"
        f"before: {before_pe}\nafter: {after_pe}"
    )


def test_no_unrelated_new_pe_in_focused_review(before_state, after_state, test):
    """A focused-review test should not create unrelated new pe_ entries.

    Tag-gated: only enforced when `confidence-calibration` is in tags —
    these tests are scoped to reviewing one existing pe entry, not
    expanding the evidence graph.
    """
    if "confidence-calibration" not in test.get("tags", []):
        pytest.skip("not a focused-review scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_ids = {e.get("id") for e in before.get("person_evidence", [])}
    after_ids = {e.get("id") for e in after.get("person_evidence", [])}
    new = after_ids - before_ids
    assert not new, (
        f"focused review of an existing pe entry must not create new pe "
        f"entries; got: {sorted(new)}"
    )


# --- Tag-gated multi-person-awareness regression check ---

def test_pe004_unchanged_when_adding_second_side(before_state, after_state, test):
    """When a relationship assertion gets its missing other-side link
    added, the EXISTING side (pe_004) must not be modified.

    Tag-gated on multi-person-awareness + pe_004 — the original pe_004
    is the canonical "already correct" entry that gets the missing
    Thomas-side companion link.
    """
    if "multi-person-awareness" not in test.get("tags", []):
        pytest.skip("not a multi-person-awareness scenario")
    if "pe_004" not in test.get("tags", []):
        pytest.skip("not a pe_004 scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_pe = _pe_by_id(before, "pe_004")
    after_pe = _pe_by_id(after, "pe_004")
    if before_pe is None:
        pytest.skip("pe_004 not present in before_state")
    assert after_pe == before_pe, (
        f"pe_004 was modified while adding the second-side link.\n"
        f"before: {before_pe}\nafter: {after_pe}"
    )


def test_a010_has_second_side_link(before_state, after_state, test):
    """When the multi-person-awareness scenario for a_010 runs, the skill
    must add a new pe_ entry linking a_010 to a person other than the
    one(s) it was already linked to.

    Tag-gated on a_010 + multi-person-awareness so it only fires on the
    specific relationship-assertion-bears-on-both-persons scenario.
    """
    if "multi-person-awareness" not in test.get("tags", []):
        pytest.skip("not a multi-person-awareness scenario")
    if "a_010" not in test.get("tags", []):
        pytest.skip("not an a_010 scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_persons_for_a010 = {
        e.get("person_id")
        for e in before.get("person_evidence", [])
        if e.get("assertion_id") == "a_010"
    }
    after_persons_for_a010 = {
        e.get("person_id")
        for e in after.get("person_evidence", [])
        if e.get("assertion_id") == "a_010"
    }
    new_persons = after_persons_for_a010 - before_persons_for_a010
    assert new_persons, (
        f"expected a new pe_ entry linking a_010 to a second person; "
        f"before linked persons: {sorted(before_persons_for_a010)}; "
        f"after: {sorted(after_persons_for_a010)}"
    )


# --- Tag-gated: same_person score wiring ----------------------

def _new_pe_for_assertion(before, after, assertion_id):
    """New person_evidence entries (in after, not before) for an assertion."""
    before_ids = {e.get("id") for e in before.get("person_evidence", [])}
    return [
        e for e in after.get("person_evidence", [])
        if e.get("id") not in before_ids and e.get("assertion_id") == assertion_id
    ]


def test_match_score_persisted(before_state, after_state, test):
    """Tag-gated (match-score): a record_search-sourced link must persist the
    same_person score — the new person_evidence entry for a_001
    carries a non-null match_score."""
    if "match-score" not in test.get("tags", []):
        pytest.skip("not a match-score scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_001")
    assert new, "expected a new person_evidence entry linking a_001"
    scored = [e for e in new if e.get("match_score") is not None]
    assert scored, (
        "the record_search-sourced link must carry a non-null match_score; "
        f"got match_score values: {[e.get('match_score') for e in new]}"
    )


def test_fts_assertion_no_score(before_state, after_state, test):
    """Tag-gated (no-score-fallback): a full-text-sourced assertion has no
    record_persona_id, so same_person cannot run — the new
    person_evidence entry for a_004 must leave match_score null."""
    if "no-score-fallback" not in test.get("tags", []):
        pytest.skip("not a no-score-fallback scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_004")
    assert new, "expected a new person_evidence entry linking a_004"
    bad = [e for e in new if e.get("match_score") is not None]
    assert not bad, (
        "a full-text-sourced link must leave match_score null; offending "
        f"entries: {[(e.get('id'), e.get('match_score')) for e in bad]}"
    )


def test_high_score_conflict_not_confident(before_state, after_state, test):
    """Tag-gated (score-conflict): when a high match score collides with a
    qualitative conflict, person-evidence must not create a `confident`
    link for a_002 — the conflict caps confidence regardless of score."""
    if "score-conflict" not in test.get("tags", []):
        pytest.skip("not a score-conflict scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_002")
    confident = [e for e in new if e.get("confidence") == "confident"]
    assert not confident, (
        "a high score must not auto-link past a qualitative conflict — no "
        "`confident` person_evidence entry may be created for a_002; got: "
        f"{[(e.get('id'), e.get('confidence')) for e in confident]}"
    )


def test_low_score_variant_still_links(before_state, after_state, test):
    """Tag-gated (score-variant): a low match score driven by a
    transcription-variant name must not dismiss a strong qualitative
    match — person-evidence must still create the link for a_003."""
    if "score-variant" not in test.get("tags", []):
        pytest.skip("not a score-variant scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    new = _new_pe_for_assertion(before, after, "a_003")
    assert new, (
        "a low score must not dismiss a strong qualitative match — "
        "expected a new person_evidence entry linking a_003"
    )


# --- Tag-gated: stub-person creation -------------------------------

def test_stub_person_created_and_linked(before_state, after_state, test):
    """Tag-gated (stub-creation): when an assertion's persona matches no
    existing tree person, person-evidence must mint a NEW stub person in
    tree.gedcomx.json and link a_005 to it — not force a bad match onto an
    existing person and not skip the role.

    The schema authorizes this write (research-schema-spec.md, "tree.gedcomx.json
    update timing"); the ownership manifest's tree `persons` row names
    person-evidence, so a correct stub run isn't failed for ownership.
    """
    if "stub-creation" not in test.get("tags", []):
        pytest.skip("not a stub-creation scenario")
    before_r = before_state.get("research_json")
    after_r = after_state.get("research_json")
    before_t = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after_t = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if any(x is None for x in (before_r, after_r, before_t, after_t)):
        pytest.skip("Missing research.json or tree.gedcomx.json for diff")

    before_pids = {p.get("id") for p in before_t.get("persons", [])}
    after_pids = {p.get("id") for p in after_t.get("persons", [])}
    new_pids = after_pids - before_pids
    assert new_pids, (
        "expected a new stub person in tree.gedcomx.json for the un-matched "
        f"persona; persons unchanged (before={sorted(before_pids)})"
    )

    new_pe = _new_pe_for_assertion(before_r, after_r, "a_005")
    assert new_pe, "expected a new person_evidence entry linking a_005"

    linked_to_new = [e for e in new_pe if e.get("person_id") in new_pids]
    assert linked_to_new, (
        "a_005 must link to the newly created stub person, not an existing "
        f"one; new pe person_ids={[e.get('person_id') for e in new_pe]}, "
        f"new stub ids={sorted(new_pids)}"
    )

    # a_005 is full-text-sourced — no same_person score, so match_score null.
    scored = [e for e in linked_to_new if e.get("match_score") is not None]
    assert not scored, (
        "a_005 is full-text-sourced — its link must leave match_score null; "
        f"got {[(e.get('id'), e.get('match_score')) for e in linked_to_new]}"
    )

    # The new stub must be minimally well-formed (gender + a name).
    for pid in {e.get("person_id") for e in linked_to_new}:
        person = next((p for p in after_t.get("persons", []) if p.get("id") == pid), None)
        assert person and person.get("gender") and person.get("names"), (
            f"new stub person {pid} must have a gender and at least one name"
        )


# --- Tag-gated: audit / review-only makes no writes ----------------

def test_audit_review_makes_no_writes(before_state, after_state, test):
    """Tag-gated (audit-review): a review/audit request is analysis-only.

    The skill flags gaps (e.g., a relationship assertion missing its
    other-side link) and asks before writing — it must not modify the
    person_evidence section during the review itself.
    """
    if "audit-review" not in test.get("tags", []):
        pytest.skip("not an audit-review scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert after.get("person_evidence") == before.get("person_evidence"), (
        "an audit/review must not modify person_evidence — it produces "
        "analysis and asks the user before making any change"
    )


# --- Tag-gated: research_query tool coverage (SKILL.md §1) -------------

def test_research_query_called_for_coverage(tool_calls, test):
    """Tag-gated (research-query-coverage): the skill must actually call
    research_query to gather scoped state, not fall back to a whole-file
    Read of research.json (SKILL.md §1).

    Deterministic regression catch — not judge-graded — for a future
    SKILL.md edit that reverts to a raw Read or drops the scoped lookup:
    such an edit produces zero research_query calls, and this assertion
    flips. Substring match on the tool name so it holds under any MCP
    server-prefix spelling.
    """
    if "research-query-coverage" not in test.get("tags", []):
        pytest.skip("not a research_query coverage test")
    called = [tc["tool"] for tc in tool_calls if "research_query" in tc.get("tool", "")]
    assert called, (
        "research-query-coverage test made no research_query call — "
        "person-evidence must gather assertions/links via scoped "
        "research_query, not a whole-file Read of research.json (SKILL.md §1)."
    )


# --- Deep-dive #1646 additions ----------------------------------------
#
# Both come from the #1646 deep dive's Step 6. Neither is tag-gated on the
# rule itself: each derives its own precondition from the run's state and
# skips when it does not hold, so a test written next year is covered
# without anyone remembering to add a tag (the failure mode #1757 records).

# The fact_types materialize_facts refuses outright — a persona carrying
# only these has nothing to write onto a person. Mirrors SKIP_TYPES in
# packages/engine/mcp-server/src/tools/materialize-facts.ts.
_UNMATERIALIZABLE = frozenset({"relationship", "marriage", "age"})


def _new_person_evidence(before: dict, after: dict) -> list[dict]:
    before_ids = {e.get("id") for e in (before.get("person_evidence") or [])}
    return [
        e
        for e in (after.get("person_evidence") or [])
        if e.get("id") not in before_ids
    ]


def _assertions_by_id(state: dict) -> dict:
    return {a.get("id"): a for a in (state.get("assertions") or [])}


def _tree_person_ids(tree: dict | None) -> set:
    if not tree:
        return set()
    return {p.get("id") for p in (tree.get("persons") or [])}


def test_same_person_called_when_persona_meets_existing_candidate(
    before_state, after_state, tool_calls
):
    """`same_person` is mandatory when a record-search persona is linked to a
    tree person that already existed (SKILL.md §2, "Score the match with
    `same_person` when the assertion is `record_search`-sourced").

    Skipping the call is the failure the `Score discipline` rubric dimension
    nominally grades and had never once reported: across the five committed
    run logs before this one the dimension took the value 3 on all 73
    gradings. `ut_person_evidence_n7v` on `flynn-marriage-parent-match` is
    what it looks like when missed — 9 of 9 assertions carry a
    `record_persona_id`, no `same_person` call is made, and eleven `pe_`
    entries land including three at `confident` with a null `match_score`.
    Observed at roughly 1 in 3 on that one test (#1646 comment 4), which is
    exactly the intermittency a judge dimension is worst at catching.

    Self-gating: skips unless some NEW `pe_` entry links an assertion with a
    non-null `record_persona_id` to a person that was already in the tree.
    A newly minted person is not an identity match and does not qualify.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    assertions = _assertions_by_id(after)
    existing_persons = _tree_person_ids(
        before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    )

    scored = [
        e
        for e in _new_person_evidence(before, after)
        if (assertions.get(e.get("assertion_id")) or {}).get("record_persona_id")
        and e.get("person_id") in existing_persons
    ]
    if not scored:
        pytest.skip(
            "no new pe_ entry links a record-search persona to a pre-existing "
            "tree person — nothing to score"
        )

    called = [tc for tc in tool_calls if "same_person" in tc.get("tool", "")]
    offenders = sorted(
        f"{e.get('id')} ({e.get('assertion_id')} -> {e.get('person_id')})"
        for e in scored
    )
    assert called, (
        "person_evidence entries link a record-search persona (non-null "
        "record_persona_id) to a tree person that already existed, but "
        "same_person was never called: "
        + ", ".join(offenders)
        + ". SKILL.md §2 makes the score mandatory for a record_search-sourced "
        "assertion meeting a serious candidate; §3 then treats it as an input, "
        "never a substitute. A link written without it has no attestation "
        "behind its match_score."
    )


def test_matched_persona_is_materialized_onto_its_person(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (`materialize`): linking a persona to an EXISTING tree person
    must also write that persona's assertions onto the person via
    `materialize_facts` (docs/specs/tree-materialization-spec.md — person-evidence
    "write[s] the linked persona's assertions as sourced facts/names onto the
    tree person" for every linked persona).

    The gap this closes: SKILL.md covered materialization only in §5 (persona
    matches NO existing person) and §7.3 (multi-person household record), so a
    single-person record matched to someone already in the tree got a `pe_`
    link and no facts. search-records reads its next query's name and date
    parameters off the tree person, so the facts that never landed are the
    ones that would have sharpened the next search (#1646, 2026-08-22).

    Tag-gated deliberately, and this is the part to revisit. The rule is
    universal but the corpus is not yet: several existing tests link to an
    existing person without materializing, and an ungated assertion would
    fail them all at once. A failing validator short-circuits the judge
    (`_compute_outcome` returns "fail" before grading), so ungating it today
    would delete the dimension scores that diagnose those tests rather than
    surface the defect. Ungate once they are brought up to the rule.
    """
    if "materialize" not in test.get("tags", []):
        pytest.skip("not a materialization test")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    assertions = _assertions_by_id(after)
    existing_persons = _tree_person_ids(
        before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    )

    owed = set()
    for e in _new_person_evidence(before, after):
        if e.get("person_id") not in existing_persons:
            continue
        fact_type = (assertions.get(e.get("assertion_id")) or {}).get("fact_type")
        if fact_type and fact_type not in _UNMATERIALIZABLE:
            owed.add(e.get("person_id"))
    if not owed:
        pytest.skip(
            "no new pe_ entry carries a materializable fact_type onto a "
            "pre-existing person"
        )

    materialize_args = [
        tc.get("args") or {}
        for tc in tool_calls
        if "materialize_facts" in tc.get("tool", "")
    ]
    named = set()
    for args in materialize_args:
        for op in args.get("ops") or [args]:
            if op.get("personId"):
                named.add(op["personId"])

    missing = sorted(owed - named)
    assert not missing, (
        "linked a persona carrying materializable facts to the existing tree "
        f"person(s) {missing} but never called materialize_facts for them — "
        "the pe_ link landed and the facts did not. person-evidence writes the "
        "linked persona's assertions onto the tree person for EVERY linked "
        "persona, matched as well as newly minted, on a single-person record "
        "as well as a household (SKILL.md §4, tree-materialization-spec)."
    )


def test_check_warnings_runs_after_a_write(before_state, after_state, skills_invoked):
    """SKILL.md §8: "After creating links and any stub persons, invoke
    `check-warnings` on the affected persons to catch genealogical
    impossibilities (married before 12, died after 120, child born after a
    parent's death, etc.)" — plausibility the persistence step does not check.

    Deep dive #1646 finding F4. The miss is intermittent and moves between
    runs, which is why it belongs to a program rather than a dimension: in
    `v1_2026-08-20_15-53-03` it was `ut_person_evidence_025` and
    `ut_person_evidence_014` (2 of 12 write-runs); in
    `v1_2026-08-24_18-17-08` it was `ut_person_evidence_011`, `_002` and
    `_022` (3 of 13) — five different tests across two runs, every one of
    them scoring 3 on all eight dimensions in the run where it skipped.

    `_014` is the case that matters most: it mints a brand-new stub person
    and skips the guard that would catch that stub carrying an impossible
    lifespan.

    Mirrors `test_tree_edit.py::test_check_warnings_runs_after_any_tree_write`
    (deep dive #1657), which asserts the same rule for the other skill that
    writes to the tree. Trigger differs because the skills write different
    things: tree-edit keys off the tree changing, person-evidence off a new
    `pe_` entry or a new tree person, either of which is a write §8 covers.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    wrote_links = bool(_new_person_evidence(before, after))
    before_tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after_tree = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    minted = _tree_person_ids(after_tree) - _tree_person_ids(before_tree)

    if not wrote_links and not minted:
        pytest.skip("no new pe_ entries and no new persons — nothing §8 covers")

    what = []
    if wrote_links:
        what.append(f"{len(_new_person_evidence(before, after))} new pe_ entr(ies)")
    if minted:
        what.append(f"minted {sorted(minted)}")
    assert "check-warnings" in (skills_invoked or []), (
        f"wrote to the project ({'; '.join(what)}) but never invoked "
        f"check-warnings — SKILL.md §8 requires it after creating links and "
        f"any stub persons, to catch impossibilities the writer tools do not "
        f"check. skills_invoked={list(skills_invoked or [])}"
    )
