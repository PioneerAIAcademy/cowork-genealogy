"""Skill-specific validators for the tree-edit skill.

tree-edit applies direct edits to tree.gedcomx.json — adding facts,
correcting values, creating persons and relationships, and merging
two persons. The ownership-table check in `test_universal.py` already
enforces that tree-edit may only modify the persons/relationships/sources
sections of tree.gedcomx.json (and may not touch research.json at all),
so this file focuses on cross-file referential integrity and tag-gated
no-op-edit regression checks.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import re

import pytest


# --- Cross-file referential integrity ---------------------------------

def _person_ids_in_tree(tree: dict) -> set[str]:
    return {
        p.get("id")
        for p in (tree.get("persons") or [])
        if isinstance(p, dict) and p.get("id")
    }


def test_cross_file_person_references_resolve(after_state):
    """research.json's person references must point at persons that
    actually exist in tree.gedcomx.json. tree-edit can delete or merge
    persons; this check catches the failure mode where research.json
    referrers (person_evidence.person_id, timelines.person_ids,
    project.subject_person_ids) point at IDs no longer in the tree.

    Universal id-reference check only validates *within* research.json
    — cross-file checks live here so tree-edit's merge/delete path is
    actually guarded."""
    research = after_state.get("research_json")
    tree = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if research is None or tree is None:
        pytest.skip("missing research.json or tree.gedcomx.json")

    persons = _person_ids_in_tree(tree)
    errors: list[str] = []

    # project.subject_person_ids → tree.persons
    project = research.get("project") or {}
    for ref in project.get("subject_person_ids") or []:
        if ref and ref not in persons:
            errors.append(f"project.subject_person_ids: '{ref}' not in tree.persons")

    # person_evidence.person_id → tree.persons
    for pe in research.get("person_evidence", []):
        ref = pe.get("person_id")
        if ref and ref not in persons:
            errors.append(
                f"person_evidence[{pe.get('id')}].person_id '{ref}' not in tree.persons"
            )

    # timelines.person_ids → tree.persons
    for tl in research.get("timelines", []):
        for ref in tl.get("person_ids") or []:
            if ref and ref not in persons:
                errors.append(
                    f"timelines[{tl.get('id')}].person_ids '{ref}' not in tree.persons"
                )

    assert not errors, "Broken cross-file references after tree-edit:\n  - " + "\n  - ".join(errors)


# --- No-op edit enforcement (tag-gated) -------------------------------

def _trees_equal(before: dict | None, after: dict | None) -> bool:
    """Deep equality on the two GedcomX dicts."""
    return before == after


def test_tree_edit_noop(before_state, after_state, test):
    """Tag-gated: when the requested edit is already satisfied by the
    existing tree, tree-edit must make NO modifications. Touching a
    file just to overwrite it with identical content churns diffs and
    violates edit-minimality."""
    if "tree-edit-noop" not in test.get("tags", []):
        pytest.skip("not a tree-edit-noop scenario")
    before = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before is None or after is None:
        pytest.skip("missing tree.gedcomx.json on one side")
    assert _trees_equal(before, after), (
        "tree-edit modified tree.gedcomx.json on a no-op scenario; "
        "expected byte-identical content before and after"
    )


# --- Post-edit check-warnings (deep dive #1657, Finding F) ------------

def test_check_warnings_runs_after_any_tree_write(before_state, after_state, skills_invoked):
    """SKILL.md § Validation: "After ANY edit or merge, run check-warnings
    to catch genealogical impossibilities the structural validator cannot"
    -- unconditional, no carve-out for a single-field correction. Deep dive
    #1657 finding F: across the 5 committed run logs, this fired in at most
    2 of 5 runs for any one edit test, and 0 of 5 for three of them
    (`ut_tree_edit_006`, `_008`, `_009`) -- including the currently-active
    run log, where it is 0 of 5 across every edit test. One test's
    judge_context excused this as "person_warnings ... not available in the
    unit-test harness", which is not true (14 reusable person-warnings-*
    fixtures already exist under eval/fixtures/mcp/; tree-edit's tests just
    never referenced one -- now fixed alongside this validator).

    Grounded firing case: `ut_tree_edit_008`, run `v1_2026-07-30_18-18-04`
    -- F2's date is corrected (tree.gedcomx.json changes), skills_invoked ==
    ["tree-edit"], no check-warnings anywhere. Grounded passing case:
    `ut_tree_edit_010`, run `v1_2026-07-28_13-02-56` -- Mary (I5) and her
    ParentChild relationship are created, skills_invoked == ["tree-edit",
    "check-warnings"]."""
    before_tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after_tree = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if before_tree is None or after_tree is None:
        pytest.skip("missing tree.gedcomx.json on one side")
    if before_tree == after_tree:
        pytest.skip("tree.gedcomx.json unchanged -- no edit to validate")
    assert "check-warnings" in (skills_invoked or []), (
        "tree.gedcomx.json changed but check-warnings was never invoked -- "
        "SKILL.md § Validation requires it after ANY edit or merge"
    )


# --- Guardianship: which kin reading leads (issue #2449) --------------

_LEAD_MARKER = re.compile(
    r"favou?red|favou?r\b|leading|\bleads\b|stronger|more likely|"
    r"most likely|primary|preferred",
    re.I,
)
_UNCLE = re.compile(r"uncle", re.I)
_STEP = re.compile(r"step", re.I)


def _weighting_units(text: str):
    """Sentences, with table rows and list items kept whole.

    The observed violation weighted the readings twice, once in a
    comparison table and once in prose. A row keeps its own cells together:
    sentence-splitting inside a row can cut "not favoured" away from the
    "the step reading leads" that qualifies it, leaving a fragment that
    names uncle beside a lead marker with no step in sight. That is a
    spurious fire on a correct row, not a missed one -- the row is held
    whole to prevent it.
    """
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if line[:1] in "|-*":
            yield line
            continue
        for sentence in re.split(r"(?<=[.;:!?])\s+", line):
            if sentence.strip():
                yield sentence.strip()


def test_step_reading_leads_when_the_surname_is_unresolved(text_response, test):
    """`references/relationship-accuracy.md`, "Guardianship shortly after a
    remarriage": when the record does not say whether the wife's shared
    surname is her maiden or a prior married name, the STEP reading leads
    and uncle-by-marriage is named as unresolved.

    Observed violation: `ut_tree_edit_014`, run `v1_2026-09-15_05-34-57`.
    The run decided the surname was a maiden name on no evidence and
    inverted the weighting -- "**Uncle by marriage** (favoured)" in a
    comparison table, then "That makes the **uncle-by-marriage reading the
    favoured one**". The human annotation upheld Correctness 1 and
    Completeness 1: "That reverses the required determination."

    That run was following the reference, which branched on maiden-vs-
    married and gave no default for the unresolved case the record actually
    presents. The reference now states the default and the reason -- the
    step reading explains the timing of the appointment, the uncle reading
    has to treat the bond and the marriage as coincidental. This is the
    deterministic half of that fix; issue #2449 records why the judge could
    not be relied on for it (`Tool Arguments` alone was scored 1, null and 3
    on identical behaviour across five runs).

    Asserted narrowly: no unit of text may mark the UNCLE reading as the
    favoured one WITHOUT naming the step reading in the same breath. A run
    that weighs both together, or that names uncle with no lead marker at
    all, passes. Measured over every captured `_014` response -- the five
    committed runs plus three scratch runs of 2026-09-22 -- this fires on
    exactly the one inverted run and is clean on the other seven, including
    the two that failed for the unrelated `Tool Arguments` reason.
    """
    if "guardianship" not in (test.get("tags") or []):
        pytest.skip("only applies to guardianship tests")
    if not (text_response or "").strip():
        pytest.skip("no reply to weigh")
    offenders = [
        u for u in _weighting_units(text_response)
        if _LEAD_MARKER.search(u) and _UNCLE.search(u) and not _STEP.search(u)
    ]
    assert not offenders, (
        "the uncle-by-marriage reading is marked as the favoured one without "
        "the step reading weighed alongside it. When the record does not "
        "settle whose surname it is, the step reading leads and uncle is "
        "named as unresolved (references/relationship-accuracy.md, "
        "\"Guardianship shortly after a remarriage\"). Offending text: "
        + " || ".join(u[:160] for u in offenders)
    )
