"""Unit tests for scripts/check_e2e_fixtures.py — the e2e grading gate."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "check_e2e_fixtures",
    Path(__file__).resolve().parents[2] / "scripts" / "check_e2e_fixtures.py",
)
check_e2e_fixtures = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_e2e_fixtures)


# --- Grading gate (blocking): PR-added run logs with a tree must ship an ann ---


def _make_e2e_run(repo_root: Path, slug: str, ts: str, *, tree: bool, ann: bool) -> Path:
    """Create a run log (+ optional tree/ann siblings) under repo_root and
    return its repo-relative Path (as git diff would report it)."""
    d = repo_root / "eval" / "runlogs" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / f"run-{ts}.json").write_text(json.dumps({"verdict": "pass"}), encoding="utf-8")
    if tree:
        (d / f"run-{ts}.final-tree.gedcomx.json").write_text("{}", encoding="utf-8")
    if ann:
        (d / f"run-{ts}.ann.json").write_text("{}", encoding="utf-8")
    return Path("eval/runlogs/e2e") / slug / f"run-{ts}.json"


def _siblings(rel: Path) -> tuple[str, str]:
    """(tree, ann) repo-relative paths for a run log, as git spells them."""
    stem = rel.name[: -len(".json")]
    return (
        (rel.parent / f"{stem}.final-tree.gedcomx.json").as_posix(),
        (rel.parent / f"{stem}.ann.json").as_posix(),
    )


def _git_repo(tmp_path, monkeypatch):
    """A throwaway git repo + ``commit(*rel_paths) -> head_sha``, with
    ``check_e2e_fixtures.REPO_ROOT`` repointed at it.

    Repointing REPO_ROOT is load-bearing, not bookkeeping: ``_in_head_tree``
    shells with ``cwd=REPO_ROOT``, and against a bare ``tmp_path`` git exits 128
    for every call, so every "exempt" / "no violation" row would pass without git
    ever being consulted. `test_in_head_tree_true_for_a_committed_file` is what
    stops that: it is the only row here that reds when the probe answers False to
    everything, and the four `== []` rows rely on it.
    """
    if shutil.which("git") is None:
        pytest.skip("git is not available")
    repo = tmp_path / "repo"
    repo.mkdir()
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    }
    run = lambda *a: subprocess.run(  # noqa: E731
        ["git", "-C", str(repo), *a], check=True, capture_output=True,
        text=True, encoding="utf-8", env=env,
    )
    run("init", "-q")
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", repo)

    def commit(*rels: str) -> str:
        for r in rels:
            run("add", "--", str(r))
        run("commit", "-q", "-m", "x")
        return run("rev-parse", "HEAD").stdout.strip()

    return repo, commit


def test_is_primary_runlog_excludes_siblings():
    ok = check_e2e_fixtures._is_primary_runlog
    assert ok("run-2026-06-15_10-00-00.json")
    assert not ok("run-2026-06-15_10-00-00.ann.json")
    assert not ok("run-2026-06-15_10-00-00.final-tree.gedcomx.json")
    assert not ok("run-2026-06-15_10-00-00.final-research.json")
    assert not ok("run-2026-06-15_10-00-00.transcript.md")


TS = "2026-06-15_10-00-00"


def test_in_head_tree_true_for_a_committed_file(tmp_path, monkeypatch):
    """Positive control for the probe itself.

    Without this, a wholly-broken `_in_head_tree` (wrong cwd, missing git, a
    flipped returncode test) reads False for everything, which silently turns
    every "exempt" / "no violation" row below green for the wrong reason.
    """
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=False, ann=False)
    head = commit(rel.as_posix())
    assert check_e2e_fixtures._in_head_tree(head, rel) is True
    assert check_e2e_fixtures._in_head_tree(head, Path("eval/nope.json")) is False


def test_graded_run_with_tree_and_ann_passes(tmp_path, monkeypatch):
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=True)
    tree, ann = _siblings(rel)
    head = commit(rel.as_posix(), tree, ann)
    assert check_e2e_fixtures.check_added_runlogs_graded([rel], head) == []


def test_ann_on_disk_but_uncommitted_is_a_violation(tmp_path, monkeypatch):
    """The defect in issue #2469, first direction.

    The annotation is written but never committed. Reading the working
    directory this passes and prints "OK (1 added run log(s) checked)"; reading
    the HEAD tree — which is where the run log itself was selected from — it is
    a violation, which is what CI would say.
    """
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=True)
    tree, _ann = _siblings(rel)
    head = commit(rel.as_posix(), tree)  # ann deliberately left uncommitted
    violations = check_e2e_fixtures.check_added_runlogs_graded([rel], head)
    assert len(violations) == 1
    assert f"run-{TS}.ann.json" in violations[0]


def test_ann_committed_then_deleted_from_disk_still_passes(tmp_path, monkeypatch):
    """The direction a replay cannot test: committed, absent from the worktree.

    A guard that fell back to the working directory would red here, which is how
    `committed or on_disk` would be caught.
    """
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=True)
    tree, ann = _siblings(rel)
    head = commit(rel.as_posix(), tree, ann)
    (repo / ann).unlink()
    assert check_e2e_fixtures.check_added_runlogs_graded([rel], head) == []


def test_run_with_tree_missing_ann_is_violation(tmp_path, monkeypatch):
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=False)
    tree, _ann = _siblings(rel)
    head = commit(rel.as_posix(), tree)
    violations = check_e2e_fixtures.check_added_runlogs_graded([rel], head)
    assert len(violations) == 1
    assert f"run-{TS}.ann.json" in violations[0]


def test_treeless_run_is_exempt(tmp_path, monkeypatch):
    """A crashed/skipped run with no final tree owes no annotation."""
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=False, ann=False)
    head = commit(rel.as_posix())
    assert check_e2e_fixtures.check_added_runlogs_graded([rel], head) == []


def test_tree_on_disk_but_uncommitted_is_exempt(tmp_path, monkeypatch):
    """The defect in issue #2469, second direction — opposite sign.

    A tree written by a local run but not yet committed made the gate demand an
    annotation that CI, seeing no committed tree, would exempt as treeless.
    """
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=False)
    head = commit(rel.as_posix())  # tree deliberately left uncommitted
    assert check_e2e_fixtures.check_added_runlogs_graded([rel], head) == []


def test_tree_committed_then_deleted_from_disk_still_demands_ann(tmp_path, monkeypatch):
    """Second sibling, the replay-proof direction: committed but not on disk."""
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=False)
    tree, _ann = _siblings(rel)
    head = commit(rel.as_posix(), tree)
    (repo / tree).unlink()
    assert len(check_e2e_fixtures.check_added_runlogs_graded([rel], head)) == 1


def test_git_added_returns_none_without_pr_env(monkeypatch):
    monkeypatch.delenv("BASE_SHA", raising=False)
    monkeypatch.delenv("HEAD_SHA", raising=False)
    assert check_e2e_fixtures.git_added_e2e_runlogs() is None


def test_git_added_filters_to_primary_e2e_runlogs(monkeypatch):
    monkeypatch.setenv("BASE_SHA", "aaa")
    monkeypatch.setenv("HEAD_SHA", "bbb")
    diff = "\n".join(
        [
            "eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.json",
            "eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.ann.json",
            "eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.final-tree.gedcomx.json",
            "eval/runlogs/unit/citation/v1.json",
            "eval/tests/e2e/smith/fixture.json",
            "",
        ]
    )
    monkeypatch.setattr(
        check_e2e_fixtures.subprocess, "check_output", lambda *a, **k: diff
    )
    assert check_e2e_fixtures.git_added_e2e_runlogs() == [
        Path("eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.json")
    ]


# --- Unresolved-draft check (warn only) -----------------------------------


def _write_fixture_readme(repo_root: Path, slug: str, *, draft: bool) -> None:
    d = repo_root / "eval" / "tests" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    marker = "**DRAFT PENDING ADJUDICATION.** Transcribed from an unverified hint."
    body = f"# {slug}\n\n## Notes for reviewers\n\n"
    (d / "README.md").write_text(
        body + (marker if draft else "Resolved: the hint is a true match."),
        encoding="utf-8",
    )


def test_draft_fixture_with_committed_run_warns(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    _write_fixture_readme(tmp_path, "smith", draft=True)
    warnings = check_e2e_fixtures.check_added_runlogs_resolved([rel])
    assert len(warnings) == 1
    assert "smith" in warnings[0]
    assert check_e2e_fixtures.DRAFT_MARKER in warnings[0]


def test_resolved_fixture_does_not_warn(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    _write_fixture_readme(tmp_path, "smith", draft=False)
    assert check_e2e_fixtures.check_added_runlogs_resolved([rel]) == []


def test_missing_fixture_readme_does_not_warn(tmp_path, monkeypatch):
    """A run log with no fixture dir (renamed/removed) is silent, not a crash."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    assert check_e2e_fixtures.check_added_runlogs_resolved([rel]) == []


