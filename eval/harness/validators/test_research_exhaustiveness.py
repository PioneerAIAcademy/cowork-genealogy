"""Skill-specific validators for the research-exhaustiveness skill.

research-exhaustiveness evaluates whether research on an existing
question is reasonably exhaustive and either writes the
`exhaustive_declaration` on the question or declines and names what's
missing. The skill modifies only existing questions — it never creates
them (that's question-selection).

Ownership enforcement (research-exhaustiveness can write `questions`
alongside question-selection) is in
`test_universal.py::test_ownership_table`, driven by the shared
OWNERSHIP_TABLE. FK integrity for `log_entry_ids` is covered by
`test_universal.py::test_id_references_resolve`.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- Helpers ---------------------------------------------------------

REQUIRED_STOP_CRITERIA_KEYS = {
    "goal_alignment",
    "repository_breadth",
    "original_substitution",
    "independent_verification",
    "evidence_class",
    "conflict_resolution",
    "overturn_risk",
}


def _questions_by_id(state: dict) -> dict[str, dict]:
    return {q.get("id"): q for q in (state or {}).get("questions") or [] if q.get("id")}


def _questions_with_changed_declaration(before: dict, after: dict) -> list[dict]:
    """Return after-state question dicts whose exhaustive_declaration
    or status changed."""
    before_by_id = _questions_by_id(before)
    changed: list[dict] = []
    for q in (after.get("questions") or []):
        qid = q.get("id")
        if not qid or qid not in before_by_id:
            continue
        prev = before_by_id[qid]
        if (q.get("exhaustive_declaration") != prev.get("exhaustive_declaration")
                or q.get("status") != prev.get("status")):
            changed.append(q)
    return changed


# --- Never create new questions ---------------------------------------

def test_no_new_questions(before_state, after_state):
    """research-exhaustiveness modifies the `exhaustive_declaration` /
    `status` on existing questions. Creating a new question is
    question-selection's job; doing it here would violate single-writer
    semantics on the question creation event."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    before_ids = {q.get("id") for q in (before.get("questions") or [])}
    new_ids = [
        q.get("id")
        for q in (after.get("questions") or [])
        if q.get("id") and q.get("id") not in before_ids
    ]
    assert not new_ids, (
        f"research-exhaustiveness created a new question {new_ids}; "
        f"only question-selection may create questions"
    )


# --- Declaration / status consistency ---------------------------------

def test_declared_implies_exhaustive_declared_status(before_state, after_state):
    """When `exhaustive_declaration.declared` flips to true, the
    question's `status` must be `exhaustive_declared` (not still
    `in_progress` or `open`). Out-of-sync declared/status leaves a
    question that looks declared in the data but still appears unfinished
    to downstream skills."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        decl = (q.get("exhaustive_declaration") or {}).get("declared")
        status = q.get("status")
        if decl is True and status != "exhaustive_declared":
            bad.append(f"{q.get('id')}: declared=true but status={status!r}")
    assert not bad, "Declared/status inconsistency:\n  - " + "\n  - ".join(bad)


def test_declared_has_log_entry_ids(before_state, after_state):
    """When `declared` is true, `log_entry_ids` must be non-empty — the
    declaration is unfalsifiable without the log entries it claims to
    rest on (research-schema-spec §6 `exhaustive_declaration`)."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        ed = q.get("exhaustive_declaration") or {}
        if ed.get("declared") is True and not ed.get("log_entry_ids"):
            bad.append(f"{q.get('id')}: declared=true with empty log_entry_ids")
    assert not bad, "Declared without log entries:\n  - " + "\n  - ".join(bad)


def test_declared_has_full_stop_criteria(before_state, after_state):
    """When `declared` is true, `stop_criteria` must include all seven
    keys from GPS Step 1's 7-Point Stop Criteria. Missing keys leak
    through universal schema validation if the schema marks them
    optional, but the skill contract requires all seven."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        ed = q.get("exhaustive_declaration") or {}
        if ed.get("declared") is not True:
            continue
        sc = ed.get("stop_criteria") or {}
        missing = REQUIRED_STOP_CRITERIA_KEYS - set(sc.keys())
        if missing:
            bad.append(f"{q.get('id')}: missing stop_criteria keys {sorted(missing)}")
    assert not bad, "Incomplete stop_criteria:\n  - " + "\n  - ".join(bad)


# --- Tag-gated: declaration must NOT have been written ----------------

def test_no_exhaustive_declaration(before_state, after_state, test):
    """Tag-gated: when the test expects the skill to decline (e.g.,
    record types unsearched, plan items still in progress), no question
    should transition to `exhaustive_declared` or flip `declared` to
    true."""
    if "no-exhaustive-declaration" not in test.get("tags", []):
        pytest.skip("not a no-exhaustive-declaration scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    before_by_id = _questions_by_id(before)
    bad: list[str] = []
    for q in (after.get("questions") or []):
        qid = q.get("id")
        prev = before_by_id.get(qid, {})
        prev_decl = (prev.get("exhaustive_declaration") or {}).get("declared")
        new_decl = (q.get("exhaustive_declaration") or {}).get("declared")
        if prev_decl is not True and new_decl is True:
            bad.append(f"{qid}: flipped declared false→true when decline expected")
        if prev.get("status") != "exhaustive_declared" and q.get("status") == "exhaustive_declared":
            bad.append(f"{qid}: status set to exhaustive_declared when decline expected")
    assert not bad, "Unexpected declaration:\n  - " + "\n  - ".join(bad)
