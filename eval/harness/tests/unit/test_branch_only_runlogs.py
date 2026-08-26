"""Unit tests for scripts/branch_only_runlogs.py (issue #1444).

`git` is always stubbed — never shelled out to. `eval-harness-tests.yml`
checks out at the default (shallow) fetch depth, so `refs/remotes` is
near-empty in CI and an assertion over the real repo's refs would pass
vacuously (CLAUDE.md "A new lint must be proven to fail").
"""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "branch_only_runlogs",
    Path(__file__).resolve().parents[2] / "scripts" / "branch_only_runlogs.py",
)
branch_only_runlogs = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(branch_only_runlogs)


def _stub_git(monkeypatch, refs_output: str, ls_tree: dict[str, str]):
    """`refs_output` answers `for-each-ref`; `ls_tree` maps a ref name to the
    `ls-tree --name-only` output for that ref. A ref missing from `ls_tree`
    raises CalledProcessError, simulating a gone/broken remote-tracking ref."""

    def fake_check_output(cmd, *, cwd=None, text=None, encoding=None):
        if cmd[1] == "for-each-ref":
            return refs_output
        assert cmd[1] == "ls-tree"
        ref = cmd[4]
        if ref not in ls_tree:
            raise subprocess.CalledProcessError(128, cmd)
        return ls_tree[ref]

    monkeypatch.setattr(branch_only_runlogs.subprocess, "check_output", fake_check_output)


def test_reports_a_path_present_on_a_ref_and_absent_from_head(monkeypatch):
    _stub_git(
        monkeypatch,
        refs_output="refs/remotes/origin/resolve-katalin-horak-son\t2026-08-03\n",
        ls_tree={
            "HEAD": "eval/runlogs/e2e/other-fixture/run-2026-07-01_00-00-00.json\n",
            "refs/remotes/origin/resolve-katalin-horak-son": (
                "eval/runlogs/e2e/other-fixture/run-2026-07-01_00-00-00.json\n"
                "eval/runlogs/e2e/katalin-horak-son/run-2026-08-03_21-26-35.json\n"
            ),
        },
    )
    found = branch_only_runlogs.branch_only()
    assert list(found.keys()) == ["refs/remotes/origin/resolve-katalin-horak-son"]
    tip_date, paths = found["refs/remotes/origin/resolve-katalin-horak-son"]
    assert tip_date == "2026-08-03"
    assert paths == ["eval/runlogs/e2e/katalin-horak-son/run-2026-08-03_21-26-35.json"]


def test_a_ref_with_nothing_branch_only_is_not_reported(monkeypatch):
    """A subset of HEAD's listing is omitted entirely -- not an empty group."""
    _stub_git(
        monkeypatch,
        refs_output="refs/heads/some-old-branch\t2026-06-01\n",
        ls_tree={
            "HEAD": "eval/runlogs/e2e/fixture/run-2026-07-01_00-00-00.json\n",
            "refs/heads/some-old-branch": "eval/runlogs/e2e/fixture/run-2026-07-01_00-00-00.json\n",
        },
    )
    assert branch_only_runlogs.branch_only() == {}


def test_symbolic_head_ref_is_never_queried(monkeypatch):
    """`refs/remotes/origin/HEAD` is a symbolic ref to another ref already in
    the list, not a distinct branch -- querying it would double-report."""
    queried: list[str] = []

    def fake_check_output(cmd, *, cwd=None, text=None, encoding=None):
        if cmd[1] == "for-each-ref":
            return (
                "refs/remotes/origin/HEAD\t2026-08-01\n"
                "refs/remotes/origin/main\t2026-08-01\n"
            )
        queried.append(cmd[4])
        return ""

    monkeypatch.setattr(branch_only_runlogs.subprocess, "check_output", fake_check_output)
    branch_only_runlogs.branch_only()
    assert "refs/remotes/origin/HEAD" not in queried
    assert "refs/remotes/origin/main" in queried


def test_ann_and_final_siblings_are_not_reported_as_branch_only(monkeypatch):
    """Only is_result_json paths count -- a .ann.json or .final-* sibling
    present on a ref but absent from HEAD must not be reported."""
    _stub_git(
        monkeypatch,
        refs_output="refs/heads/some-branch\t2026-08-01\n",
        ls_tree={
            "HEAD": "",
            "refs/heads/some-branch": (
                "eval/runlogs/e2e/fixture/run-2026-08-01_00-00-00.json\n"
                "eval/runlogs/e2e/fixture/run-2026-08-01_00-00-00.ann.json\n"
                "eval/runlogs/e2e/fixture/run-2026-08-01_00-00-00.final-tree.gedcomx.json\n"
            ),
        },
    )
    found = branch_only_runlogs.branch_only()
    _, paths = found["refs/heads/some-branch"]
    assert paths == ["eval/runlogs/e2e/fixture/run-2026-08-01_00-00-00.json"]


def test_a_ref_whose_ls_tree_fails_is_skipped_not_fatal(monkeypatch):
    """A gone/broken remote-tracking ref must not hide every other ref's
    results -- this is a discovery aid, not a gate."""
    _stub_git(
        monkeypatch,
        refs_output=(
            "refs/remotes/origin/gone-branch\t2026-06-01\n"
            "refs/heads/live-branch\t2026-08-01\n"
        ),
        ls_tree={
            "HEAD": "",
            # "refs/remotes/origin/gone-branch" deliberately absent -> raises
            "refs/heads/live-branch": "eval/runlogs/e2e/fixture/run-2026-08-01_00-00-00.json\n",
        },
    )
    found = branch_only_runlogs.branch_only()
    assert list(found.keys()) == ["refs/heads/live-branch"]


def test_format_report_states_a_clean_result_as_a_real_result(monkeypatch):
    assert "No graded run logs found" in branch_only_runlogs.format_report({})