def test_two_runs_of_one_draft_fixture_warn_once(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rels = [
        _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True),
        _make_e2e_run(tmp_path, "smith", "2026-06-15_18-00-00", tree=True, ann=True),
    ]
    _write_fixture_readme(tmp_path, "smith", draft=True)
    assert len(check_e2e_fixtures.check_added_runlogs_resolved(rels)) == 1


# --- main() exit-code behavior --------------------------------------------


def test_main_grading_gate_blocks_missing_ann(tmp_path, monkeypatch):
    """A PR-added run log with a committed tree but no ann fails main()."""
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=False)
    tree, _ann = _siblings(rel)
    monkeypatch.setenv("HEAD_SHA", commit(rel.as_posix(), tree))
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 1


def test_main_grading_gate_passes_when_graded(tmp_path, monkeypatch):
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=True)
    tree, ann = _siblings(rel)
    monkeypatch.setenv("HEAD_SHA", commit(rel.as_posix(), tree, ann))
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 0


def test_main_skips_without_pr_context(monkeypatch):
    """No PR env (BASE_SHA/HEAD_SHA unset) → gate is skipped, exit 0."""
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: None)
    assert check_e2e_fixtures.main() == 0


def test_main_refuses_an_unresolvable_head_sha(tmp_path, monkeypatch, capsys):
    """A HEAD_SHA that names no commit must refuse, with a line worth reading.

    Deliberately does NOT stub `git_added_e2e_runlogs`: the failure happens
    inside it, and stubbing it out is what previously made this test pass while
    the real path raised an uncaught CalledProcessError and printed a traceback
    instead of an ::error::.
    """
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=False)
    tree, _ann = _siblings(rel)
    monkeypatch.setenv("BASE_SHA", commit(rel.as_posix(), tree))
    monkeypatch.setenv("HEAD_SHA", "0" * 40)  # valid shape, absent from this repo
    assert check_e2e_fixtures.main() == 1
    out = capsys.readouterr().out
    assert "::error::" in out and "could not diff" in out, out
    assert "added run log(s) checked" not in out, "must not report a count it never read"


