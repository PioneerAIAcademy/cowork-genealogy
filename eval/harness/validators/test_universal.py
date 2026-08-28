"""Universal validators that run on every test, regardless of skill.

These check structural correctness of the output files against
the research schema spec (docs/specs/research-schema-spec.md).

## Validator function signatures

The harness (eval/harness/harness/validator_runner.py) inspects each
validator's signature and supplies whichever of these args it declares.
**Each is a separate parameter — `tool_calls` does NOT live inside
before_state/after_state.**

  - `before_state` (dict): scenario state before the skill ran. Keys:
      "research_json"      — parsed research.json or None
      "tree_gedcomx_json"  — parsed tree.gedcomx.json or None
      "tree_gedcomx"       — alias for backwards compatibility
      "files"              — {rel_path: text} for non-JSON files
      "skill_frontmatter"  — parsed YAML frontmatter of the skill's SKILL.md
  - `after_state` (dict): same shape, after the skill ran
  - `tool_calls` (list): every MCP tool call the skill made, with shape
      {"tool": "mcp__server__tool", "args": dict, "matched": {...},
       "response_fixture": str|None, "response": dict}
  - `skill_frontmatter` (dict): convenience copy of before_state's value
  - `blocked_context_calls` (list): main-thread calls to subagent-only
      tools that the PreToolUse hook denied, with shape
      {"tool": "image_read", "args": dict}. Empty = healthy. These calls
      were blocked, so they never appear in `tool_calls`.
  - `text_response` (str): every assistant text block concatenated, not
      the final reply alone — the same string the run log stores as
      `output.text_response`. Empty when the run produced no assistant
      text. For a LITERAL property of the text (a phrase that must never
      appear, an identifier that must be named); not for re-grading prose
      quality, which is the judge's job.

A validator can take any subset of these. Functions are plain pytest
test functions (raise AssertionError on failure). pytest.skip("...") is
treated as "not applicable to this state" — recorded as passed with a
skip marker, not as a failure.
"""

import re
from pathlib import Path

import pytest

from harness.ownership import (
    RESEARCH_JSON,
    TREE_GEDCOMX_JSON,
    writer_sets,
)
from harness.schema_validator import (
    validate_research_json,
    validate_tree_gedcomx_json,
)
from harness.ts_validator import validate_parsed


# The research.json sections the diff-aware tests below iterate —
# `test_no_entries_deleted` and `test_id_references_resolve`. Shape, enums, ID
# prefixes, and required fields are all delegated to jsonschema
# (research.schema.json) per spec §8; this list is the only enum-table kept in
# Python.
#
# It was called REQUIRED_SECTIONS and was neither: it omitted `evaluations`,
# which the schema does require, and now carries two sections the schema makes
# optional. What it actually is is the diff set, so that is its name.
#
# Every top-level property EXCEPT `researcher_profile`, which is an object rather
# than an array of id-bearing entries — both tests below iterate entries and read
# `.get("id")`, so it has nothing for them to check. `plan_items` is likewise
# absent: it is `research_append`'s pseudo-section for `plans[].items[]`, not a
# top-level property, and a plan-item change already shows up here under `plans`.
#
# The two ownership checks do NOT read this list — they iterate the ownership
# manifest, which is keyed on a wider vocabulary again. Keeping them on this list
# is what left `localities` with a declared owner that was never once evaluated.
DIFFED_SECTIONS = [
    "project", "known_holdings", "questions", "plans", "log", "sources",
    "assertions", "person_evidence", "conflicts",
    "hypotheses", "timelines", "proof_summaries",
    "evaluations", "localities",
]


# --- Schema validation (delegated to jsonschema per spec §8) ---

def test_research_json_validates_schema(after_state):
    """research.json must validate against docs/specs/schemas/research.schema.json.

    Covers what was previously hand-rolled in five separate Python tests:
    required sections, project-is-object, sections-are-arrays, closed-enum
    values, and ID-prefix patterns. The schema files are the single source
    of truth — when they change, this test picks it up automatically.
    """
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")
    errors = validate_research_json(research)
    assert not errors, (
        "research.json failed schema validation:\n  - "
        + "\n  - ".join(errors)
    )


def test_tree_gedcomx_json_validates_schema(after_state):
    """tree.gedcomx.json must validate against tree-gedcomx.schema.json.

    Previously omitted entirely — spec §8 required schema validation for
    BOTH files. Catches structural drift in the GedcomX output (missing
    required keys, wrong types, invalid enum values) at validator time
    instead of at upload time.
    """
    tree = after_state.get("tree_gedcomx_json")
    if tree is None:
        pytest.skip("No tree.gedcomx.json in output")
    errors = validate_tree_gedcomx_json(tree)
    assert not errors, (
        "tree.gedcomx.json failed schema validation:\n  - "
        + "\n  - ".join(errors)
    )


