"""Unit tests for scripts/check_e2e_fixtures.py — the e2e grading gate."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

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


def test_is_primary_runlog_excludes_siblings():
    ok = check_e2e_fixtures._is_primary_runlog
    assert ok("run-2026-06-15_10-00-00.json")
    assert not ok("run-2026-06-15_10-00-00.ann.json")
    assert not ok("run-2026-06-15_10-00-00.final-tree.gedcomx.json")
    assert not ok("run-2026-06-15_10-00-00.final-research.json")
    assert not ok("run-2026-06-15_10-00-00.transcript.md")


def test_graded_run_with_tree_and_ann_passes(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    assert check_e2e_fixtures.check_added_runlogs_graded([rel]) == []


def test_run_with_tree_missing_ann_is_violation(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=False)
    violations = check_e2e_fixtures.check_added_runlogs_graded([rel])
    assert len(violations) == 1
    assert "run-2026-06-15_10-00-00.ann.json" in violations[0]


def test_treeless_run_is_exempt(tmp_path, monkeypatch):
    """A crashed/skipped run with no final tree owes no annotation."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=False, ann=False)
    assert check_e2e_fixtures.check_added_runlogs_graded([rel]) == []


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
    """A PR-added run log with a tree but no ann fails main()."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=False)
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 1


def test_main_grading_gate_passes_when_graded(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 0


def test_main_skips_without_pr_context(monkeypatch):
    """No PR env (BASE_SHA/HEAD_SHA unset) → gate is skipped, exit 0."""
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: None)
    assert check_e2e_fixtures.main() == 0


def test_main_draft_warning_does_not_fail_the_job(tmp_path, monkeypatch, capsys):
    """An unresolved-draft fixture warns but must never change the exit code —
    20 people working drafts in parallel can't have this blocking their PRs."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    _write_fixture_readme(tmp_path, "smith", draft=True)
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
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "partial", "components": [_link("supported")]}],
    )
    # Give it a tree + ann so the blocking gate stays satisfied (exit stays 0).
    slug_dir = tmp_path / "eval" / "runlogs" / "e2e" / "smith"
    (slug_dir / "run-2026-06-15_10-00-00.final-tree.gedcomx.json").write_text("{}", encoding="utf-8")
    (slug_dir / "run-2026-06-15_10-00-00.ann.json").write_text("{}", encoding="utf-8")
    _write_expected_findings(tmp_path, "smith", [{"id": "f1", "type": "source"}])
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 0
    out = capsys.readouterr().out
    assert "::warning::" in out
    assert "f1" in out


def test_main_drift_warning_prints_even_when_grading_gate_fails(tmp_path, monkeypatch, capsys):
    """The warn loops run before the blocking gate so the drift warning is
    visible even on the exit-1 path (a tree with no committed ann fails the
    gate). Guards against a later reorder silently swallowing the warning."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _write_e2e_run_with_findings(
        tmp_path, "smith", "2026-06-15_10-00-00",
        [{"finding_id": "f1", "matched": "partial", "components": [_link("supported")]}],
    )
    slug_dir = tmp_path / "eval" / "runlogs" / "e2e" / "smith"
    # Tree present, ann missing → blocking grading gate fails (exit 1).
    (slug_dir / "run-2026-06-15_10-00-00.final-tree.gedcomx.json").write_text("{}", encoding="utf-8")
    _write_expected_findings(tmp_path, "smith", [{"id": "f1", "type": "source"}])
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 1
    out = capsys.readouterr().out
    assert "::warning::" in out and "f1" in out
