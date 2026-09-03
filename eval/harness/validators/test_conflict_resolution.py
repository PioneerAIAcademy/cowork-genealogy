"""Skill-specific validators for the conflict-resolution skill.

conflict-resolution keeps its `rubric.md` — all three dimensions
(Source independence analysis, Evidence weighing, Resolution
completeness) are pure GPS craft and stay graded by the LLM judge.

These check structural invariants that should hold for every
conflict-resolution test, regardless of the specific test case, plus
tag-gated assertions on specific verdicts the test author wants
checked deterministically (e.g., "preferred_assertion_id was set to
one of a_002 / a_009").

See `validators/test_universal.py` module docstring for the full2
validator function-signature contract. Briefly: `before_state`,
`after_state`, `tool_calls`, `skill_frontmatter`, and `test` (the
parsed test JSON dict) are each separate parameters supplied by the
harness — pull the one you need by declaring it in your function
signature.
"""

import pytest

from harness.skill_invocation import CONFLICT_ANALYSIS_FIELDS

from validators_lib import assert_foreign_keys_valid


# Ownership enforcement for *all* skills is in
# test_universal.py::test_ownership_table, driven by
# docs/specs/schemas/ownership.json. Per-skill copies were removed to prevent
# drift between two sources of truth.


# --- Tool allowlist ---
#
# `test_no_mcp_tools_called` was removed: conflict-resolution declares
# `place_search` and `place_distance` in its allowed-tools (used for
# identity-conflict travel-distance analysis), and step 7 of SKILL.md
# invokes validate-schema as a sub-skill — which after the TypeScript
# validator port calls `validate_research_schema`. The universal
# `test_tool_allowlist` (in test_universal.py) already enforces the
# real invariant: every call must match the skill's declared
# allowed-tools (with sub-skill calls handled correctly).


# --- Structural rules from SKILL.md ---

def test_fact_conflicts_have_competing_assertions(before_state, after_state):
    """Every fact-type conflict must have at least 2 competing_assertion_ids.

    A fact conflict is by definition a disagreement between two or more
    assertions. Identity conflicts may have only 1 (a single assertion
    whose person linkage is uncertain).
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for conflict in after.get("conflicts", []):
        if conflict.get("conflict_type") == "fact":
            ids = conflict.get("competing_assertion_ids", [])
            if len(ids) < 2:
                errors.append(
                    f"conflicts[{conflict['id']}]: fact conflict has "
                    f"{len(ids)} competing_assertion_ids (need ≥2)"
                )

    assert not errors, "Structural violations:\n" + "\n".join(errors)


def test_resolved_conflicts_have_required_fields(before_state, after_state):
    """Resolved conflicts must have preferred_assertion_id and resolution_rationale.

    An unresolved conflict may have null fields — but once status is
    'resolved', the analysis must be complete.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for conflict in after.get("conflicts", []):
        if conflict.get("status") != "resolved":
            continue

        cid = conflict.get("id", "?")

        if not conflict.get("preferred_assertion_id"):
            errors.append(
                f"conflicts[{cid}]: resolved but no preferred_assertion_id"
            )
        if not conflict.get("resolution_rationale"):
            errors.append(
                f"conflicts[{cid}]: resolved but no resolution_rationale"
            )

    assert not errors, "Incomplete resolved conflicts:\n" + "\n".join(errors)


