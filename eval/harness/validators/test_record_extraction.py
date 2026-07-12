"""Skill-specific validators for the record-extraction skill.

These check structural invariants that should hold for every
record-extraction test, regardless of the specific test case.

See `validators/test_universal.py` module docstring for the full
validator function-signature contract. Briefly: `before_state`,
`after_state`, `tool_calls`, `skill_frontmatter`, and `test` are each
separate parameters supplied by the harness — pull the one you need by
declaring it in your function signature.

This file is intended as a second worked example for junior devs.
Compared to test_conflict_resolution.py, record-extraction:
  - Writes to TWO sections (assertions and sources), not one.
  - DOES call MCP tools (record_search, image_transcribe, etc.).
  - Has richer field-level invariants on each new assertion.

Pattern: ownership check, append-only check on assertions/sources,
foreign-key integrity, and per-assertion required-field checks.

Tag-gated regression checks (e.g., 1850-census-uses-_inferred-suffix)
sit at the bottom; they gate on `test["tags"]` so they only fire on
the specific scenario they describe.
"""

import pytest

from validators_lib import (
    assert_foreign_keys_valid,
    assert_no_section_deletions,
)


# Ownership enforcement is centralised in test_universal.py's
# OWNERSHIP_TABLE driven by a single dict mirroring
# research-schema-spec.md §4. Per-skill copies were removed to prevent
# drift between two sources of truth.
#
# Diff / append-only / foreign-key patterns delegate to
# `validators_lib.py` — adding the next 21 skill validator files should
# call those helpers rather than re-implementing the patterns.


# --- Append-only / no-delete on owned sections ---

def test_assertions_are_append_only(before_state, after_state):
    """Existing assertions must not be deleted."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "assertions")


def test_sources_are_append_only(before_state, after_state):
    """Existing sources must not be deleted."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "sources")


# --- Foreign-key integrity for new assertions ---

def test_new_assertions_reference_valid_source(before_state, after_state):
    """Every new assertion's source_id must point at a real source entry."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("assertions", "source_id", "sources")],
        before=before,
    )


def test_new_assertions_reference_valid_log_entry(before_state, after_state):
    """log_entry_id is optional (null OK); when set, must resolve."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("assertions", "log_entry_id", "log")],
        before=before,
    )


# --- Per-assertion structural rules ---

def test_new_assertions_have_required_classification(before_state, after_state):
    """Every new assertion must carry the three GPS classification fields.

    Per research-schema-spec.md §5.6, every assertion requires:
      - information_quality (primary | secondary | indeterminate)
      - informant_proximity (self, witness, household_member, ...)
      - evidence_type (direct | indirect | negative)

    Missing these silently breaks downstream skills (conflict-resolution
    weighs by informant_proximity; proof-conclusion needs evidence_type).
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        aid = a.get("id", "?")
        for field in ("information_quality", "informant_proximity", "evidence_type"):
            if not a.get(field):
                errors.append(f"assertions[{aid}]: missing {field}")

    assert not errors, "Incomplete new assertions:\n" + "\n".join(errors)


def test_new_assertions_attached_to_record_role(before_state, after_state):
    """Every new assertion must have both record_id and record_role.

    Per research-schema-spec.md §5.6 design decision: assertions attach
    to record_id + record_role, NOT to a person. Person attachment is
    person-evidence's job. record-extraction must produce assertions
    with both fields populated so person-evidence has something to bind.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        aid = a.get("id", "?")
        if not a.get("record_id"):
            errors.append(f"assertions[{aid}]: missing record_id")
        if not a.get("record_role"):
            errors.append(f"assertions[{aid}]: missing record_role")

    assert not errors, "Assertions not attached to record_role:\n" + "\n".join(errors)