def test_main_refuses_when_repo_root_is_not_a_repo(tmp_path, monkeypatch, capsys):
    """The other broken environment, isolated from the one above.

    The sha is REAL and resolvable in its own repo; only REPO_ROOT is wrong. The
    earlier version of this test set both a bogus sha and a non-repo root, so it
    passed identically with either cause removed — it was a duplicate wearing a
    different name.
    """
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=False)
    tree, _ann = _siblings(rel)
    head = commit(rel.as_posix(), tree)
    not_a_repo = tmp_path / "elsewhere"
    not_a_repo.mkdir()
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", not_a_repo)
    monkeypatch.setenv("BASE_SHA", head)
    monkeypatch.setenv("HEAD_SHA", head)
    assert check_e2e_fixtures.main() == 1
    assert "::error::" in capsys.readouterr().out


def test_the_gate_reads_the_HEAD_SHA_tree_not_the_checkout_s_HEAD(tmp_path, monkeypatch):
    """The `head` argument must be what is consulted, not the working HEAD.

    CI checks out the MERGE commit while HEAD_SHA is the PR head, so the two
    trees genuinely differ there: an annotation present on the base branch is in
    the merge tree and absent at HEAD_SHA. Every other test here builds its repo
    so the commit it makes IS HEAD, which makes the two indistinguishable —
    swapping `head` for the literal "HEAD" left the whole suite green.
    """
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=True)
    tree, ann = _siblings(rel)
    graded_head = commit(rel.as_posix(), tree, ann)
    # A LATER commit removes the annotation, so the working HEAD no longer has it.
    (repo / ann).unlink()
    commit(ann)
    # Judged at `graded_head` the run is graded; judged at HEAD it is a violation.
    assert check_e2e_fixtures.check_added_runlogs_graded([rel], graded_head) == []


