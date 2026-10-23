"""Skill-specific validators for the validate-schema skill.

Mechanical checks live here; narrative judgment about validation
reporting lands on the validate-schema `rubric.md` dimensions plus the
base Correctness + Completeness dimensions in the LLM judge.

The agent calls the validate_research_schema MCP tool and reports findings.
It never edits a file to fix an error: its one write is the report, logged
inside a project as one `validate_schema` research-log entry (issue #3524).
Universal validators in test_universal.py confine it to the `log` row of the
ownership manifest; this file pins the rest.

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import pytest

from validators_lib import (
    assert_only_logs_report,
    assert_reply_carries_report,
    assert_report_logged,
)


# --- Tool-allowlist enforcement ---------------------------------------

def test_only_calls_validate_research_schema(tool_calls):
    """validate-schema must only call the validate_research_schema MCP tool,
    plus at most one `research_log_append` logging the report (issue #3524).
    """
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    allowed = {"mcp__genealogy__validate_research_schema", "mcp__genealogy__research_log_append"}
    disallowed = [tc for tc in mcp_calls if tc.get("tool") not in allowed]
    assert not disallowed, (
        f"validate-schema should only call validate_research_schema (and "
        f"research_log_append once), but called: "
        f"{[tc['tool'] for tc in disallowed]}"
    )
    logs = sum(1 for tc in mcp_calls if tc.get("tool") == "mcp__genealogy__research_log_append")
    assert logs <= 1, (
        f"validate-schema called research_log_append {logs} times; one report is one entry"
    )


# --- Write enforcement ------------------------------------------------

def test_does_not_modify_project_files(before_state, after_state, test):
    """validate-schema never edits a file to fix an error. research.json may
    change only by one appended `validate_schema` log entry (issue #3524);
    tree.gedcomx.json must be identical before and after.

    Universal `test_ownership_table` confines the agent to `log`. This
    validator backs that: no other section, no edit to an earlier entry, at
    most one new entry, and no research.json created with no project.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    assert_only_logs_report(before_state, after_state, "validate_schema", "validate-schema")

    before_tree = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after_tree = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before_tree is not None and after_tree is not None:
        assert before_tree == after_tree, (
            "validate-schema modified tree.gedcomx.json — it must never edit a file"
        )


def test_does_not_modify_sidecars_or_other_files(before_state, after_state, test):
    """validate-schema edits no file other than its one log entry, not just
    the two main JSONs.

    `test_does_not_modify_project_files` above guards research.json and
    tree.gedcomx.json. `snapshot_files` puts every *other* workspace file into
    the `files` map as `{rel_path: content}` (research.json / tree.gedcomx.json
    are lifted out into their own keys, so they are not double-checked here).
    Comparing the two `files` maps therefore catches anything this skill must
    never touch but the whole-file check never sees — a `results/*.json` sidecar
    (e.g. the skill "fixing" the bad sidecar in ut_validate_schema_009 instead of
    reporting it) or any other file added, removed, or modified.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before_files = (before_state or {}).get("files", {}) or {}
    after_files = (after_state or {}).get("files", {}) or {}

    added = sorted(set(after_files) - set(before_files))
    removed = sorted(set(before_files) - set(after_files))
    modified = sorted(
        p
        for p in (set(before_files) & set(after_files))
        if before_files[p] != after_files[p]
    )
    assert not (added or removed or modified), (
        "validate-schema must be read-only for every file, but the run changed "
        f"the workspace — added: {added}, removed: {removed}, modified: {modified}. "
        "It reports errors and leaves the fix to the user; it never edits a file, "
        "including results/*.json sidecars."
    )


def test_report_logged(before_state, after_state, test):
    """Tag `logs-report`: exactly one new `validate_schema` entry carrying the
    report — including into a project whose files fail validation."""
    if "logs-report" not in test.get("tags", []):
        pytest.skip("not a logs-report test")
    assert_report_logged(before_state, after_state, "validate_schema")


def test_reply_carries_logged_report(before_state, after_state, test, agent_returns=None, text_response=None):
    """The report logged as `validate_schema` is also what the agent returns (issue
    #3524). Graded on the agent's own return (`subject_reply_text`), since the
    judge on a direct test reads the dispatcher's relay."""
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, "validate-schema", test)
    assert_reply_carries_report(before_state, after_state, "validate_schema", reply)