def test_negative_evidence_uses_absent_role(before_state, after_state):
    """Assertions with evidence_type='negative' must have record_role='absent'.

    Per research-schema-spec.md §5.6 negative-evidence convention:
    when the absence of information is the finding, the role is `absent`
    and the value describes what was expected. Catches the common
    mistake of using evidence_type='negative' on a regular role.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for a in after.get("assertions", []):
        if a.get("evidence_type") == "negative" and a.get("record_role") != "absent":
            errors.append(
                f"assertions[{a.get('id')}]: evidence_type=negative but "
                f"record_role='{a.get('record_role')}' (expected 'absent')"
            )

    assert not errors, "Negative-evidence role mismatch:\n" + "\n".join(errors)


# --- New sources structural rules ---

def test_new_sources_have_citation_detail(before_state, after_state):
    """Every new source must have the citation_detail object populated.

    record-extraction creates the source with a working citation; the
    citation skill later refines it. But the structure must exist from
    creation so downstream skills have something to read.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {s.get("id") for s in before.get("sources", [])}

    required_detail_keys = {"who", "what", "when_created", "when_accessed", "where", "where_within"}

    errors = []
    for s in after.get("sources", []):
        if s.get("id") in before_ids:
            continue
        sid = s.get("id", "?")
        detail = s.get("citation_detail") or {}
        missing = required_detail_keys - set(detail.keys())
        if missing:
            errors.append(f"sources[{sid}]: citation_detail missing {sorted(missing)}")

    assert not errors, "Incomplete new sources:\n" + "\n".join(errors)


# NOTE (2026-07-11, record-extraction consolidation PR 3): the per-skill
# `test_only_allowed_mcp_tools` check was removed. It duplicated the
# universal `test_tool_allowlist` in test_universal.py — which, unlike the
# local copy, unions the frontmatter `tools:` of every plugin agent the
# skill delegates to via `@plugin:<name>` (record-extraction now delegates
# persistence to the record-extractor agent, whose research_append /
# tree_edit / place_search calls land in the same session tool_calls log).
# Same removal was already applied to conflict-resolution and
# proof-conclusion for the same redundancy reason.


# --- Tag-gated regression checks ---