def test_project_files_pass_full_validation(after_state):
    """research.json + tree.gedcomx.json must pass the FULL runtime validator,
    not just jsonschema.

    The schema validators above (jsonschema) cannot express reference
    integrity: a dangling `ParentChild`/`Couple` endpoint, a tree `source` ref
    with no `sources[]` entry, a cross-file `subject_person_ids` /
    `relates_to_person_ids` / `gedcomx_source_description_id` that names nothing
    in the tree, or an ancestry cycle. A writer-tool write is validated by the
    runtime validator before it persists; a from-scratch hand-serialized write
    (init-project's `Write`) is not — #987. This closes that gap
    path-agnostically by running the SINGLE source of truth, the compiled TS
    `validateParsed`, on the output files.

    Needs both files (cross-file checks). Skips — never fails — when the
    compiled validator is unavailable (build absent), since `build/` is not in
    the run-log snapshot; a missing build must not red the suite.
    """
    research = after_state.get("research_json")
    tree = after_state.get("tree_gedcomx_json")
    if research is None or tree is None:
        pytest.skip("both research.json and tree.gedcomx.json required for full cross-file validation")

    errors = validate_parsed(research, tree)
    if errors is None:
        pytest.skip("compiled TS validator unavailable (build/ missing) — skip, not fail")
    assert not errors, (
        "project files failed full validation (reference integrity / cross-file "
        "/ cycles that jsonschema cannot catch):\n  - " + "\n  - ".join(errors)
    )


def test_no_duplicate_tree_ids(after_state):
    """tree.gedcomx.json person / relationship / source ids must be unique.

    The runtime `validateGedcomx` does NOT check this — it only `.add()`s ids,
    never `.has()`-checks — so `test_project_files_pass_full_validation` above
    would miss it. A from-scratch hand-serialized tree (init-project mints
    `I1..` / `R1..` / `S1..` by hand) can repeat a number. Pure Python, so it
    runs even when the compiled validator is unavailable.
    """
    tree = after_state.get("tree_gedcomx_json")
    if tree is None:
        pytest.skip("No tree.gedcomx.json in output")

    dups = []
    for section in ("persons", "relationships", "sources"):
        seen = set()
        for item in tree.get(section) or []:
            if not isinstance(item, dict):
                continue
            _id = item.get("id")
            if _id is None:
                continue
            if _id in seen:
                dups.append(f"{section}: duplicate id '{_id}'")
            seen.add(_id)
    assert not dups, (
        "duplicate ids in tree.gedcomx.json:\n  - " + "\n  - ".join(dups)
    )


# Enum and ID-prefix validation are covered by the jsonschema delegation
# above (enums via $ref to enums.schema.json, ID prefixes via the
# `pattern` field on each section's `id` property). The previous
# hand-rolled Python implementations were removed in v1.5 to eliminate
# drift between code and schema.


# --- Append-only enforcement (log section) ---

def test_log_append_only(before_state, after_state):
    """Log entries must not be modified or deleted. New entries may be appended."""
    before_research = before_state.get("research_json")
    after_research = after_state.get("research_json")

    if before_research is None or after_research is None:
        pytest.skip("Missing research.json for diff")

    before_log = before_research.get("log", [])
    after_log = after_research.get("log", [])

    # All original entries must still be present and unmodified
    assert len(after_log) >= len(before_log), (
        f"Log entries deleted: before had {len(before_log)}, "
        f"after has {len(after_log)}"
    )

    for i, before_entry in enumerate(before_log):
        assert i < len(after_log), f"Log entry {before_entry.get('id')} deleted"
        assert after_log[i] == before_entry, (
            f"Log entry {before_entry.get('id')} was modified"
        )


# --- No-delete enforcement ---

def test_no_entries_deleted(before_state, after_state):
    """No entries should be deleted from any section. Supersede with status instead.

    Covers every id-bearing section, including `localities`, `evaluations` and
    `known_holdings` — the three the old list omitted while the prose ownership
    table stated the no-delete rule for all three. Widening it is close to free:
    `research_append`'s op enum is `append | update` with no delete at all, so
    the only route to a deletion is a raw file write, which is already a
    violation on two other counts. Nine unit tests run against a scenario
    carrying entries in any of the three, and no run in the committed e2e corpus
    deletes an entry from any section.
    """
    before_research = before_state.get("research_json")
    after_research = after_state.get("research_json")

    if before_research is None or after_research is None:
        pytest.skip("Missing research.json for diff")

    errors = []
    for section in DIFFED_SECTIONS:
        if section == "project":
            continue  # project is an object, not an array

        before_entries = {
            e.get("id"): e for e in before_research.get(section, [])
        }
        after_entries = {
            e.get("id"): e for e in after_research.get(section, [])
        }

        deleted = set(before_entries) - set(after_entries)
        if deleted:
            errors.append(f"{section}: deleted IDs {deleted}")

    assert not errors, "Entries deleted (should supersede instead):\n" + "\n".join(errors)


# --- ID referential integrity ---