def test_preferred_assertion_is_in_competing(before_state, after_state):
    """preferred_assertion_id must be one of the competing_assertion_ids.

    You can't prefer an assertion that isn't part of the conflict.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for conflict in after.get("conflicts", []):
        preferred = conflict.get("preferred_assertion_id")
        competing = conflict.get("competing_assertion_ids", [])

        if preferred and preferred not in competing:
            errors.append(
                f"conflicts[{conflict['id']}]: preferred_assertion_id "
                f"'{preferred}' not in competing_assertion_ids {competing}"
            )

    assert not errors, "Invalid preferred assertions:\n" + "\n".join(errors)


def test_competing_assertions_exist(before_state, after_state):
    """All competing_assertion_ids must reference existing assertions."""
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")
    # Use the shared foreign-key helper. `before=None` checks ALL
    # entries (not just newly-added ones) — this is universal integrity,
    # not "new entries only."
    assert_foreign_keys_valid(
        after,
        [("conflicts", "competing_assertion_ids", "assertions")],
        before=None,
    )


def test_no_new_conflicts_without_competing(before_state, after_state):
    """New conflicts added by the skill must have competing_assertion_ids populated.

    A conflict with an empty competing_assertion_ids array is meaningless.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")

    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {c.get("id") for c in before.get("conflicts", [])}

    errors = []
    for conflict in after.get("conflicts", []):
        if conflict.get("id") in before_ids:
            continue  # existing conflict, not our responsibility
        if not conflict.get("competing_assertion_ids"):
            errors.append(
                f"conflicts[{conflict['id']}]: new conflict has no "
                f"competing_assertion_ids"
            )

    assert not errors, "New conflicts without competing assertions:\n" + "\n".join(errors)