def test_the_gate_does_not_credit_an_annotation_added_after_HEAD_SHA(tmp_path, monkeypatch):
    """The other direction: an ann that arrives only in a LATER commit does not
    count at `head`. Together with the test above this pins the argument in both
    signs — one fails if `head` is ignored, the other if it is ignored the other
    way."""
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=False)
    tree, ann = _siblings(rel)
    ungraded_head = commit(rel.as_posix(), tree)
    (repo / ann).write_text("{}", encoding="utf-8")
    commit(ann)
    assert len(check_e2e_fixtures.check_added_runlogs_graded([rel], ungraded_head)) == 1


def test_main_draft_warning_does_not_fail_the_job(tmp_path, monkeypatch, capsys):
    """An unresolved-draft fixture warns but must never change the exit code —
    20 people working drafts in parallel can't have this blocking their PRs."""
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _make_e2e_run(repo, "smith", TS, tree=True, ann=True)
    tree, ann = _siblings(rel)
    _write_fixture_readme(repo, "smith", draft=True)  # warn check reads disk
    monkeypatch.setenv("HEAD_SHA", commit(rel.as_posix(), tree, ann))
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 0
    assert "::warning::" in capsys.readouterr().out


# --- Component-derivation drift check (warn only) --------------------------


def _link(status: str) -> dict:
    return {"kind": "link", "status": status, "claim": "x"}


def _detail(status: str) -> dict:
    return {"kind": "detail", "status": status, "claim": "y"}


def _write_e2e_run_with_findings(repo_root: Path, slug: str, ts: str, per_finding: list) -> Path:
    d = repo_root / "eval" / "runlogs" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / f"run-{ts}.json").write_text(
        json.dumps({"judge_output": {"per_finding": per_finding}}), encoding="utf-8"
    )
    return Path("eval/runlogs/e2e") / slug / f"run-{ts}.json"


def _write_expected_findings(repo_root: Path, slug: str, findings: list) -> None:
    d = repo_root / "eval" / "tests" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "expected-findings.json").write_text(
        json.dumps({"findings": findings}), encoding="utf-8"
    )


def test_derive_matched_link_tally():
    dm = check_e2e_fixtures.derive_matched
    assert dm([_link("supported"), _link("supported")]) == "true"
    assert dm([_link("supported"), _link("unsupported")]) == "partial"
    assert dm([_link("supported"), _link("contradicted")]) == "false"
    assert dm([_link("unsupported")]) == "false"
    # only link components score — a lone detail derives to nothing
    assert dm([_detail("contradicted")]) is None
    assert dm([]) is None
    assert dm(None) is None


def test_source_finding_disagreement_warns(tmp_path, monkeypatch):
    """The issue's f4 shape: a non-relationship finding whose model `matched`
    disagrees with its own components is surfaced, since derivation skips it."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "stribling", "2026-06-15_10-00-00",
        [{"finding_id": "f4", "matched": "partial",
          "components": [_link("supported"), _link("supported"), _detail("contradicted")]}],
    )
    _write_expected_findings(tmp_path, "stribling", [{"id": "f4", "type": "source"}])
    warnings = check_e2e_fixtures.check_matched_vs_components([rel])
    assert len(warnings) == 1
    assert "f4" in warnings[0]
    assert "'true'" in warnings[0] and "'partial'" in warnings[0]


def test_agreeing_finding_is_silent(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "true", "components": [_link("supported")]}],
    )
    _write_expected_findings(tmp_path, "smith", [{"id": "f1", "type": "source"}])
    assert check_e2e_fixtures.check_matched_vs_components([rel]) == []


def test_avoid_finding_excluded(tmp_path, monkeypatch):
    """An `avoid` finding's `matched` is not a link tally, so a disagreement is
    not reported (matching apply_component_derivation's exclusion)."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "true", "components": [_link("contradicted")]}],
    )
    _write_expected_findings(
        tmp_path, "smith", [{"id": "f1", "type": "relationship", "polarity": "avoid"}]
    )
    assert check_e2e_fixtures.check_matched_vs_components([rel]) == []


