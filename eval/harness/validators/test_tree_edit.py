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
