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

import json

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
    reachable record persona, so `same_person` cannot run — the new
    person_evidence entry for a_004 must leave match_score null.

    The CAUSE matters, because the wrong one was load-bearing elsewhere: it is
    not that `record_persona_id` is null. `same_person` never reads that field,
    and a null value means only that no search sidecar was retained. A full-text
    hit is unscoreable because its sidecar holds transcript text rather than
    GedcomX — there is no indexed persona to compare against — and its ARK is a
    `3:1:`/`3:2:` image entry `record_read` cannot open (#1429)."""
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

    # Whether a_005's link may carry a score depends on ITS PROVENANCE, which
    # differs between the two scenarios this tag covers (#1429). In
    # `flynn-stub-needed` a_005 is full-text-sourced, so nothing can be scored
    # and match_score must stay null. In `flynn-spouse-stub-marriage` it is
    # `record_search` with a RETAINED sidecar, so a persona is reachable and a
    # score is correct — this assertion used to hardcode the full-text case and
    # failed `ut_person_evidence_022` in v1_2026-08-27_12-36-32 for doing the
    # right thing (it scored the pairing at 0.79 after the writer tool's
    # reachability warning pointed it at the sidecar).
    a_005 = _assertions_by_id(after_r).get("a_005")
    if _persona_reachable(after_r, a_005):
        pytest.skip(
            "a_005's persona is reachable in this scenario, so a match_score is "
            "legitimate — the null-score rule belongs to the unscoreable lanes"
        )
    scored = [e for e in linked_to_new if e.get("match_score") is not None]
    assert not scored, (
        "a_005 has no reachable record persona here — its link must leave "
        "match_score null; "
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

# Fact types that bear on a SECOND party rather than asserting the persona's own
# identity. A `relationship` assertion on the groom persona ("child of Thomas")
# links to the FATHER's tree person, so the persona and the linked person are
# deliberately different people and `same_person(groom, father)` is a comparison
# SKILL.md never asks for. Excluding them costs no coverage: the same persona's
# `name`/`sex` assertions are still in scope and still carry the demand.
_NON_IDENTITY_FACT_TYPES = frozenset({"relationship", "marriage"})


def _new_person_evidence(before: dict, after: dict) -> list[dict]:
    before_ids = {e.get("id") for e in (before.get("person_evidence") or [])}
    return [
        e
        for e in (after.get("person_evidence") or [])
        if e.get("id") not in before_ids
    ]


def _assertions_by_id(state: dict) -> dict:
    return {a.get("id"): a for a in (state.get("assertions") or [])}


def _results_ref_missing(research: dict, assertion: dict) -> bool:
    """True when the assertion's log entry has no results sidecar.

    SKILL.md §2: a search predating result retention has `results_ref: null`, so
    the `gedcomx1` side of `same_person` cannot be built and correlation stands
    alone. Demanding a score there fails a run for a fixture property.
    """
    log_id = assertion.get("log_entry_id")
    if not log_id:
        return False
    for entry in research.get("log") or []:
        if entry.get("id") == log_id:
            return entry.get("results_ref") is None
    return False


def _persona_reachable(research: dict, assertion: dict | None) -> bool:
    """Whether a record persona `same_person` could score against is reachable
    for this assertion — the same predicate as
    `harness/skill_invocation.py::_persona_reachable` and
    `research-append.ts::personaReachable`, kept in step with both.

    `same_person` takes two GedcomX documents plus a focus id inside each and
    never reads `record_persona_id`; that field points into a retained search
    sidecar, so a null value proves only that no sidecar was kept. Reachable when
    the assertion carries a persona id, came from `record_read` (which returns a
    persons array, so the record can be re-opened), or came from a
    `record_search` that retained its sidecar. Unresolvable provenance counts as
    reachable, so an assertion written with no `log_entry_id` cannot shed the
    requirement by omission.
    """
    if not isinstance(assertion, dict):
        return True
    if assertion.get("record_persona_id"):
        return True
    log_id = assertion.get("log_entry_id")
    if not log_id:
        return True
    for entry in research.get("log") or []:
        if entry.get("id") != log_id:
            continue
        if entry.get("tool") == "record_read":
            return True
        return bool(entry.get("tool") == "record_search" and entry.get("results_ref"))
    return True


def _same_person_pairs(tool_calls: list[dict]) -> set[tuple]:
    """Every (id, id) pair a `same_person` call actually scored, both orderings.

    SKILL.md §2 sends the record persona as `primaryId1` and the tree candidate
    as `primaryId2`; both orderings are stored so a transposed call still counts
    as having scored that pairing.
    """
    pairs: set[tuple] = set()
    for tc in tool_calls:
        if "same_person" not in tc.get("tool", ""):
            continue
        args = tc.get("args") or {}
        p1, p2 = args.get("primaryId1"), args.get("primaryId2")
        if p1 and p2:
            pairs.add((p1, p2))
            pairs.add((p2, p1))
    return pairs


def _materialize_ops(args: dict) -> list[dict]:
    """The op dicts a `materialize_facts` call carries, tolerating a stringified
    `ops`.

    The tool itself recovers that shape via `coerceJsonArg`, and the mock records
    the raw model args, so `ops` reaching a validator as a JSON string is real,
    not hypothetical. Iterating a string yields characters and `.get` on one
    raises AttributeError, which `validator_runner` converts into a FAILED
    validator — gating the test and deleting its judge scores.
    """
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except ValueError:
            ops = None
    if not isinstance(ops, list):
        ops = [args]
    return [op for op in ops if isinstance(op, dict)]


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
    nominally grades reports only rarely: across the five committed run logs it
    takes the value 3 on 69 of 71 numeric gradings, dropping to 1 exactly twice
    (n7v in `v1_2026-08-20_15-53-03`, `_023` in `v1_2026-08-24_22-05-46`) — about
    2 in 71. An earlier draft of this docstring said "3 on all 73 gradings";
    that was measured against a corpus retention has since pruned and was never
    recomputed. Re-derive it, do not reword it. `ut_person_evidence_n7v` on `flynn-marriage-parent-match` is
    what it looks like when missed — 9 of 9 assertions carry a
    `record_persona_id`, no `same_person` call is made, and eleven `pe_`
    entries land including three at `confident` with a null `match_score`.
    Observed at roughly 1 in 3 on that one test (#1646 comment 4), which is
    exactly the intermittency a judge dimension is worst at catching.

    Self-gating, and deliberately narrow — it must only fire where this tier can
    actually verify the pairing. Three cases SKILL.md endorses were false-failed
    by an earlier, broader version (caught in review of #1882):

    1. **A relationship-type assertion.** In `flynn-marriage-parent-match`,
       `a_004`/`a_005` are `fact_type: relationship` on the GROOM persona `G1`
       ("child of Thomas", "child of Bridget") and link to the parents `I1`/`I2`.
       The identity matches run through the parent personas — `F1->I1`, `M1->I2`,
       which the passing runs do call — so demanding `same_person(G1, I1)` asks
       the groom to be compared to his father. Replaying the broader version
       against the PASSING `v1_2026-08-12_17-18-54` n7v run fires on exactly
       those two entries, i.e. it would have flipped a passing test to fail.
    2. **A household paired with `matchRelatives: true`** (§2.4): the relative
       scores come back in the response's `matches` array, never as separate
       call args, and this tier records no tool responses (F4). Unverifiable
       here, so the check stands down rather than guessing.
    3. **`results_ref: null`** (§2): no sidecar means `gedcomx1` cannot be built
       and correlation stands alone.

    A newly minted person is not an identity match and does not qualify either.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    assertions = _assertions_by_id(after)
    existing_persons = _tree_person_ids(
        before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    )

    if any(
        (tc.get("args") or {}).get("matchRelatives")
        for tc in tool_calls
        if "same_person" in tc.get("tool", "")
    ):
        pytest.skip(
            "a same_person call used matchRelatives=true — SKILL.md §2.4 pairs a "
            "household's relatives in that one call and returns their scores in "
            "the RESPONSE's `matches` array, which this tier does not record. "
            "The pairings cannot be read from args, so demanding one call per "
            "relative would fail the compliant path."
        )

    scored = [
        e
        for e in _new_person_evidence(before, after)
        if (assertions.get(e.get("assertion_id")) or {}).get("record_persona_id")
        and e.get("person_id") in existing_persons
        and (assertions.get(e.get("assertion_id")) or {}).get("fact_type")
        not in _NON_IDENTITY_FACT_TYPES
        and not _results_ref_missing(after, assertions.get(e.get("assertion_id")) or {})
    ]
    if not scored:
        pytest.skip(
            "no new pe_ entry makes an identity claim this tier can verify — "
            "nothing to score"
        )

    pairs = _same_person_pairs(tool_calls)
    offenders = sorted(
        f"{e.get('id')} ({e.get('assertion_id')}/"
        f"{(assertions.get(e.get('assertion_id')) or {}).get('record_persona_id')}"
        f" -> {e.get('person_id')})"
        for e in scored
        if (
            (assertions.get(e.get("assertion_id")) or {}).get("record_persona_id"),
            e.get("person_id"),
        )
        not in pairs
    )
    assert not offenders, (
        "person_evidence entries link a record-search persona (non-null "
        "record_persona_id) to a tree person that already existed, and no "
        "same_person call scored that pairing: "
        + ", ".join(offenders)
        + f". Pairings actually scored: {sorted(pairs) or 'none'}. "
        "SKILL.md §2 makes the score mandatory for a record_search-sourced "
        "assertion meeting a serious candidate; §3 then treats it as an input, "
        "never a substitute. Matched per persona, not per run: one call on a "
        "household of several scored personas leaves the rest unattested, which "
        "is the §7.3 path where scoring most often goes wrong."
    )


def test_same_person_called_at_all_when_a_reachable_persona_was_linked(
    before_state, after_state, tool_calls
):
    """A run that wrote `person_evidence` links with a reachable record persona
    must call `same_person` **at least once**. Deliberately coarse.

    Why a second, blunter check beside
    `test_same_person_called_when_persona_meets_existing_candidate`: that one
    matches per PAIR, keyed on `(record_persona_id, person_id)`, so it
    structurally cannot cover the two lanes issue #1429 corrected. A
    `record_read`-sourced assertion and a sidecar-backed search with a null
    persona both have no `record_persona_id` to key a pair on — the agent
    chooses the `persons[].id` itself and this tier records no tool responses to
    read it back from. So the finer check stands down there, and without this one
    nothing at all asserts the call.

    **Measured need.** In `v1_2026-08-27_11-28-52` — the run that shipped the
    corrected retrieval recipe — `same_person` was called in 7 of 22 tests, and
    every one of those seven has a non-null `record_persona_id`. `record_read`
    was called **zero** times across the whole suite. `ut_person_evidence_024`
    (a `record_read`-sourced assertion) and `_022` (a retained sidecar, null
    persona) each wrote a `confident` link with a null `match_score` and made no
    `same_person` call anywhere in the run, and both still PASSED, because their
    `judge_context` says the subject is lane discipline and waives the score.
    Prose was corrected, read, and not followed — `docs/skill-lifecycle.md` §5's
    pattern — and the suite could not see it.

    **Coarse on purpose.** It asks "was the tool used at all in a run that owed
    a score", not "was this pairing scored". That dodges every false-failure the
    per-pair check had to be narrowed against — relationship-type assertions
    scoring through a parent persona, `matchRelatives: true` returning scores in
    a response body this tier does not record, a stub whose id the validator
    cannot predict — while still being unarguable about the case that actually
    occurred: zero calls in a run that wrote reachable links.

    **Scope differs from the harness detector, deliberately.** That one asks only
    about BRAND-NEW tree persons; this asks about every new `pe_` link with a
    reachable persona, including one to a pre-existing seed person. The two are a
    mirrored *predicate* (`_persona_reachable`), not a mirrored population — the
    harness detector answers "was a new identity asserted unscored", this answers
    "did a run that owed a score make the call". Harmless in today's suite, and
    named so the difference is not read as drift.

    **What it does NOT assert.** Which pairing was scored, that the score was
    used, or that the RIGHT persona was chosen for a relationship assertion's
    second party. Those are the per-pair check, the `Score discipline` rubric
    dimension, and the reachability warning `research_append` now emits at write
    time.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    assertions = _assertions_by_id(after)
    owed = [
        e
        for e in _new_person_evidence(before, after)
        if _persona_reachable(after, assertions.get(e.get("assertion_id")))
    ]
    if not owed:
        pytest.skip("no new pe_ entry had a reachable record persona — nothing owed")

    # A call that ERRORED is not a score. Without this an upstream failure would
    # satisfy the check, which is the same success-gating
    # `same_person_scored_ids` applies in the harness. Latent rather than live
    # today — no committed `same_person` call carries `is_error: true` — so this
    # arm is unexercised by the corpus and is here for the run that first errors.
    if any(
        "same_person" in (tc.get("tool") or "") and tc.get("is_error") is not True
        for tc in tool_calls
    ):
        return

    detail = ", ".join(
        f"{e.get('id')} ({e.get('assertion_id')} -> {e.get('person_id')})" for e in owed
    )
    raise AssertionError(
        f"wrote {len(owed)} person_evidence link(s) with a REACHABLE record "
        f"persona and never called same_person anywhere in the run: {detail}. "
        "A null record_persona_id is not a reason to skip — same_person takes "
        "two gedcomx documents plus a focus id inside each and never reads that "
        "field; a null value means only that no search sidecar was retained. "
        "Take the persona from the log entry's sidecar when it has a "
        "results_ref, or re-open the record with record_read when the assertion "
        "came from one (SKILL.md §2, step 1)."
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
        for op in _materialize_ops(args):
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


def test_check_warnings_runs_after_a_write(before_state, after_state, skills_invoked, test):
    """SKILL.md §8: "After creating links and any stub persons, invoke
    `check-warnings` on the affected persons to catch genealogical
    impossibilities (married before 12, died after 120, child born after a
    parent's death, etc.)" — plausibility the persistence step does not check.

    Deep dive #1646 finding F4. The miss is intermittent and moves between
    runs, which is why it belongs to a program rather than a dimension: in
    `v1_2026-08-20_15-53-03` it was `ut_person_evidence_025` and
    `ut_person_evidence_014` (2 of 12 write-runs); in
    `v1_2026-08-24_18-17-08` it was `_002`, `_011` and `_022` (3 of 13); in
    `v1_2026-08-24_22-05-46` it was `_002`, `_010`, `_013`, `_019` and `_022`
    (5 of 14). Ten skips across eight distinct tests over those three logs,
    every one scoring 3 on all eight dimensions in the run where it skipped.

    `_014` is the case that matters most: it mints a brand-new stub person
    and skips the guard that would catch that stub carrying an impossible
    lifespan.

    Mirrors `test_tree_edit.py::test_check_warnings_runs_after_any_tree_write`
    (deep dive #1657), which asserts the same rule for the other skill that
    writes to the tree. Trigger differs because the skills write different
    things: tree-edit keys off the tree changing, person-evidence off a new
    `pe_` entry or a new tree person, either of which is a write §8 covers.

    **Tag-gated (`check-warnings-required`), and the narrowing is deliberate.**
    Ungated it fired on 4 genuine skips in one 22-test run and converted each
    to a validator-driven fail, short-circuiting the judge and deleting the
    dimension scores that diagnose those tests. The tag is carried by the
    stub-minting tests (`_014`, `_021`, `_026`, `_027`), where an impossible
    lifespan on a freshly minted person is the concrete harm §8 guards. This
    is not a gate chosen to be green: `_014` skipped the call in
    `v1_2026-08-20_15-53-03`, so the tagged set has a demonstrated failure.

    **The ungated rate is a measured, unenforced gap**, recorded here so
    narrowing it is not silent: `check-warnings` was skipped on 2 of 12
    write-runs (`v1_2026-08-20_15-53-03`), 3 of 13 (`v1_2026-08-24_18-17-08`)
    and 5 of 14 (`v1_2026-08-24_22-05-46`) — 10 skips across 8 distinct tests
    over those three logs (17 across 9 over all five committed logs), none
    scoring below 3 on any dimension in the run where it skipped.
    Not run truncation: the skipping runs are consistently the SHORTEST and
    lowest-turn of the write-runs in both logs (127s/10.3 turns vs 221s/18.6;
    148s/13.2 vs 209s/19.1), so they finished early without the step rather
    than running out of room. Widen the tag once compliance is consistent.

    **What this does NOT assert.** That the impossibility check actually ran.
    No test in either directory declares a `person-warnings-*` mcp_fixture (13
    exist under `eval/fixtures/mcp/`), so `check-warnings` reaches
    `person_warnings`, finds no fixture, and reports the tool unavailable —
    which is what `ut_person_evidence_027` did on `v1_2026-08-24_18-17-08`
    ("the offline impossibility check cannot run"). This assertion therefore
    covers the delegation, not its result. #1657's docstring states the
    fixture gap was "now fixed alongside this validator"; it was not, on
    either side. Referencing a fixture from a test is what would close it,
    and that edit flips the run-log snapshot.
    """
    if "check-warnings-required" not in test.get("tags", []):
        pytest.skip("not tagged check-warnings-required")

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