def test_id_references_resolve(after_state):
    """All ID references in the output must point to existing entries."""
    research = after_state.get("research_json")
    if research is None:
        pytest.skip("No research.json in output")

    # Collect all known IDs
    known_ids = set()

    project = research.get("project")
    if project:
        known_ids.add(project.get("id", ""))

    for section in DIFFED_SECTIONS:
        if section == "project":
            continue
        for entry in research.get(section, []):
            known_ids.add(entry.get("id", ""))

    # Collect plan item IDs
    for plan in research.get("plans", []):
        for item in plan.get("items", []):
            known_ids.add(item.get("id", ""))

    known_ids.discard("")

    # Check references (sample of key foreign keys)
    errors = []

    # plans.question_id -> questions
    for plan in research.get("plans", []):
        ref = plan.get("question_id")
        if ref and ref not in known_ids:
            errors.append(f"plans[{plan['id']}].question_id '{ref}' not found")

    # log.plan_item_id -> plan items
    for log_entry in research.get("log", []):
        ref = log_entry.get("plan_item_id")
        if ref and ref not in known_ids:
            errors.append(f"log[{log_entry['id']}].plan_item_id '{ref}' not found")

    # assertions.source_id -> sources
    for assertion in research.get("assertions", []):
        ref = assertion.get("source_id")
        if ref and ref not in known_ids:
            errors.append(
                f"assertions[{assertion['id']}].source_id '{ref}' not found"
            )

    # assertions.log_entry_id -> log
    for assertion in research.get("assertions", []):
        ref = assertion.get("log_entry_id")
        if ref and ref not in known_ids:
            errors.append(
                f"assertions[{assertion['id']}].log_entry_id '{ref}' not found"
            )

    # sources.log_entry_id -> log
    for source in research.get("sources", []):
        ref = source.get("log_entry_id")
        if ref and ref not in known_ids:
            errors.append(
                f"sources[{source['id']}].log_entry_id '{ref}' not found"
            )

    # person_evidence.assertion_id -> assertions
    for pe in research.get("person_evidence", []):
        ref = pe.get("assertion_id")
        if ref and ref not in known_ids:
            errors.append(
                f"person_evidence[{pe['id']}].assertion_id '{ref}' not found"
            )

    # conflicts.competing_assertion_ids -> assertions
    for conflict in research.get("conflicts", []):
        for ref in conflict.get("competing_assertion_ids", []):
            if ref not in known_ids:
                errors.append(
                    f"conflicts[{conflict['id']}].competing_assertion_ids "
                    f"'{ref}' not found"
                )

    # conflicts.preferred_assertion_id -> assertions
    for conflict in research.get("conflicts", []):
        ref = conflict.get("preferred_assertion_id")
        if ref and ref not in known_ids:
            errors.append(
                f"conflicts[{conflict['id']}].preferred_assertion_id "
                f"'{ref}' not found"
            )

    # questions.depends_on / questions.unblocks -> other questions
    for q in research.get("questions", []):
        for field in ("depends_on", "unblocks"):
            for ref in q.get(field, []) or []:
                if ref not in known_ids:
                    errors.append(
                        f"questions[{q['id']}].{field} '{ref}' not found"
                    )

    # questions.resolution_assertion_ids -> assertions
    for q in research.get("questions", []):
        for ref in q.get("resolution_assertion_ids", []) or []:
            if ref not in known_ids:
                errors.append(
                    f"questions[{q['id']}].resolution_assertion_ids "
                    f"'{ref}' not found"
                )

    # hypotheses.supporting_assertion_ids / contradicting_assertion_ids
    for hyp in research.get("hypotheses", []):
        for field in ("supporting_assertion_ids", "contradicting_assertion_ids"):
            for ref in hyp.get(field, []) or []:
                if ref not in known_ids:
                    errors.append(
                        f"hypotheses[{hyp['id']}].{field} '{ref}' not found"
                    )

    # proof_summaries.question_id -> questions
    for ps in research.get("proof_summaries", []):
        ref = ps.get("question_id")
        if ref and ref not in known_ids:
            errors.append(
                f"proof_summaries[{ps['id']}].question_id '{ref}' not found"
            )

    # NOTE: timelines.person_ids references GedcomX persons in
    # tree.gedcomx.json, not entries in research.json. To check those we'd
    # need the tree state passed in alongside research_json — out of scope
    # for this validator. Tracked in unit-test-spec-v2.md under "expand
    # cross-file ID-reference validation."

    assert not errors, "Broken ID references:\n" + "\n".join(errors)


# --- Ownership ---
#
# Which skills may write each section of each project document is declared in
# `docs/specs/schemas/ownership.json` and loaded through `harness.ownership`.
# It used to be two dict literals right here — the "single source of truth",
# held in a pytest validator that runs in neither Cowork nor the hosted path.
#
# The two checks below read only the rows the manifest marks enforceable at the
# `unit` plane, and only the skill callers on them. Two consequences worth
# knowing, both recorded on the rows themselves:
#
#  - A row with an **agent** owner cannot be expressed here at all, because the
#    only caller identity this tier has is `skill_frontmatter["name"]`.
#    `evaluations` is that shape and carries no plane.
#  - A section with no row, or a row this plane cannot enforce, is not checked —
#    it is not default-denied. Default-deny on an undeclared section denies
#    correct writes, which is what a replay of the old literals over the
#    committed corpus measured.
#
# A skill named by no row is read-only (search-wikipedia, historical-context);
# it fails these checks if it touches a project file at all.


def _modified_sections(before: dict, after: dict, sections: list[str]) -> list[str]:
    """Return the names of top-level sections whose contents differ."""
    modified = []
    for section in sections:
        b = before.get(section)
        a = after.get(section)
        # Singletons (project) need direct comparison; arrays compare elementwise.
        if b != a:
            modified.append(section)
    return modified


def _only_project_updated_changed(before: dict, after: dict) -> bool:
    """True if `project` differs only in the `updated` audit timestamp.

    `project.updated` is a per-session activity ping: any skill that
    successfully modifies research.json may refresh it. Substantive
    project fields (id, objective, subject_person_ids, status, created)
    remain restricted to the `project` row's declared writers.
    """
    bp = before.get("project")
    ap = after.get("project")
    if not isinstance(bp, dict) or not isinstance(ap, dict):
        return False
    bp_copy = {k: v for k, v in bp.items() if k != "updated"}
    ap_copy = {k: v for k, v in ap.items() if k != "updated"}
    return bp_copy == ap_copy and bp.get("updated") != ap.get("updated")