def test_matched_model_present_is_skipped(tmp_path, monkeypatch):
    """A finding derivation already overrode (matched_model present) carries the
    derived value in `matched`, so it is skipped even if a fresh tally differs."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "partial", "matched_model": "true",
          "components": [_link("supported")]}],
    )
    _write_expected_findings(tmp_path, "smith", [{"id": "f1", "type": "relationship"}])
    assert check_e2e_fixtures.check_matched_vs_components([rel]) == []


def test_no_link_components_is_silent(tmp_path, monkeypatch):
    """A finding whose components are all details derives to nothing, so even a
    `source` finding (which the check does evaluate) is not warned on."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "false", "components": [_detail("contradicted")]}],
    )
    _write_expected_findings(tmp_path, "smith", [{"id": "f1", "type": "source"}])
    assert check_e2e_fixtures.check_matched_vs_components([rel]) == []


def test_fact_finding_is_reported(tmp_path, monkeypatch):
    """The check covers EVERY finding type (issue #1721 decision), so a `fact`
    finding whose stored `matched` disagrees with its link tally is reported too.
    `fact` is excluded from the derivation, not from this report."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "true", "components": [_link("unsupported")]}],
    )
    _write_expected_findings(tmp_path, "smith", [{"id": "f1", "type": "fact"}])
    warnings = check_e2e_fixtures.check_matched_vs_components([rel])
    assert len(warnings) == 1
    assert "f1" in warnings[0]


def test_multiple_findings_only_the_disagreeing_one_warns(tmp_path, monkeypatch):
    """A log with an agreeing sibling and a disagreeing finding warns exactly
    once, naming the disagreeing finding."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [
            {"finding_id": "f1", "matched": "true", "components": [_link("supported")]},
            {"finding_id": "f4", "matched": "partial",
             "components": [_link("supported"), _link("supported")]},
        ],
    )
    _write_expected_findings(
        tmp_path, "smith",
        [{"id": "f1", "type": "source"}, {"id": "f4", "type": "source"}],
    )
    warnings = check_e2e_fixtures.check_matched_vs_components([rel])
    assert len(warnings) == 1
    assert "f4" in warnings[0] and "f1" not in warnings[0]


def test_missing_matched_key_is_silent(tmp_path, monkeypatch):
    """A finding with link components but no `matched` key has nothing to
    compare, so it is skipped rather than warned with a `matched=None` message."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "components": [_link("supported")]}],
    )
    _write_expected_findings(tmp_path, "smith", [{"id": "f1", "type": "source"}])
    assert check_e2e_fixtures.check_matched_vs_components([rel]) == []


def test_wrong_shaped_but_valid_json_does_not_crash(tmp_path, monkeypatch):
    """Valid JSON of the wrong shape must be skipped, not raise (the docstring's
    'never raised on' promise, and CI would otherwise fail with a traceback)."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    d = tmp_path / "eval" / "runlogs" / "e2e" / "smith"
    d.mkdir(parents=True, exist_ok=True)
    rels = []
    for i, body in enumerate([
        "null", "[]", "5", '"str"',
        '{"judge_output": 5}',
        '{"judge_output": [1, 2]}',
        '{"judge_output": {"per_finding": 5}}',
        '{"judge_output": {"per_finding": true}}',
        '{"judge_output": {"per_finding": ["notadict", 3]}}',
    ]):
        ts = f"2026-06-15_10-00-0{i}"
        (d / f"run-{ts}.json").write_text(body, encoding="utf-8")
        rels.append(Path("eval/runlogs/e2e/smith") / f"run-{ts}.json")
    # Must return cleanly (no exception) for every wrong shape.
    assert check_e2e_fixtures.check_matched_vs_components(rels) == []