def test_creates_no_new_conflict(before_state, after_state, test):
    """Tag-gated (`no-new-conflict`) no-harm invariant for the
    classification-vs-conflict-resolution negative
    (ut_conflict_resolution_010): a request to *classify* evidence
    (information_quality / source_classification labels) is
    record-extraction's job, not conflict-resolution's. The
    routing-independent gate is that no NEW `c_` conflict entry appears
    after the skill runs — whether the model auto-routes to
    record-extraction or loads conflict-resolution and declines (or
    over-explains) in-body, state must be untouched. Mirrors
    test_citation.py::test_does_not_add_new_source_entries; pure tag-gate
    like test_tree_edit.py::test_tree_edit_noop so it never touches the
    positive conflict tests that legitimately create conflicts.
    """
    if "no-new-conflict" not in test.get("tags", []):
        pytest.skip("not a no-new-conflict scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_ids = {c.get("id") for c in before.get("conflicts", [])}
    new = [
        c.get("id")
        for c in after.get("conflicts", [])
        if c.get("id") not in before_ids
    ]
    assert not new, (
        "conflict-resolution fabricated a conflict from a classification "
        f"request; new conflict id(s): {new}. Classifying evidence is "
        "record-extraction's job — it must not create a c_ entry here."
    )


# --- Tag-gated verdict checks ----------------------------------------

def _find_conflict(after_state, cid):
    after = after_state.get("research_json")
    if after is None:
        return None
    return next(
        (c for c in after.get("conflicts", []) if c.get("id") == cid),
        None,
    )


def test_resolved_flynn_birthplace(after_state, test):
    """For the birthplace-ireland-vs-pennsylvania test: the Ireland-vs-
    Pennsylvania conflict should be resolved with preferred_assertion_id
    set to one of the Ireland assertions (a_002 or a_009 — both record
    Ireland on the census side), and status == "resolved".

    The two census assertions are both defensible verdicts (either
    Ireland census source could be picked as preferred); we accept
    either.
    """
    if "resolved-flynn-birthplace" not in test.get("tags", []):
        pytest.skip("not a resolved-flynn-birthplace scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")
    # Find any conflict whose competing set includes both census
    # (a_002, a_009) and death-cert (a_012) — that's the conflict
    # under test regardless of c_id.
    target = None
    for c in after.get("conflicts", []):
        competing = set(c.get("competing_assertion_ids") or [])
        if {"a_002", "a_012"}.issubset(competing) or {"a_009", "a_012"}.issubset(competing):
            target = c
            break
    assert target is not None, (
        "no conflict found whose competing_assertion_ids include both a "
        "census Ireland assertion (a_002 / a_009) and the death-cert "
        "Pennsylvania assertion (a_012)"
    )
    assert target.get("status") == "resolved", (
        f"birthplace conflict should be resolved; "
        f"got status={target.get('status')!r}"
    )
    preferred = target.get("preferred_assertion_id")
    assert preferred in {"a_002", "a_009"}, (
        f"birthplace preferred_assertion_id should be one of "
        f"a_002 / a_009 (the Ireland census assertions); got {preferred!r}"
    )


# --- One conflict per invocation (V6), and the word caps (V2) ----------
#
# Both come from the conflict-resolution deep dive
# (docs/deep-dives/conflict-resolution-findings-2026-08-27.md, findings F7 and
# F2; requests V6 and V2 in issue #1972).
#
# The five fields that make a conflict *resolved* rather than merely
# *identified*. Creating an entry is identification and is unrestricted; writing
# any of these is resolution.
# Reuses harness.skill_invocation's constant rather than restating it. NOTE the
# `"status"` extension: CONFLICT_ANALYSIS_FIELDS carries only the four prose/id
# fields, and #1972's V6 rule names `status` explicitly — swapping in the bare
# constant makes two status-only resolutions pass (@clack391, measured). The
# per-field tests in tests/unit/test_conflict_resolution_validator.py are what
# make the unsafe form fail rather than pass silently.
_ANALYSIS_FIELDS = (*CONFLICT_ANALYSIS_FIELDS, "status")


def _conflicts_by_id(state: dict) -> dict:
    return {c.get("id"): c for c in (state.get("conflicts") or []) if c.get("id")}


def _analysis_written(conflict: dict) -> bool:
    """True when a conflict entry carries resolution work, not just identity.

    The skill's own creation template (conflict-resolution/SKILL.md:148-152)
    sets all five to null / "unresolved", so a freshly identified conflict is
    False here and a created-already-resolved one is True.
    """
    for f in _ANALYSIS_FIELDS:
        v = conflict.get(f)
        if f == "status":
            if v not in (None, "unresolved"):
                return True
        elif v not in (None, "", [], {}):
            return True
    return False


def _conflicts_with_changed_analysis(before: dict, after: dict) -> list[dict]:
    """V6's population: entries this run *resolved*.

    An entry present in both states counts when any analysis field differs. An
    entry new in `after` counts only when it ARRIVES carrying analysis --
    creating an empty conflict is identification and is explicitly unrestricted.
    Exempting new entries wholesale would leave a bypass: nothing stops a create
    arriving already `resolved` with full analysis, so a run could resolve one
    conflict and create-and-resolve a second in the same turn and pass.
    """
    before_by_id = _conflicts_by_id(before)
    touched: list[dict] = []
    for c in (after.get("conflicts") or []):
        cid = c.get("id")
        if not cid:
            continue
        prev = before_by_id.get(cid)
        if prev is None:
            if _analysis_written(c):
                touched.append(c)
        elif any(c.get(f) != prev.get(f) for f in _ANALYSIS_FIELDS):
            touched.append(c)
    return touched


def _conflicts_written(before: dict, after: dict) -> list[dict]:
    """V2's population, deliberately WIDER than V6's: every after-state conflict
    whose prose this run authored, created entries included.

    V6 asks "how many did you resolve"; V2 asks "how long is the prose you
    wrote". A conflict the run created with a 460-word rationale is exactly what
    a word cap is for, so it must not be filtered out by V6's five-field test.
    """
    before_by_id = _conflicts_by_id(before)
    written: list[dict] = []
    for c in (after.get("conflicts") or []):
        cid = c.get("id")
        if not cid:
            continue
        prev = before_by_id.get(cid)
        if prev is None or any(
            c.get(f) != prev.get(f) for f in ("weighing_analysis", "resolution_rationale")
        ):
            written.append(c)
    return written


def test_at_most_one_conflict_analysis_modified(before_state, after_state):
    """At most one conflict may be resolved per invocation (V6).

    SKILL.md works one conflict at a time, and ut_conflict_resolution_002's own
    judge_context states the rule -- yet 1 of the 51 committed runs writes
    both c_001 and c_002 to resolved with full analysis in one turn, and both
    graded pass with all six dimensions 3.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    touched = _conflicts_with_changed_analysis(before, after)
    assert len(touched) <= 1, (
        "more than one conflict's analysis fields were written in a single "
        "invocation: "
        + ", ".join(sorted(str(c.get("id")) for c in touched))
        + ". Resolve one conflict per invocation; creating further conflict "
        "entries is fine, but leave their analysis fields unwritten."
    )


# Bands, set from each field's own distribution across the committed
# conflict-resolution run logs, NOT from a single worst case.
#
# Figures re-derived 2026-09-03 against the four-log / 29-write corpus that
# #2149 left behind; the originals were taken on a five-log / 37-write corpus
# and #2149 rotated two logs out from under them. DEFAULT_KEEP_CANDIDATES = 5
# rotates this corpus on every paid run, so re-derive rather than quote --
# `_independently_over_cap_counts` in the test file is the recipe.
#
#   weighing_analysis  cap 200, corpus MAXIMUM 251 (unchanged by the rotation).
#       >200: 14 writes   >210: 7   >220: 3   >240: 1
#     210 reports 7 of the 14. 240 -- the figure the issue floats -- would report
#     1 of 14, so a green arm would read as "weighing lengths are fine". The
#     rotation strengthened that argument rather than weakening it.
#
#   resolution_rationale  cap 250, on conflicts with <3 competing assertions.
#       17 such writes: >250: 14   >300: 10
#     300 keeps a 20% grace band and still reports 10 of 17.
#
# Re-derive against the committed corpus before changing either.
_WEIGHING_CAP, _WEIGHING_BAND = 200, 210
_RATIONALE_CAP, _RATIONALE_BAND = 250, 300


def report_resolution_word_caps(before_state, after_state):
    """Word caps on the prose a resolution writes (V2). Tier 2 by design.

    SKILL.md:193 asks for ~200 words on weighing_analysis, :258-262 for ~250 on
    resolution_rationale unless the conflict is three-or-more-way, where
    completeness outranks the cap. 14 of the 17 committed writes that the
    escape cannot exempt exceed the rationale cap (re-derived 2026-09-03; the
    corpus rotates, so do not quote this).

    Reporting, not gating, and that is not a style choice: a failing tier-1
    validator suppresses the LLM judge for that run (orchestrator.py:600), so a
    gating version would silence the Evidence weighing and Resolution
    completeness grading on the runs it fires -- the craft grading this dive
    exists to protect.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    observations = []
    for c in _conflicts_written(before, after):
        cid = c.get("id", "?")

        weighing = c.get("weighing_analysis") or ""
        if weighing:
            n = len(weighing.split())
            if n > _WEIGHING_BAND:
                observations.append(
                    f"conflicts[{cid}].weighing_analysis is {n} words; the "
                    f"skill asks for ~{_WEIGHING_CAP} or fewer."
                )

        rationale = c.get("resolution_rationale") or ""
        if rationale:
            # competing_assertion_ids comes from the AFTER STATE, never from a
            # diff of changed fields. A run almost never writes that field --
            # it appears in changed_fields on 0 of the 26 over-cap
            # writes in the corpus -- so reading it from a diff makes the
            # three-or-more-way escape never apply and inflates the finding.
            competing = c.get("competing_assertion_ids") or []
            n = len(rationale.split())
            if len(competing) < 3 and n > _RATIONALE_BAND:
                observations.append(
                    f"conflicts[{cid}].resolution_rationale is {n} words on a "
                    f"conflict with {len(competing)} competing assertion(s); the "
                    f"skill asks for ~{_RATIONALE_CAP} or fewer below three."
                )

    # The message is the whole observation the judge sees -- split_observations
    # (validator_runner.py:264-276) passes r.error and deliberately never
    # r.name. State counts as fact; a verdict here would anchor the grade.
    assert not observations, "\n".join(observations)