def test_ownership_table(before_state, after_state, skill_frontmatter, test):
    """Universal: skill may only modify research.json sections it owns.

    Driven by the ownership manifest's research.json rows. A skill modifying a
    section it doesn't own fails the test — that's the single biggest layer-1
    defense for cross-skill state corruption.

    The skill name is read from skill_frontmatter["name"]. If the
    frontmatter is missing a name, we skip rather than fail (caller
    error, not a skill defect).

    Skipped on negative tests: the skill under test is supposed to
    decline, so any research.json change was made by the routed-to
    skill, which has its own ownership rights — attributing those
    writes to the skill under test is a false positive. A negative
    test where the skill *does* wrongly activate already fails on the
    routing check.
    """
    if test.get("type") == "negative":
        pytest.skip(
            "ownership is not checked on negative tests — writes belong "
            "to the routed-to skill, not the skill under test"
        )

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for ownership diff")

    skill_name = (skill_frontmatter or {}).get("name")
    if not skill_name:
        pytest.skip("skill_frontmatter has no `name` field")

    owners = writer_sets(RESEARCH_JSON)
    modified = _modified_sections(before, after, sorted(owners))
    unauthorized = []
    for section in modified:
        if skill_name not in owners[section]:
            # `project.updated` is an activity ping any skill may touch.
            # If the only delta inside `project` is that timestamp, don't
            # flag it as an ownership violation.
            if section == "project" and _only_project_updated_changed(before, after):
                continue
            unauthorized.append(section)

    if unauthorized:
        # Sort for stable error messages.
        owners_summary = {s: sorted(owners[s]) for s in unauthorized}
        assert False, (
            f"{skill_name} modified sections it doesn't own: {sorted(unauthorized)}. "
            f"Allowed writers per section: {owners_summary}"
        )


def test_tree_ownership_table(before_state, after_state, skill_frontmatter, test):
    """Universal: skill may only modify tree.gedcomx.json sections it owns.

    Parallel to test_ownership_table, but for tree.gedcomx.json. Driven by the
    ownership manifest's tree.gedcomx.json rows. Without this check, tree-edit
    and proof-conclusion writes to that file would pass vacuously — there was
    no ownership coverage at all in earlier versions.

    Skipped on negative tests for the same reason as test_ownership_table
    — a routed-to skill's legitimate writes would otherwise be
    misattributed to the skill under test.
    """
    if test.get("type") == "negative":
        pytest.skip(
            "ownership is not checked on negative tests — writes belong "
            "to the routed-to skill, not the skill under test"
        )

    before = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for ownership diff")

    skill_name = (skill_frontmatter or {}).get("name")
    if not skill_name:
        pytest.skip("skill_frontmatter has no `name` field")

    owners = writer_sets(TREE_GEDCOMX_JSON)
    modified = _modified_sections(before, after, sorted(owners))
    unauthorized = [s for s in modified if skill_name not in owners[s]]

    if unauthorized:
        owners_summary = {s: sorted(owners[s]) for s in unauthorized}
        assert False, (
            f"{skill_name} modified tree.gedcomx.json sections it doesn't own: "
            f"{sorted(unauthorized)}. Allowed writers per section: {owners_summary}"
        )


