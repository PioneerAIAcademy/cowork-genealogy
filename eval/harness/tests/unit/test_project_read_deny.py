"""Unit tests for the P2 filesystem denials in the e2e orchestrator.

`--deny-project-reads` refuses Read/Grep/Glob of the project folder so the
agent must reach it through the MCP tools, the way the hosted sandbox forces
it to; `--deny-shell` refuses Bash/PowerShell. Both are pure functions
(`project_read_denied`, `filesystem_denial`) because the hook that calls them
is reachable only from a paid e2e run.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from e2e.orchestrator import filesystem_denial, project_read_denied

ROOT = "/tmp/e2e-rejnic-burial-abc123"
CFG = "/Users/tester/.claude"


def denied(tool: str, tool_input: dict | None, *, cwd: str = ROOT, root: str = ROOT, cfg: str = CFG):
    return project_read_denied(tool, tool_input, cwd=cwd, project_root=root, config_root=cfg)


# --- what is denied, and which MCP route the reason names --------------------


def test_research_json_is_denied_and_routed_to_research_query():
    reason = denied("Read", {"file_path": f"{ROOT}/research.json"})
    assert reason is not None
    assert "research_query" in reason
    assert "record_read" not in reason


def test_tree_is_denied_and_routed_to_project_context():
    reason = denied("Read", {"file_path": f"{ROOT}/tree.gedcomx.json"})
    assert reason is not None
    assert "project_context" in reason


def test_results_sidecar_is_denied_and_routed_to_record_read():
    reason = denied("Read", {"file_path": f"{ROOT}/results/log-7.json"})
    assert reason is not None
    assert "record_read({recordId, resultsRef})" in reason


def test_evaluations_is_denied_and_routed_to_research_query():
    reason = denied("Read", {"file_path": f"{ROOT}/evaluations/q1.json"})
    assert reason is not None
    assert "research_query" in reason


def test_relative_grep_path_resolves_against_cwd():
    reason = denied("Grep", {"pattern": "burial", "path": "results"})
    assert reason is not None
    assert "record_read" in reason


def test_glob_with_no_path_is_the_project_root_and_is_denied():
    reason = denied("Glob", {"pattern": "**/*.json"})
    assert reason is not None
    assert "project_context" in reason


def test_backslash_windows_path_is_denied():
    root = "C:\\Users\\tester\\AppData\\Local\\Temp\\e2e-rejnic-1"
    reason = denied(
        "Read",
        {"file_path": root + "\\research.json"},
        cwd=root,
        root=root,
        cfg="C:\\Users\\tester\\.claude",
    )
    assert reason is not None
    assert "research_query" in reason


def test_dot_dot_traversal_out_of_dot_claude_is_still_denied():
    reason = denied("Read", {"file_path": f"{ROOT}/.claude/../research.json"})
    assert reason is not None


# --- what stays allowed ------------------------------------------------------


def test_staged_skill_reference_is_allowed():
    assert denied("Read", {"file_path": f"{ROOT}/.claude/skills/x/references/y.md"}) is None


def test_staged_agent_is_allowed():
    assert denied("Read", {"file_path": f"{ROOT}/.claude/agents/x.md"}) is None


def test_tool_results_spill_under_config_root_is_allowed():
    assert denied("Read", {"file_path": f"{CFG}/projects/k/s/tool-results/t.txt"}) is None


def test_tilde_spelling_of_the_spill_dir_is_allowed():
    home_cfg = str(Path.home() / ".claude")
    assert denied("Read", {"file_path": "~/.claude/projects/k/s/tool-results/t.txt"}, cfg=home_cfg) is None


def test_tool_results_carve_out_is_real_not_fallthrough():
    """The allow must hold even when the config dir sits INSIDE the project —
    otherwise it is only the everything-else default wearing a name."""
    cfg = f"{ROOT}/.cfg"
    assert denied("Read", {"file_path": f"{cfg}/projects/k/s/tool-results/t.txt"}, cfg=cfg) is None
    assert denied("Read", {"file_path": f"{cfg}/projects/k/s/other.txt"}, cfg=cfg) is not None


def test_etc_hosts_is_allowed():
    assert denied("Read", {"file_path": "/etc/hosts"}) is None


def test_absolute_grep_outside_the_project_is_allowed():
    assert denied("Grep", {"pattern": "x", "path": "/usr/share/dict"}) is None


@pytest.mark.skipif(os.name == "nt", reason="symlink creation needs a privilege on Windows")
def test_symlinked_workspace_is_denied_under_either_spelling(tmp_path):
    # macOS hands out the workspace as /var/folders/... while the model reads
    # /private/var/folders/...; the first P2 run (2026-09-10) allowed every
    # project read because the two spellings never prefix-matched.
    real = tmp_path / "real"
    real.mkdir()
    (real / "research.json").write_text("{}", encoding="utf-8")
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    assert denied("Read", {"file_path": str(real / "research.json")}, cwd=str(link), root=str(link)) is not None
    assert denied("Read", {"file_path": str(link / "research.json")}, cwd=str(real), root=str(real)) is not None
    assert denied("Glob", {"pattern": "*.json"}, cwd=str(link), root=str(real)) is not None


def test_a_sibling_tempdir_with_the_root_as_prefix_is_allowed():
    """`/tmp/e2e-x` must not claim `/tmp/e2e-x-other/...` — prefix on a path
    segment, not on the string."""
    assert denied("Read", {"file_path": f"{ROOT}-other/research.json"}) is None


@pytest.mark.parametrize(
    "tool",
    ["Write", "Edit", "Bash", "Skill", "mcp__genealogy__record_read", "mcp__genealogy__research_query"],
)
def test_non_read_tools_are_not_the_predicate_s_business(tool):
    assert denied(tool, {"file_path": f"{ROOT}/research.json", "path": ROOT}) is None


# --- the hook arm: both flags off means nothing is denied --------------------


def arm(tool: str, tool_input: dict | None, *, deny_shell: bool, deny_project_reads: bool):
    return filesystem_denial(
        tool,
        tool_input,
        deny_shell=deny_shell,
        deny_project_reads=deny_project_reads,
        cwd=ROOT,
        project_root=ROOT,
        config_root=CFG,
    )


def test_flags_off_a_project_read_goes_through():
    assert arm("Read", {"file_path": f"{ROOT}/research.json"}, deny_shell=False, deny_project_reads=False) is None


def test_flags_off_a_shell_call_goes_through():
    assert arm("Bash", {"command": "cat research.json"}, deny_shell=False, deny_project_reads=False) is None


def test_deny_shell_alone_leaves_project_reads_alone():
    assert arm("Read", {"file_path": f"{ROOT}/research.json"}, deny_shell=True, deny_project_reads=False) is None


def test_deny_project_reads_alone_leaves_the_shell_alone():
    assert arm("Bash", {"command": "ls"}, deny_shell=False, deny_project_reads=True) is None


# --- the hook arm: flags on ---------------------------------------------------


def _assert_deny_payload(payload: dict, reason: str) -> None:
    """The shape every other arm of pretool_hook returns."""
    out = payload["hookSpecificOutput"]
    assert out["hookEventName"] == "PreToolUse"
    assert out["permissionDecision"] == "deny"
    assert out["permissionDecisionReason"] == reason
    assert "continue_" not in payload  # the run goes on; only the call is refused


@pytest.mark.parametrize("shell", ["Bash", "PowerShell"])
def test_deny_shell_refuses_both_shells_with_an_mcp_pointer(shell):
    result = arm(shell, {"command": "cat research.json"}, deny_shell=True, deny_project_reads=False)
    assert result is not None
    entry, payload = result
    assert entry["tool"] == shell
    assert entry["blocked_by"] == "shell"
    assert entry["args"] == {"command": "cat research.json"}
    assert "unavailable" in entry["reason"]
    assert "MCP tools" in entry["reason"]
    _assert_deny_payload(payload, entry["reason"])


def test_deny_project_reads_records_tool_path_and_reason():
    result = arm("Read", {"file_path": f"{ROOT}/results/log-7.json"}, deny_shell=False, deny_project_reads=True)
    assert result is not None
    entry, payload = result
    assert entry["tool"] == "Read"
    assert entry["blocked_by"] == "path"
    assert entry["path"] == f"{ROOT}/results/log-7.json"
    assert entry["args"] == {"file_path": f"{ROOT}/results/log-7.json"}
    assert "record_read" in entry["reason"]
    _assert_deny_payload(payload, entry["reason"])


def test_deny_project_reads_entry_carries_the_shared_denial_keys():
    """`blocked_tree_reads` readers key on {tool, args, blocked_by}; the new
    arms add to that shape, never replace it."""
    entry, _ = arm("Glob", {"pattern": "*.json"}, deny_shell=True, deny_project_reads=True)
    assert {"tool", "args", "blocked_by"} <= set(entry)
    assert entry["path"] == ROOT


def test_deny_project_reads_lets_the_staged_skill_tree_through():
    assert arm("Read", {"file_path": f"{ROOT}/.claude/skills/x/SKILL.md"}, deny_shell=True, deny_project_reads=True) is None


def test_args_are_copied_not_aliased():
    tool_input = {"file_path": f"{ROOT}/research.json"}
    entry, _ = arm("Read", tool_input, deny_shell=False, deny_project_reads=True)
    assert entry["args"] is not tool_input