def test_1850_census_uses_inferred_suffix(before_state, after_state, test):
    """For 1850-census extractions, relationship-type assertions must use
    the `_inferred` suffix on `structured_value.relationship_type`.

    Per research-schema-spec.md §5.6.1, the 1850 census has no
    relationship column — relationships are deduced from household
    position and must be flagged with the `_inferred` suffix
    (e.g., `child_inferred`, `spouse_inferred`).

    Tag-gated on `1850` or `1850-census` so it only applies to the
    relevant scenarios.
    """
    tags = test.get("tags", [])
    if not any(t in tags for t in ("1850", "1850-census")):
        pytest.skip("not a 1850-census scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if a.get("fact_type") != "relationship":
            continue
        sv = a.get("structured_value") or {}
        rel_type = sv.get("relationship_type")
        if rel_type and not str(rel_type).endswith("_inferred"):
            errors.append(
                f"assertions[{a.get('id')}]: 1850-census relationship "
                f"has relationship_type='{rel_type}' without '_inferred' "
                f"suffix (relationships in 1850 are deduced, not stated)"
            )

    assert not errors, (
        "1850-census relationships missing _inferred suffix:\n  - "
        + "\n  - ".join(errors)
    )


def test_negative_evidence_assertion_created(
    before_state, after_state, test
):
    """For negative-evidence scenarios, the skill must create at least
    one NEW assertion with `evidence_type: \"negative\"` and
    `record_role: \"absent\"`. Otherwise the absence wasn't recorded.

    Tag-gated on `negative-evidence`.
    """
    if "negative-evidence" not in test.get("tags", []):
        pytest.skip("not a negative-evidence scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    new_neg = [
        a for a in after.get("assertions", [])
        if a.get("id") not in before_ids
        and a.get("evidence_type") == "negative"
        and a.get("record_role") == "absent"
    ]
    assert new_neg, (
        "negative-evidence scenario produced no new assertion with "
        "evidence_type='negative' and record_role='absent'"
    )


def test_negative_evidence_value_describes_expectation(
    before_state, after_state, test
):
    """For negative-evidence extractions, the assertion's `value` field
    must describe what was expected — not be empty or just the literal
    'absent'.

    Per the negative-evidence convention, `value` carries the
    expected-but-missing information so downstream skills (and the
    genealogist) know what was searched for.

    Tag-gated on `negative-evidence`.
    """
    if "negative-evidence" not in test.get("tags", []):
        pytest.skip("not a negative-evidence scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if a.get("evidence_type") != "negative":
            continue
        value = (a.get("value") or "").strip()
        if not value or value.lower() in {"absent", "missing", "n/a", "none"}:
            errors.append(
                f"assertions[{a.get('id')}]: negative-evidence value is "
                f"'{value}' — should describe what was expected"
            )

    assert not errors, (
        "Negative-evidence assertions missing expectation in value:\n  - "
        + "\n  - ".join(errors)
    )


# --- Tag-gated: sibling person stubs in tree.gedcomx.json ------------

def test_sibling_stubs_created_in_tree(before_state, after_state, test):
    """Tag-gated (sibling-stubs): when the subject is `child_N` on a
    household record AND a household parent already exists in
    tree.gedcomx.json, SKILL.md §5d requires the skill to write minimal
    person stubs for the subject's siblings PLUS a ParentChild edge from
    the existing parent to each new sibling. This validator structurally
    confirms that:
      1. tree.gedcomx.json grew at least one NEW person entry (a
         sibling stub).
      2. tree.gedcomx.json grew at least one NEW ParentChild
         relationship whose `parent` is an in-tree person from before
         and whose `child` is one of the new persons.
      3. Each new person carries only the minimal stub shape — a
         preferred name and gender — and NO `facts` (those belong to
         the per-sibling assertions in research.json from step 5b).

    Skips when before/after tree is unavailable so non-§5d tests aren't
    falsely failed."""
    if "sibling-stubs" not in test.get("tags", []):
        pytest.skip("not a sibling-stubs scenario")

    before_tree = before_state.get("tree_gedcomx_json") or before_state.get(
        "tree.gedcomx.json"
    )
    after_tree = after_state.get("tree_gedcomx_json") or after_state.get(
        "tree.gedcomx.json"
    )
    if before_tree is None or after_tree is None:
        pytest.skip("Missing tree.gedcomx.json for diff")

    before_person_ids = {
        p.get("id") for p in before_tree.get("persons", []) if isinstance(p, dict)
    }
    before_rel_ids = {
        r.get("id") for r in before_tree.get("relationships", []) if isinstance(r, dict)
    }

    new_persons = [
        p
        for p in after_tree.get("persons", [])
        if isinstance(p, dict) and p.get("id") not in before_person_ids
    ]
    assert new_persons, (
        "sibling-stubs scenario produced no new person entries in "
        "tree.gedcomx.json — SKILL.md §5d trigger fired without writing "
        "sibling stubs"
    )

    new_rels = [
        r
        for r in after_tree.get("relationships", [])
        if isinstance(r, dict) and r.get("id") not in before_rel_ids
    ]
    new_pc_rels = [r for r in new_rels if r.get("type") == "ParentChild"]
    new_person_ids = {p.get("id") for p in new_persons}
    bridging = [
        r
        for r in new_pc_rels
        if r.get("parent") in before_person_ids
        and r.get("child") in new_person_ids
    ]
    assert bridging, (
        "no new ParentChild relationship links an existing in-tree "
        "parent to a newly created sibling — the stub was written but "
        "the ParentChild edge is missing, so buildParentMob still can't "
        "discover the sibling"
    )

    shape_errors = []
    for p in new_persons:
        pid = p.get("id", "?")
        if p.get("facts"):
            shape_errors.append(
                f"{pid}: sibling stub has facts[] — per §5d, facts belong "
                f"to the per-sibling assertions in research.json, not on "
                f"the stub itself"
            )
        names = p.get("names") or []
        if not any(n.get("preferred") is True for n in names):
            shape_errors.append(
                f"{pid}: sibling stub has no preferred name (§5d requires "
                f"`preferred: true` on the single name entry)"
            )
        if p.get("gender") not in ("Male", "Female"):
            shape_errors.append(
                f"{pid}: sibling stub gender {p.get('gender')!r} is not "
                f"Male/Female (§5d derives gender from the record's sex column)"
            )
    assert not shape_errors, (
        "sibling stub shape violations:\n  - " + "\n  - ".join(shape_errors)
    )


# --- Sidecar-gated: record_persona_id on record_search assertions ----

def _staged_sidecar_record_ids(state):
    """Collect the record ids staged in the scenario's search sidecars
    (results/<log_id>.json in the workspace `files` snapshot), normalized
    to their `ark:/...` tail so any accepted record_id form matches.
    Returns a set (empty when the scenario staged no sidecar)."""
    import json

    ids = set()
    for rel_path, content in (state.get("files") or {}).items():
        if not (rel_path.startswith("results/") and rel_path.endswith(".json")):
            continue
        try:
            sidecar = json.loads(content)
        except (ValueError, TypeError):
            continue  # malformed sidecar fixtures have their own tests
        payload = sidecar.get("payload") or {}
        for result in payload.get("results") or []:
            for key in ("recordId", "arkUrl"):
                rid = result.get(key)
                if rid:
                    ids.add(_normalize_record_id(rid))
    return ids


def _normalize_record_id(rid):
    """Reduce a record id to its `ark:/...` tail when present (full arkUrl,
    bare ark, and entity-prefixed forms all compare equal); non-ark ids
    compare verbatim."""
    idx = rid.find("ark:/")
    return rid[idx:] if idx != -1 else rid


def test_record_persona_id_set(before_state, after_state, test):
    """Sidecar-gated: when the scenario staged a search sidecar
    (results/<log_id>.json), EVERY new assertion whose record_id matches a
    record staged in that sidecar must carry a non-null record_persona_id
    — per-assertion coverage, EXPLICITLY INCLUDING the focus persona (the
    searched person, id = the result's primaryId). "The primary is
    implied" is the known failure mode; "at least one assertion has it" is
    not coverage. Those assertions must also carry record_id in full
    arkUrl form — so person-evidence can later resolve the record and call
    same_person. Sidecar-less scenarios (record_read / image / PDF
    extractions) skip: supplying record_persona_id there is a hard error
    by contract."""
    sidecar_ids = _staged_sidecar_record_ids(before_state)
    if not sidecar_ids:
        pytest.skip("scenario staged no search sidecar")

    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_ids = {a.get("id") for a in before.get("assertions", [])}
    new = [a for a in after.get("assertions", []) if a.get("id") not in before_ids]

    matched = [
        a for a in new
        if _normalize_record_id(a.get("record_id") or "") in sidecar_ids
    ]
    if "record-persona-id" in test.get("tags", []):
        assert new, "expected new assertions extracted from the record"
        assert matched, (
            "no new assertion's record_id matches the staged sidecar record "
            "— either nothing was extracted from the staged record or every "
            "record_id is malformed beyond recognition"
        )
    elif not matched:
        pytest.skip("no new assertions from the staged sidecar record")

    errors = []
    for a in matched:
        aid = a.get("id", "?")
        if not a.get("record_persona_id"):
            errors.append(
                f"{aid}: missing record_persona_id (per-assertion coverage "
                f"— the focus persona is NOT implied; its id is the "
                f"result's primaryId)"
            )
        rid = a.get("record_id") or ""
        if not rid.startswith("http"):
            errors.append(f"{aid}: record_id {rid!r} is not a full arkUrl")
    assert not errors, (
        "record_search assertions wrongly shaped:\n  - " + "\n  - ".join(errors)
    )

DESTRUCTIVE_TREE_OPS = {"update_name", "update_person", "remove"}


def test_extraction_makes_no_destructive_tree_ops(tool_calls):
    """Extraction adds evidence; it never renames, rewrites, or removes
    existing tree entities. `update_name` / `update_person` / `remove`
    are identity-resolution and correction acts owned by person-evidence,
    hypothesis-tracking, and the tree-edit skill. A record persona judged
    to BE an existing tree person under a variant name gets an `add_name`
    (alternate, non-preferred) — never an `update_name`. Structural
    enforcement for the ut_013 rename incident (2026-07-12): prose
    prohibitions do not hold when the model believes it is correcting an
    error."""
    offending = []
    for call in tool_calls:
        tool = (call.get("tool") or "").rsplit("__", 1)[-1]
        if tool != "tree_edit":
            continue
        args = call.get("args") or {}
        ops = args.get("ops")
        if not isinstance(ops, list):
            ops = [args] if args.get("operation") else []
        for i, op in enumerate(ops):
            name = (op or {}).get("operation")
            if name in DESTRUCTIVE_TREE_OPS:
                offending.append(f"ops[{i}]: {name}")
    assert not offending, (
        "extraction run emitted destructive tree_edit ops (identity "
        "resolution belongs to person-evidence/hypothesis-tracking/"
        "tree-edit, not extraction): " + "; ".join(offending)
    )