def test_tool_allowlist(tool_calls, skill_frontmatter, test, attempted_mcp_calls=None):
    """Advisory: warns when MCP tool calls are not in the skill's allowed-tools.

    The session grants every registered MCP tool (issue #1748), so this
    validator no longer gates. Undeclared calls are surfaced as Python
    warnings for the reviewer. See unit-test-spec.md §15,
    "Deriving allowed_tools per skill".

    The declared set is widened with the frontmatter `tools:` of every
    plugin agent the skill's SKILL.md references via `@plugin:<name>` —
    a delegated agent's MCP calls land in the same session tool_calls log,
    and they are legitimate exactly when the skill body instructs the
    delegation. Mirrors harness.allowed_tools.compute_allowed_tools.

    Skipped on negative tests: tool calls come from the routed-to skill,
    not the skill under test, so checking against the skill under test's
    allowed-tools would be a false positive.
    """
    import warnings as _warnings

    if test.get("type") == "negative":
        pytest.skip(
            "allowlist is not checked on negative tests — tool calls "
            "belong to the routed-to skill, not the skill under test"
        )
    # Union tool_calls with attempted_mcp_calls: the latter captures MCP calls
    # that the model emitted but that never reached a fixture match (denied by
    # policy, caps, or aborts). Without this, a skill that tried a tool its
    # frontmatter doesn't declare — but was denied before the mock could serve
    # it — slips past this check entirely (issue #1748).
    _attempted = [
        c for c in (attempted_mcp_calls or [])
        if c.get("tool", "").startswith("mcp__")
    ]
    all_calls = list(tool_calls) + _attempted
    if not all_calls:
        return
    declared = set((skill_frontmatter or {}).get("allowed-tools", []) or [])

    # Widen with referenced plugin agents' tools (bare MCP names only —
    # built-in tools like Read never appear in tool_calls).
    from harness.allowed_tools import agent_refs_for_skill, load_skill_frontmatter
    from harness.workspace import DEFAULT_PLUGIN_AGENTS

    _repo_root = Path(__file__).resolve().parents[3]
    _skill_md = (
        _repo_root / "packages" / "engine" / "plugin" / "skills"
        / str(test.get("skill", "")) / "SKILL.md"
    )
    for _agent in agent_refs_for_skill(_skill_md):
        _agent_fm = load_skill_frontmatter(DEFAULT_PLUGIN_AGENTS / f"{_agent}.md")
        for _t in _agent_fm.get("tools", []) or []:
            # Agent frontmatter lists MCP tools in qualified form
            # (mcp__genealogy__wikipedia_search — the SDK resolves subagent
            # tools by exposed name); this validator compares bare names, so
            # normalize. Built-ins (capitalized) never appear in tool_calls.
            _bare = _t.split("__")[-1] if "__" in _t else _t
            if not _bare[:1].isupper():
                declared.add(_bare)

    # Widen with the `allowed-tools` of every sub-skill the test declared in
    # `execution.run_skills`. A `Skill()` callee runs in the caller's session,
    # so its calls land in this same tool_calls log — legitimate exactly when
    # the test opted the callee in. Without this the validator reads a working
    # hand-off as an allowlist violation, which is what it did on the first
    # run of ut_search_records_026 (`place_search`, `external_links_search`).
    # Mirrors the sub-skill union in harness.allowed_tools (issue #1012); the
    # two must widen by the same rule or a legal call fails after the fact.
    _skills_dir = _repo_root / "packages" / "engine" / "plugin" / "skills"
    for _callee in (test.get("execution", {}) or {}).get("run_skills", []) or []:
        _callee_md = _skills_dir / str(_callee) / "SKILL.md"
        _callee_fm = load_skill_frontmatter(_callee_md)
        _entries = list(_callee_fm.get("allowed-tools", []) or [])
        # Plus the callee's own @plugin: agents. compute_allowed_tools grants
        # these, so omitting them here would flag a legal call as a violation
        # after the fact — the same mismatch this block was added to fix, one
        # hop further down (#1225 review).
        for _agent in agent_refs_for_skill(_callee_md):
            _agent_fm = load_skill_frontmatter(DEFAULT_PLUGIN_AGENTS / f"{_agent}.md")
            _entries.extend(_agent_fm.get("tools", []) or [])
        for _t in _entries:
            _bare = _t.split("__")[-1] if "__" in _t else _t
            if not _bare[:1].isupper():
                declared.add(_bare)

    if not declared:
        bare = [c["tool"].split("__")[-1] for c in all_calls]
        if bare:
            _warnings.warn(
                f"skill called MCP tools but declared none in allowed-tools: "
                f"{bare} (advisory — session grants all tools; issue #1748)"
            )
        return
    bad = []
    for call in all_calls:
        bare = call["tool"].split("__")[-1]
        if bare not in declared:
            bad.append(bare)
    if bad:
        _warnings.warn(
            f"skill called MCP tools not in allowed-tools frontmatter: "
            f"{sorted(set(bad))} (advisory — session grants all tools; "
            f"issue #1748)"
        )


# --- Write-then-validate (V1) ----------------------------------------
#
# If research.json was modified, validate_research_schema must appear in
# tool_calls. Scoped to skills that declare validate_research_schema in
# their allowed-tools frontmatter. Universal because the rule applies to
# any skill that holds the tool, not just citation.

def test_write_then_validate(before_state, after_state, tool_calls, skill_frontmatter, test):
    """If research.json was modified, validate_research_schema must have been called."""
    if test.get("type") == "negative":
        pytest.skip("negative test — tool calls belong to the routed-to skill")
    allowed = (skill_frontmatter or {}).get("allowed-tools", []) or []
    if "validate_research_schema" not in allowed:
        pytest.skip("skill does not declare validate_research_schema")
    before_rj = before_state.get("research_json")
    after_rj = after_state.get("research_json")
    if before_rj is None or after_rj is None:
        pytest.skip("missing research.json")
    import json as _json
    if _json.dumps(before_rj, sort_keys=True) == _json.dumps(after_rj, sort_keys=True):
        pytest.skip("research.json was not modified")
    validate_calls = [
        c for c in tool_calls
        if c.get("tool", "").split("__")[-1] == "validate_research_schema"
    ]
    assert validate_calls, (
        "research.json was modified but validate_research_schema was never "
        "called — the skill must validate after every write"
    )


# --- Hand-edit detection (project files must go through writer tools) ---
#
# The full set of MCP tools that legitimately write research.json /
# tree.gedcomx.json. Matched on the tool-name tail after the mcp prefix
# (mcp__genealogy__research_append → research_append).
PROJECT_WRITER_TOOLS = {
    "research_append",
    "extraction_append",
    "research_log_append",
    "tree_edit",
    "tree_correct",
    "materialize_facts",
    "merge_tree_persons",
}


def test_project_file_changes_route_through_writer_tools(
    before_state, after_state, tool_calls
):
    """Universal: a modified research.json / tree.gedcomx.json requires at
    least one writer-tool call in the session.

    The writer tools validate-before-persist, allocate ids, and keep the
    `.bak` safety copy; a direct file write (Write/Edit/python) bypasses
    all three. Evidence this happens: tree-edit ut_012 (2026-07-12) made
    ZERO tool calls yet research.json grew a person_evidence entry with a
    fabricated `created` date — and every validator passed, because
    nothing checked the write PATH, only the resulting state.

    This is deliberately coarse: any writer-tool call legitimizes the
    session's project-file changes (research_append can touch both files
    via composite persist, so per-file attribution would false-positive).
    The zero-calls case is the unambiguous hand-edit signal.
    """
    changed = []
    diffable = []

    before_research = before_state.get("research_json")
    after_research = after_state.get("research_json")
    if before_research is not None and after_research is not None:
        diffable.append("research.json")
        if before_research != after_research:
            changed.append("research.json")

    before_tree = before_state.get("tree_gedcomx_json") or before_state.get(
        "tree_gedcomx"
    )
    after_tree = after_state.get("tree_gedcomx_json") or after_state.get(
        "tree_gedcomx"
    )
    if before_tree is not None and after_tree is not None:
        diffable.append("tree.gedcomx.json")
        if before_tree != after_tree:
            changed.append("tree.gedcomx.json")

    if not diffable:
        pytest.skip("Missing research.json/tree.gedcomx.json for diff")
    if not changed:
        return

    writer_calls = [
        c
        for c in (tool_calls or [])
        if (c.get("tool") or "").rsplit("__", 1)[-1] in PROJECT_WRITER_TOOLS
    ]
    assert writer_calls, (
        f"project file {' and '.join(changed)} modified with no writer-tool "
        f"call — direct file writes bypass validation/id-allocation/.bak; "
        f"route through the writer tools "
        f"({', '.join(sorted(PROJECT_WRITER_TOOLS))})"
    )