def test_wrong_shaped_expected_findings_does_not_crash(tmp_path, monkeypatch):
    """A fixture whose expected-findings.json is valid JSON but not an object
    (or whose `findings` is not a list) must not crash the join."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "partial", "components": [_link("supported")]}],
    )
    ef = tmp_path / "eval" / "tests" / "e2e" / "smith" / "expected-findings.json"
    ef.parent.mkdir(parents=True, exist_ok=True)
    ef.write_text("[]", encoding="utf-8")  # array root, not an object
    # No avoid/fact info recoverable → treat as non-excluded → still warns once.
    assert len(check_e2e_fixtures.check_matched_vs_components([rel])) == 1


def test_derive_matched_matches_judge_canonical():
    """The inline derive_matched must stay in lockstep with judge.py's canonical
    one (it is a hand-kept stdlib copy; nothing else cross-checks them)."""
    from e2e.judge import derive_matched as judge_derive_matched

    cases = [
        [_link("supported"), _link("supported")],
        [_link("supported"), _link("unsupported")],
        [_link("supported"), _link("contradicted")],
        [_link("unsupported")],
        [_link("contradicted"), _detail("supported")],
        [_detail("contradicted")],
        [_link("supported"), _detail("unsupported")],
        [],
    ]
    for comps in cases:
        assert check_e2e_fixtures.derive_matched(comps) == judge_derive_matched(comps), comps
    assert check_e2e_fixtures.derive_matched(None) == judge_derive_matched(None)


def test_malformed_runlog_does_not_crash(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    d = tmp_path / "eval" / "runlogs" / "e2e" / "smith"
    d.mkdir(parents=True, exist_ok=True)
    (d / "run-2026-06-15_10-00-00.json").write_text("{not json", encoding="utf-8")
    rel = Path("eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.json")
    assert check_e2e_fixtures.check_matched_vs_components([rel]) == []


def test_missing_expected_findings_treats_all_as_non_avoid(tmp_path, monkeypatch):
    """No fixture file → err toward surfacing: the disagreement still warns."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "partial", "components": [_link("supported")]}],
    )
    assert len(check_e2e_fixtures.check_matched_vs_components([rel])) == 1


def test_main_drift_warning_does_not_fail_the_job(tmp_path, monkeypatch, capsys):
    """A matched-vs-components disagreement warns but never changes the exit code."""
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _write_e2e_run_with_findings(
        repo, "smith", TS,
        [{"finding_id": "f1", "matched": "partial", "components": [_link("supported")]}],
    )
    # Give it a COMMITTED tree + ann so the blocking gate stays satisfied (exit 0).
    tree, ann = _siblings(rel)
    (repo / tree).write_text("{}", encoding="utf-8")
    (repo / ann).write_text("{}", encoding="utf-8")
    _write_expected_findings(repo, "smith", [{"id": "f1", "type": "source"}])
    monkeypatch.setenv("HEAD_SHA", commit(rel.as_posix(), tree, ann))
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 0
    out = capsys.readouterr().out
    assert "::warning::" in out
    assert "f1" in out


def test_main_drift_warning_prints_even_when_grading_gate_fails(tmp_path, monkeypatch, capsys):
    """The warn loops run before the blocking gate so the drift warning is
    visible even on the exit-1 path (a tree with no committed ann fails the
    gate). Guards against a later reorder silently swallowing the warning."""
    repo, commit = _git_repo(tmp_path, monkeypatch)
    rel = _write_e2e_run_with_findings(
        repo, "smith", TS,
        [{"finding_id": "f1", "matched": "partial", "components": [_link("supported")]}],
    )
    # Tree COMMITTED, ann missing → blocking grading gate fails (exit 1).
    tree, _ann = _siblings(rel)
    (repo / tree).write_text("{}", encoding="utf-8")
    _write_expected_findings(repo, "smith", [{"id": "f1", "type": "source"}])
    monkeypatch.setenv("HEAD_SHA", commit(rel.as_posix(), tree))
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 1
    out = capsys.readouterr().out
    assert "::warning::" in out and "f1" in out