def test_no_main_thread_subagent_only_calls(blocked_context_calls):
    """No subagent-only tool was called from the main session.

    `image_read` returns inline base64; in the router's context the bytes
    accumulate and overflow the transport's ~1 MiB per-turn buffer, crashing
    the run. Image reads must be delegated to the image-reader subagent, which
    absorbs the base64 in a throwaway context and returns text.

    `extraction_append` writes the extracted assertions and sources. That is
    the record-extractor subagent's job; a main-thread call is the router
    substituting for a failed spawn and doing the extraction itself (#942).

    This is the deterministic half of what the LLM judge used to grade by
    transcript inference — badly: across the 2026-07-16 runs it caught the
    violation roughly 1-in-8, and a run could pass while violating. The
    PreToolUse hook denies the call and records it here, so the check is
    mechanical. Same spirit as `expected_classifications`
    (unit-test-spec.md §5.10): grade deterministically what is unambiguous,
    leave the judge the genuinely fuzzy parts.

    Rationale + probe evidence: docs/plan/image-read-context-policy.md.
    """
    if not blocked_context_calls:
        return

    # Per-tool fix text: the owning subagent and the reason differ, and a
    # message naming the wrong one sends the reader after the wrong bug.
    owners = {
        "image_read": (
            "image_read → @plugin:image-reader, so the base64 never enters the "
            "router's context"
        ),
        "extraction_append": (
            "extraction_append → @plugin:record-extractor; if that subagent "
            "failed to spawn, report the failure rather than extracting here"
        ),
    }
    offending_tools = sorted({c.get("tool", "?") for c in blocked_context_calls})
    fixes = "; ".join(
        owners.get(t, f"{t} → delegate to its owning subagent")
        for t in offending_tools
    )
    raise AssertionError(
        f"subagent-only tool(s) called from the main session: "
        f"{', '.join(offending_tools)} "
        f"({len(blocked_context_calls)} call(s), denied by the hook). "
        f"Delegate to the owning subagent — {fixes}."
    )


# --- V8: Activated run must produce a response --------------------------

def test_activated_run_produces_response(
    activated, aborted_reason, num_turns, output_tokens, text_response, test,
    skills_invoked,
):
    """An activated run that produced no output is a dead run — fail it.

    Gate on six conditions: activated is True, not aborted, no skills
    invoked, num_turns == 0, output_tokens == 0, AND text_response shorter
    than 200 characters. The skills_invoked check is the strongest signal —
    a run that invoked a skill did real work even when telemetry reports zero
    (343 of 1945 committed runs report zero telemetry normally). The 200-char
    floor avoids flagging telemetry-only dropouts where a real response
    exists.
    """
    if activated is not True:
        pytest.skip("skill did not activate")
    if aborted_reason is not None:
        pytest.skip("run was aborted — already flagged separately")
    if skills_invoked:
        return  # a run that invoked a skill is not a dead run
    if num_turns != 0 or output_tokens != 0:
        return  # telemetry shows work happened
    if len(text_response or "") >= 200:
        return  # substantial response present despite missing telemetry
    assert False, (
        f"activated run produced no meaningful output: num_turns=0, "
        f"output_tokens=0, text_response length={len(text_response or '')} "
        f"(< 200 chars) — the run did not happen"
    )


# --- V7: In-body decline actually declines ------------------------------

def test_decline_response_nonempty(activated, text_response, test):
    """V7(a): an activated negative-test run must produce a non-empty response.

    Tier 1 — gates. If the skill activated on an out-of-scope request but
    produced no response, the test is vacuously passing on no evidence.
    Skips grade_on_invariant tests (those deliberately bypass routing checks).
    """
    if test.get("type") != "negative":
        pytest.skip("positive test")
    if test.get("negative", {}).get("grade_on_invariant"):
        pytest.skip("grade_on_invariant test — routing is not gated")
    if activated is not True:
        pytest.skip("skill did not activate")
    assert (text_response or "").strip(), (
        "activated negative test produced an empty response — cannot evaluate "
        "whether the skill declined the out-of-scope request"
    )


def report_decline_names_routed_skill(activated, text_response, test, skills_invoked):
    """V7(b): the decline response should name the skill it routes to.

    Tier 2 — reports, never gates. The structured signal (skills_invoked)
    already covers routing correctness in _compute_outcome; this is the
    prose-level complement. Skips grade_on_invariant tests per the lead's
    ruling (issue #1749).
    """
    if test.get("type") != "negative":
        pytest.skip("positive test")
    if test.get("negative", {}).get("grade_on_invariant"):
        pytest.skip("grade_on_invariant test — routing is not gated")
    if activated is not True:
        pytest.skip("skill did not activate")
    correct_skills = test.get("negative", {}).get("correct_skill", [])
    if not correct_skills:
        pytest.skip("no correct_skill declared in test")
    response_lower = (text_response or "").lower()
    # Check if any of the correct skills are named in the response
    # (skill names use hyphens; check both hyphenated and space-separated)
    for skill_name in correct_skills:
        if skill_name.lower() in response_lower:
            return
        if skill_name.replace("-", " ").lower() in response_lower:
            return
    raise AssertionError(
        f"the decline response does not name any of the expected skills "
        f"{correct_skills}; the response text contains none of those skill "
        f"names (hyphenated or space-separated)"
    )


def report_decline_no_first_person_commitment(activated, text_response, test):
    """V7(c): no first-person commitment to perform the out-of-scope act.

    Tier 2 — reports. Flags "I'll"/"I will"/"let me"/"I can" followed in
    the same sentence by add/create/extract/format plus source/record.
    """
    import re as _re

    if test.get("type") != "negative":
        pytest.skip("positive test")
    if test.get("negative", {}).get("grade_on_invariant"):
        pytest.skip("grade_on_invariant test — routing is not gated")
    if activated is not True:
        pytest.skip("skill did not activate")
    response = text_response or ""
    # Split into sentences (rough: period/exclamation/question + space/end)
    sentences = _re.split(r'(?<=[.!?])\s+', response)
    commitment_re = _re.compile(
        r"(?:I'?ll|I will|let me|I can)\s+"
        r"(?:(?!\bnot\b|\bnever\b|\bcannot\b|n't).)*?(?:add|create|extract|format)"
        r".*?(?:source|record)",
        _re.IGNORECASE,
    )
    matches = []
    for sent in sentences:
        if commitment_re.search(sent):
            matches.append(sent.strip()[:120])
    if matches:
        raise AssertionError(
            "the decline response contains a first-person commitment to "
            "perform the out-of-scope act: "
            + "; ".join(f'"{m}"' for m in matches)
        )


# --- V2: No unbacked validation claim -----------------------------------

def report_unbacked_validation_claim(text_response, tool_calls, test):
    """V2: text must not assert validation ran unless the tool was called.

    Tier 2 — reports, never gates. Matches case-insensitively on
    'validated', 'validation', 'schema check', 'no warnings' in the same
    sentence as a persistence claim. Cross-skill.

    Observation text is neutral per anti-bias design: states what was
    matched and what the tool ledger holds, nothing else.
    """
    import re as _re

    if test.get("type") == "negative":
        pytest.skip("negative test — tool calls belong to the routed-to skill")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")
    validate_calls = [
        c for c in (tool_calls or [])
        if (c.get("tool") or "").split("__")[-1] == "validate_research_schema"
    ]
    if validate_calls:
        return  # validation actually ran — no claim is unbacked

    # Split into sentences and look for validation language near persistence
    sentences = _re.split(r'(?<=[.!?✓✗])\s+|(?<=\n)', response)
    validation_re = _re.compile(
        r'\b(?:validated|validation|schema\s+check|no\s+warnings)\b',
        _re.IGNORECASE,
    )
    persistence_re = _re.compile(
        r'\b(?:writ(?:ten|e|ing)|persist|sav(?:ed|ing)|append|research\.json)\b',
        _re.IGNORECASE,
    )
    matches = []
    for sent in sentences:
        if validation_re.search(sent) and persistence_re.search(sent):
            matches.append(sent.strip()[:150])
    if matches:
        raise AssertionError(
            "the response contains "
            + "; ".join(f"'{m}'" for m in matches[:3])
            + " — a validation/persistence claim in the same sentence; "
            "no validate_research_schema call appears in the tool ledger"
        )


def test_no_raw_writes_to_protected_files(blocked_protected_writes):
    """No raw Write/Edit/NotebookEdit hit research.json / tree.gedcomx.json.

    Those two documents must be written only through the MCP writer tools
    (research_append, research_log_append, tree_edit, tree_correct), which
    validate, allocate ids, and keep a `.bak` before persisting. A direct file
    write skips all of that. The rule ships as a PreToolUse deny in Cowork, the
    hosted control plane, and the e2e harness; this validator is the unit tier's
    half of it (issue #1493).

    Deterministic, like `test_no_main_thread_subagent_only_calls`: the hook
    denies the write and records it here, so a raw-write attempt is caught
    mechanically rather than left to the judge — and because the hook blocks the
    call, the attempt never reaches `tool_calls`, so this list is the only place
    it is visible. Empty is the healthy case.
    """
    if not blocked_protected_writes:
        return

    offending = sorted(
        {
            f"{c.get('tool', '?')} → {(c.get('args') or {}).get('file_path', '?')}"
            for c in blocked_protected_writes
        }
    )
    raise AssertionError(
        f"raw write(s) to a protected project file, denied by the hook "
        f"({len(blocked_protected_writes)} call(s)): {'; '.join(offending)}. "
        f"Route writes to research.json / tree.gedcomx.json through the writer "
        f"tools (research_append, research_log_append, tree_edit, tree_correct), "
        f"which validate before persisting."
    )


# --- Parent-child age plausibility (write-time gate) ------------------
#
# Bounds reused verbatim from packages/engine/mcp-server/src/tools/
# person-warnings.ts (earliestChildBirthToBirth12, earliestChildBirthToBirthMale14,
# latestChildBirthToBirth80, latestChildBirthToBirthFemale45) rather than invented
# here. Known gap this inherits rather than papers over: person-warnings.ts has no
# female-specific LOWER bound (only general <=12, male-specific <=14), so a
# mother's age-14 birth -- the exact age in issue #1642 Finding 2's motivating bug
# (jimmie-jewel-neal/run-2026-07-31_13-02-13, the Wood-family adoption) -- is not
# caught by either lower bound. That is a separate open question for
# person-warnings.ts's own coverage, not something this validator papers over.

_PARENT_AGE_LOWER_GENERAL = 12
_PARENT_AGE_LOWER_MALE = 14
_PARENT_AGE_UPPER_GENERAL = 80
_PARENT_AGE_UPPER_FEMALE = 45

_UNCERTAINTY_MARKERS = (
    r"needs?-?review",
    r"speculative",
    r"uncertain",
    r"inferr",
    r"unconfirmed",
    r"possible\s+namesake",
    r"not\s+(?:yet\s+)?confirmed",
    r"tentative",
)


def _birth_year_and_gender(tree, person_id):
    """(birth year, gender) for a tree person, or (None, gender) if no dated
    birth-like fact is found. Reads Birth/Christening/Baptism, in that order
    of preference, taking the first 4-digit year in the fact's `date`."""
    for p in (tree.get("persons") or []):
        if p.get("id") != person_id:
            continue
        gender = p.get("gender")
        for fact_type in ("Birth", "Christening", "Baptism"):
            for f in (p.get("facts") or []):
                if f.get("type") != fact_type:
                    continue
                m = re.search(r"\d{4}", f.get("date") or "")
                if m:
                    return int(m.group(0)), gender
        return None, gender
    return None, None


def test_parent_child_age_plausibility_flagged(before_state, after_state):
    """Universal: a new ParentChild relationship implying an implausible
    parent age at the child's birth must carry an uncertainty note.

    Issue #1642 Finding 2 (mercyokum): jimmie-jewel-neal run
    2026-07-31_13-02-13 adopted a same-surname Wood household as Martha's
    birth family with an implied parent age of 14 at the child's birth, no
    needs-review marker, after the run's own mid-session gps-mentor check had
    already disproved a different wrong Wood lineage. Not scoped to
    search-records specifically -- this checks the write (tree.gedcomx.json),
    wherever it came from (record-extraction, tree-edit, merge_tree_persons),
    matching the "research.json / tree.gedcomx.json... after-state" shape of
    mercyokum's own validator request.

    Detection primitive reused, not reinvented: the age bounds are the exact
    ones packages/engine/mcp-server/src/tools/person-warnings.ts already
    treats as implausible for `check-warnings` (earliestChildBirthToBirth12 /
    Male14, latestChildBirthToBirth80 / Female45) -- see the module comment
    above for the coverage gap this inherits rather than fixes.

    A relationship this flags must carry a `notes[]` entry using inference/
    uncertainty language (see _UNCERTAINTY_MARKERS) -- the same shape as
    test_pre1880_census_structure_marked_inferred's marker check, applied to
    the tree side rather than the search log.
    """
    before_tree = before_state.get("tree_gedcomx_json") or before_state.get(
        "tree_gedcomx"
    )
    after_tree = after_state.get("tree_gedcomx_json") or after_state.get(
        "tree_gedcomx"
    )
    if before_tree is None or after_tree is None:
        pytest.skip("missing tree.gedcomx.json for diff")
    before_relationships = before_tree.get("relationships") or []
    before_ids = set()
    for r in before_relationships:
        before_ids.add(r.get("id"))
    after_relationships = after_tree.get("relationships") or []
    new_rels = []
    for r in after_relationships:
        if r.get("type") != "ParentChild":
            continue
        if r.get("id") in before_ids:
            continue
        new_rels.append(r)
    if not new_rels:
        pytest.skip("no new ParentChild relationships")
    offenders = []
    for rel in new_rels:
        parent_year, parent_gender = _birth_year_and_gender(after_tree, rel.get("parent"))
        child_year, _ = _birth_year_and_gender(after_tree, rel.get("child"))
        if parent_year is None or child_year is None:
            continue
        age = child_year - parent_year
        too_young_general = age <= _PARENT_AGE_LOWER_GENERAL
        too_young_male = parent_gender == "Male" and age <= _PARENT_AGE_LOWER_MALE
        too_old_general = age >= _PARENT_AGE_UPPER_GENERAL
        too_old_female = parent_gender == "Female" and age >= _PARENT_AGE_UPPER_FEMALE
        implausible = too_young_general or too_young_male or too_old_general or too_old_female
        if not implausible:
            continue
        rel_notes = rel.get("notes") or []
        notes = " ".join(rel_notes)
        flagged = False
        for pattern in _UNCERTAINTY_MARKERS:
            if re.search(pattern, notes, re.IGNORECASE):
                flagged = True
        if flagged:
            continue
        offenders.append((rel.get("id"), rel.get("parent"), rel.get("child"), age, notes))
    messages = []
    for rid, pid, cid, age, notes in offenders:
        messages.append(f"{rid}: parent {pid} age {age} at child {cid}'s birth (notes={notes!r})")
    assert not offenders, (
        "new ParentChild relationship(s) imply an implausible parent age at "
        "the child's birth with no uncertainty note (issue #1642 Finding 2) -- "
        "flag needs-review/speculative before writing a plain link: "
        + "; ".join(messages)
    )
