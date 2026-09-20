"""Offline tests for D18's grading half: proto/grade.py (the fixture-slug derivation and
the harness command it shells to) and proto/compare.py (which committed run log the
harness side is, and the comparison table). No Postgres, no stack, no judge call, no
model -- every judge output here is canned."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import psycopg
import pytest

from proto import compare, export, grade, seed

E2E_DIR = grade.E2E_DIR


# ── the fixture slug a project id names ───────────────────────────────────────────


def test_derive_fixture_round_trips_a_proto_seed_project_id():
    for slug in ("bagley-father-1884", "kenneth-quass-death"):
        assert (E2E_DIR / slug).is_dir(), f"{slug} is a real fixture"
        project_id = seed.default_project_id(E2E_DIR / slug)
        assert grade.derive_fixture(project_id) == slug


def test_derive_fixture_round_trips_every_fixture_seed_does_not_truncate():
    """`seed.default_project_id` truncates the stem, so a long enough fixture name cannot
    be derived back -- that is the `FIXTURE=` escape's reason to exist. Every fixture short
    enough to survive the truncation must round-trip."""
    checked = 0
    for d in sorted(p for p in E2E_DIR.iterdir() if (p / "fixture.json").is_file()):
        project_id = seed.default_project_id(d)
        if not project_id.startswith(f"proj_{d.name}_"):
            continue  # truncated or sanitised: covered by the refusal test below
        checked += 1
        assert grade.derive_fixture(project_id) == d.name, d.name
    assert checked > 100, f"only {checked} fixtures checked; the corpus is larger than that"


def test_derive_fixture_refuses_what_it_cannot_tell(tmp_path):
    long_name = "x" * 40
    (tmp_path / long_name).mkdir()
    (tmp_path / long_name / "fixture.json").write_text("{}", encoding="utf-8")
    truncated = seed.default_project_id(tmp_path / long_name)

    for project_id, why in [
        ("", "empty"),
        ("bagley-father-1884", "no proj_ prefix"),
        ("proj_bagley-father-1884", "no random suffix"),
        ("proj_bagley-father-1884_ZZZZZZ", "the suffix is not hex"),
        ("proj_bagley-father-1884_abc", "the suffix is not six characters"),
        ("proj_bagley-father-1884_a1b2c3zz", "a tail after the six hex -- what `$` alone binds"),
        ("proj_some-unit-scenario_a1b2c3", "the slug names no e2e fixture"),
        (truncated, "seed truncated the stem at 32 characters"),
    ]:
        assert grade.derive_fixture(project_id) is None, why


def test_derive_fixture_reads_the_last_group_as_the_random_suffix(tmp_path):
    """A fixture name that itself carries `_<6 hex>` keeps it: the slug is cut at the LAST
    one. Greedy `.+` and the `$` each do that alone, so only dropping both cuts it at the
    first; `^` binds nothing under `.match()` (mutations M13, M13b, L5)."""
    for name in ("deed_abc123-thing", "deed-abc123"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "fixture.json").write_text("{}", encoding="utf-8")
        assert grade.derive_fixture(f"proj_{name}_9f8e7d", e2e_dir=tmp_path) == name


# ── the harness command ───────────────────────────────────────────────────────────


def test_grade_files_argv_names_the_harness_module_and_its_optional_arguments(tmp_path):
    bare = grade.grade_files_argv("slug", tmp_path / "t.json")
    assert bare == ["uv", "run", "python", "-m", "e2e.grade_files",
                    "--fixture", "slug", "--tree", str(tmp_path / "t.json")]
    full = grade.grade_files_argv(
        "slug", tmp_path / "t.json", tmp_path / "r.json",
        json_out=tmp_path / "j.json", model="claude-opus-4-8",
    )
    assert full[len(bare):] == ["--research", str(tmp_path / "r.json"),
                                "--json", str(tmp_path / "j.json"),
                                "--model", "claude-opus-4-8"]


def test_run_grade_files_runs_in_the_harness_venv_and_relays(monkeypatch, capsys):
    """apps/server and eval/harness are separate environments, so the harness module is a
    subprocess run from eval/harness -- not an import."""
    seen: list[dict] = []

    def fake_run(argv, **kw):
        seen.append({"argv": argv, **kw})
        return subprocess.CompletedProcess(argv, 7, stdout="verdict pass\n", stderr="a warning\n")

    monkeypatch.setattr(grade.subprocess, "run", fake_run)
    proc = grade.run_grade_files(["uv", "run", "python", "-m", "e2e.grade_files"])
    assert proc.returncode == 7
    [call] = seen
    assert call["cwd"] == grade.HARNESS_DIR == grade.ROOT / "eval" / "harness"
    assert call["argv"][:2] == ["uv", "run"], "the harness's own venv, not this one"
    assert call["encoding"] == "utf-8"
    out = capsys.readouterr()
    assert "verdict pass" in out.out and "a warning" in out.err


def test_run_grade_files_can_stay_quiet_for_a_caller_that_renders_its_own_table(monkeypatch, capsys):
    monkeypatch.setattr(
        grade.subprocess, "run",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 0, stdout="noise\n", stderr=""),
    )
    grade.run_grade_files(["uv"], echo=False)
    assert capsys.readouterr().out == ""


def test_exported_documents_are_where_export_lands_them(tmp_path):
    tree, research = grade.exported_documents(tmp_path, "proj_x")
    assert tree == export.export_dir(tmp_path, "proj_x") / "tree.gedcomx.json"
    assert research == export.export_dir(tmp_path, "proj_x") / "research.json"


# ── proto/grade.py's exit codes ───────────────────────────────────────────────────


def _no_export(monkeypatch):
    def must_not_run(*a, **k):
        raise AssertionError("the export must not run")

    monkeypatch.setattr(grade.export, "export", must_not_run)


def test_grade_main_exits_2_on_an_unknown_session_or_no_postgres(monkeypatch, capsys):
    _no_export(monkeypatch)
    monkeypatch.setattr(grade.export, "resolve_project", lambda dsn, sid: None)
    assert grade.main(["--session", "nope"]) == 2
    assert "no session 'nope'" in capsys.readouterr().err

    def down(dsn, sid):
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr(grade.export, "resolve_project", down)
    assert grade.main(["--session", "s"]) == 2
    assert "postgres unreachable" in capsys.readouterr().err


def test_grade_main_exits_2_when_the_fixture_cannot_be_derived_and_none_was_given(monkeypatch, capsys):
    _no_export(monkeypatch)
    monkeypatch.setattr(grade.export, "resolve_project", lambda dsn, sid: "proj_handwritten")
    assert grade.main(["--session", "s"]) == 2
    err = capsys.readouterr().err
    assert "cannot tell which fixture" in err and "FIXTURE=" in err


def test_grade_main_takes_an_explicit_fixture_over_an_underivable_project_id(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(grade.export, "resolve_project", lambda dsn, sid: "proj_handwritten")
    monkeypatch.setattr(grade.export, "export", lambda pid, **kw: 0)
    seen: list[list[str]] = []
    monkeypatch.setattr(
        grade, "run_grade_files",
        lambda argv, **kw: seen.append(argv) or subprocess.CompletedProcess(argv, 0, "", ""),
    )
    assert grade.main(["--session", "s", "--fixture", "bagley-father-1884", "--out", str(tmp_path)]) == 0
    assert "bagley-father-1884" in seen[0]
    assert "(derived from the project id)" not in capsys.readouterr().out


def test_grade_main_exits_1_when_the_export_fails_and_never_grades(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(grade.export, "resolve_project", lambda dsn, sid: "proj_bagley-father-1884_a1b2c3")
    monkeypatch.setattr(grade.export, "export", lambda pid, **kw: 1)

    def must_not_grade(*a, **k):
        raise AssertionError("nothing to grade after a failed export")

    monkeypatch.setattr(grade, "run_grade_files", must_not_grade)
    assert grade.main(["--session", "s", "--out", str(tmp_path)]) == 1
    assert "the export failed" in capsys.readouterr().err


def test_grade_main_relays_the_harness_exit_code_and_prints_the_provenance(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(grade.export, "resolve_project", lambda dsn, sid: "proj_bagley-father-1884_a1b2c3")
    exported: list[dict] = []
    monkeypatch.setattr(grade.export, "export", lambda pid, **kw: exported.append({"pid": pid, **kw}) or 0)
    seen: list[list[str]] = []
    monkeypatch.setattr(
        grade, "run_grade_files",
        lambda argv, **kw: seen.append(argv) or subprocess.CompletedProcess(argv, 2, "", ""),
    )
    assert grade.main(["--session", "sess_x", "--out", str(tmp_path)]) == 2, "grade_files' own code, relayed"
    out = capsys.readouterr().out
    assert "sess_x" in out and "proj_bagley-father-1884_a1b2c3" in out
    assert "bagley-father-1884  (derived from the project id)" in out
    assert exported[0]["out_dir"] == tmp_path.resolve()
    tree, research = grade.exported_documents(tmp_path.resolve(), "proj_bagley-father-1884_a1b2c3")
    assert str(tree) in seen[0] and str(research) in seen[0]


# ── which committed run the harness side is ───────────────────────────────────────


def _runlog(d: Path, stamp: str, *, verdict: str = "pass", siblings: bool = True) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"run-{stamp}.json"
    path.write_text(json.dumps({
        "test_id": d.name,
        "verdict": verdict,
        "judge_output": {"verdict": verdict, "per_finding": []},
        "tool_calls": [{"tool": "x"}, {"tool": "y"}],
        "usage": {"total_cost_usd": 5.29, "duration_ms": 2_146_667, "num_turns": 90, "continue_nudges": 2},
    }), encoding="utf-8")
    if siblings:
        (d / f"run-{stamp}.final-tree.gedcomx.json").write_text("{}", encoding="utf-8")
        (d / f"run-{stamp}.final-research.json").write_text("{}", encoding="utf-8")
    return path


def test_is_result_json_excludes_the_siblings_and_scratch_logs(tmp_path):
    assert compare.is_result_json(tmp_path / "run-2026-07-31_18-06-28.json")
    for name in (
        "run-2026-07-31_18-06-28.ann.json",
        "run-2026-07-31_18-06-28.final-tree.gedcomx.json",
        "run-2026-07-31_18-06-28.final-research.json",
        "scratch_2026-07-31_18-06-28.json",
        "README.md",
    ):
        assert not compare.is_result_json(tmp_path / name), name


def test_resolve_runlog_takes_the_latest_committed_run_by_name(tmp_path):
    d = tmp_path / "slug"
    _runlog(d, "2026-07-27_20-01-40")
    latest = _runlog(d, "2026-07-31_18-06-28")
    _runlog(d, "2026-07-29_09-00-00")
    assert [p.name for p in compare.committed_runlogs("slug", runlogs_root=tmp_path)] == [
        "run-2026-07-27_20-01-40.json",
        "run-2026-07-29_09-00-00.json",
        "run-2026-07-31_18-06-28.json",
    ]
    assert compare.resolve_runlog("slug", None, runlogs_root=tmp_path) == latest


def test_resolve_runlog_takes_an_explicit_path_over_the_latest(tmp_path):
    d = tmp_path / "slug"
    older = _runlog(d, "2026-07-27_20-01-40")
    _runlog(d, "2026-07-31_18-06-28")
    assert compare.resolve_runlog("slug", older, runlogs_root=tmp_path) == older
    assert compare.resolve_runlog("slug", str(older), runlogs_root=tmp_path) == older
    assert compare.resolve_runlog("slug", tmp_path / "nowhere.json", runlogs_root=tmp_path) is None


def test_resolve_runlog_is_none_for_a_fixture_with_no_committed_runs(tmp_path):
    assert compare.resolve_runlog("never-run", None, runlogs_root=tmp_path) is None
    (tmp_path / "empty").mkdir()
    assert compare.resolve_runlog("empty", None, runlogs_root=tmp_path) is None
    d = tmp_path / "ann-only"
    d.mkdir()
    (d / "run-2026-07-31_18-06-28.ann.json").write_text("{}", encoding="utf-8")
    assert compare.resolve_runlog("ann-only", None, runlogs_root=tmp_path) is None


def test_runlog_siblings_and_date(tmp_path):
    path = tmp_path / "run-2026-07-31_18-06-28.json"
    tree, research = compare.runlog_siblings(path)
    assert tree.name == "run-2026-07-31_18-06-28.final-tree.gedcomx.json"
    assert research.name == "run-2026-07-31_18-06-28.final-research.json"
    assert compare.runlog_date(path) == "2026-07-31"
    assert compare.runlog_date(tmp_path / "odd.json") == "(undated)"


def test_the_repos_own_bagley_runlogs_resolve_with_their_siblings():
    runlog = compare.resolve_runlog("bagley-father-1884", None)
    assert runlog is not None and runlog.is_file()
    tree, research = compare.runlog_siblings(runlog)
    assert tree.is_file() and research.is_file()


# ── the comparison table ──────────────────────────────────────────────────────────


EXPECTED = {"findings": [
    {"id": "f1", "description": "William's father is David Bagley"},
    {"id": "f2", "description": "David married Sarah Andrews"},
]}


def _side(name, labels, verdict, **kw):
    return compare.Side(source=f"{name} source", verdict=verdict, labels=labels, **kw)


def test_render_puts_both_sides_on_one_row_per_finding_when_they_agree():
    text = compare.render(
        "bagley-father-1884", EXPECTED,
        _side("harness", {"f1": "true", "f2": "true"}, "pass", record="$5.29  2147 s"),
        _side("prototype", {"f1": "true", "f2": "true"}, "pass", record="$1.01  232 s"),
    )
    rows = [line for line in text.splitlines() if line.startswith(("f1", "f2"))]
    assert len(rows) == 2
    assert rows[0].split()[:3] == ["f1", "true", "true"]
    assert "verdict" in text and text.count("pass") >= 2
    assert "only the harness recovered:    (none)" in text
    assert "only the prototype recovered:  (none)" in text


def test_render_names_the_findings_each_side_got_that_the_other_did_not():
    text = compare.render(
        "bagley-father-1884", EXPECTED,
        _side("harness", {"f1": "true", "f2": "false"}, "partial"),
        _side("prototype", {"f1": "false", "f2": "true"}, "partial"),
    )
    assert "only the harness recovered:    f1" in text
    assert "only the prototype recovered:  f2" in text


def test_render_counts_a_partial_as_not_recovered():
    text = compare.render(
        "bagley-father-1884", EXPECTED,
        _side("harness", {"f1": "true", "f2": "partial"}, "partial"),
        _side("prototype", {"f1": "partial", "f2": "partial"}, "partial"),
    )
    assert "only the harness recovered:    f1" in text
    assert "only the prototype recovered:  (none)" in text
    assert "partial" in text, "a partial is still shown in the table"


def test_render_with_only_one_side_graded():
    only_harness = compare.render(
        "bagley-father-1884", EXPECTED, _side("harness", {"f1": "true", "f2": "true"}, "pass"), None
    )
    assert "prototype   (not graded)" in only_harness
    row = [line for line in only_harness.splitlines() if line.startswith("f1")][0]
    assert row.split()[:3] == ["f1", "true", "-"]
    assert "only the prototype recovered:  (none)" in only_harness

    only_proto = compare.render(
        "bagley-father-1884", EXPECTED, None, _side("prototype", {"f1": "true"}, "partial")
    )
    assert "harness     (not graded)" in only_proto
    assert [line for line in only_proto.splitlines() if line.startswith("f1")][0].split()[:3] == ["f1", "-", "true"]
    assert "only the prototype recovered:  f1" in only_proto


def test_render_shows_a_finding_only_one_side_graded_and_one_the_fixture_does_not_list():
    text = compare.render(
        "bagley-father-1884", EXPECTED,
        _side("harness", {"f1": "true"}, "partial"),
        _side("prototype", {"f1": "true", "f2": "true", "f9": "false"}, "pass"),
    )
    f2 = [line for line in text.splitlines() if line.startswith("f2")][0]
    assert f2.split()[:3] == ["f2", "-", "true"], "the harness never graded f2"
    f9 = [line for line in text.splitlines() if line.startswith("f9")][0]
    assert "graded anyway" in f9, "a grade for a finding the fixture does not list is shown"
    assert "only the prototype recovered:  f2" in text


def test_render_on_an_empty_expected_findings_list():
    text = compare.render("empty-fixture", {"findings": []}, _side("harness", {}, "pass"), _side("prototype", {}, "pass"))
    assert "(the fixture lists no expected findings)" in text
    assert "only the harness recovered:    (none)" in text


def test_render_flags_a_fresh_grading_that_disagrees_with_the_committed_verdict():
    agrees = compare.render(
        "slug", EXPECTED, _side("harness", {"f1": "true"}, "pass", committed_verdict="pass"), None
    )
    assert "its own log recorded verdict 'pass'" in agrees and "DISAGREES" not in agrees
    differs = compare.render(
        "slug", EXPECTED, _side("harness", {"f1": "false"}, "fail", committed_verdict="pass"), None
    )
    assert "DISAGREES" in differs


def test_labels_of_reads_per_finding_and_tolerates_a_missing_one():
    assert compare.labels_of({"per_finding": [{"finding_id": "f1", "matched": "true"}]}) == {"f1": "true"}
    assert compare.labels_of({}) == {} and compare.labels_of(None) == {}
    assert compare.labels_of({"per_finding": "nope"}) == {}


# ── each side's own record ────────────────────────────────────────────────────────


def test_harness_record_reads_the_committed_logs_usage_block(tmp_path):
    data = json.loads(_runlog(tmp_path / "slug", "2026-07-31_18-06-28").read_text(encoding="utf-8"))
    text = compare.harness_record(data)
    assert "$5.29" in text and "2147 s" in text and "2 tool calls" in text
    assert "90 SDK turns" in text and "2 nudges" in text


def test_harness_record_says_unknown_rather_than_guessing():
    text = compare.harness_record({})
    assert "$?" in text and "? s" in text and "0 tool calls" in text


def test_proto_record_sums_the_sessions_turns_and_counts_its_tool_calls():
    rows = [(1.0, 10, 200_000, 3), (0.25, 4, 32_000, 0)]
    calls = [
        {"turn_id": "t", "agent_type": None, "tool_name": "mcp__genealogy__record_read",
         "input_path": None, "decision": "allow", "duration_ms": 120},
        {"turn_id": "t", "agent_type": None, "tool_name": "Read",
         "input_path": "/project/research.json", "decision": "deny", "duration_ms": None},
    ]
    text = compare.proto_record(rows, calls)
    assert "$1.25" in text and "232 s" in text and "2 tool calls" in text
    assert "14 SDK turns" in text and "3 nudges" in text


def test_proto_record_reports_unknown_when_a_resumed_turn_left_the_columns_null():
    text = compare.proto_record([(None, None, None, None)], [])
    assert "$?" in text and "? s" in text and "0 tool calls" in text and "? SDK turns" in text
    assert "under-reported" not in text, "a NULL already reads as unknown"


def test_proto_record_marks_a_turn_that_ran_but_recorded_no_cost():
    """The real shape after a kill: the resumed turn records its COMPLETING attempt, so
    cost and SDK turns are 0 -- not NULL. `$0.00` beside the harness's `$5.29` reads as a
    100% cost advantage unless the row says otherwise."""
    text = compare.proto_record([(0.0, 0, 1_804_000, 0)], [])
    assert "$0.00" in text and "1804 s" in text and "0 SDK turns" in text
    assert "cost/SDK turns under-reported" in text

    mixed = compare.proto_record([(1.0, 10, 200_000, 0), (0.0, 0, 1_804_000, 0)], [])
    assert "cost/SDK turns under-reported" in mixed, "one silent turn is enough"

    honest = compare.proto_record([(1.0, 10, 200_000, 0)], [])
    assert "under-reported" not in honest


# ── when the fixture's expected findings last changed ─────────────────────────


def test_findings_changed_shells_git_for_the_fixtures_expected_findings(monkeypatch, tmp_path):
    seen: list[dict] = []

    def fake_run(argv, **kw):
        seen.append({"argv": argv, **kw})
        return subprocess.CompletedProcess(argv, 0, stdout="2026-09-08\n", stderr="")

    monkeypatch.setattr(compare.subprocess, "run", fake_run)
    assert compare.findings_changed(
        "stribling-father-1821", e2e_dir=tmp_path / "eval" / "tests" / "e2e", root=tmp_path
    ) == "2026-09-08"
    [call] = seen
    assert call["argv"] == [
        "git", "log", "-1", "--format=%cs", "--",
        "eval/tests/e2e/stribling-father-1821/expected-findings.json",
    ]
    assert call["cwd"] == tmp_path and call["encoding"] == "utf-8"


def test_findings_changed_says_unknown_rather_than_guessing(monkeypatch, tmp_path):
    def returning(code, out):
        return lambda argv, **kw: subprocess.CompletedProcess(argv, code, stdout=out, stderr="")

    for code, out, why in [
        (0, "", "a path git has never seen prints nothing"),
        (128, "fatal: not a git repository\n", "no repository"),
        (0, "not-a-date\n", "%cs did not produce a date"),
    ]:
        monkeypatch.setattr(compare.subprocess, "run", returning(code, out))
        assert compare.findings_changed("slug", root=tmp_path) == "(unknown)", why

    def explode(argv, **kw):
        raise OSError("git is not on PATH")

    monkeypatch.setattr(compare.subprocess, "run", explode)
    assert compare.findings_changed("slug", root=tmp_path) == "(unknown)"


def test_findings_changed_reads_this_repos_own_git_history():
    """Not stubbed: the stub cannot tell whether the command is one git accepts."""
    assert compare.ISO_DATE.match(compare.findings_changed("bagley-father-1884"))
    assert compare.findings_changed("no-such-fixture") == "(unknown)"


def test_amended_after_compares_only_two_real_dates():
    assert compare.amended_after("2026-07-31", "2026-09-08")
    assert not compare.amended_after("2026-07-31", "2026-07-27")
    assert not compare.amended_after("2026-07-31", "2026-07-31")
    assert not compare.amended_after("2026-07-31", "(unknown)")
    assert not compare.amended_after("(undated)", "2026-09-08")


# ── proto/compare.py's exit codes ─────────────────────────────────────────────────


def _no_grading(monkeypatch):
    def must_not_grade(*a, **k):
        raise AssertionError("nothing may be graded on this path")

    monkeypatch.setattr(compare.grade, "run_grade_files", must_not_grade)


def test_compare_main_exits_2_on_an_unknown_fixture(monkeypatch, capsys):
    _no_grading(monkeypatch)
    assert compare.main(["--fixture", "no-such-fixture", "--session", "s"]) == 2
    assert "no fixture 'no-such-fixture'" in capsys.readouterr().err


def test_compare_main_exits_2_when_the_fixture_has_no_committed_run(monkeypatch, tmp_path, capsys):
    _no_grading(monkeypatch)
    monkeypatch.setattr(compare, "RUNLOGS", tmp_path)
    assert compare.main(["--fixture", "bagley-father-1884", "--session", "s"]) == 2
    err = capsys.readouterr().err
    assert "no committed harness run" in err and "RUNLOG=" in err


def test_compare_main_exits_2_when_the_named_runlog_has_no_final_tree(monkeypatch, tmp_path, capsys):
    _no_grading(monkeypatch)
    runlog = _runlog(tmp_path / "bagley-father-1884", "2026-07-31_18-06-28", siblings=False)
    monkeypatch.setattr(compare, "RUNLOGS", tmp_path)
    assert compare.main(["--fixture", "bagley-father-1884", "--session", "s"]) == 2
    assert "has no" in capsys.readouterr().err
    assert runlog.is_file()


def test_compare_main_refuses_a_runlog_that_is_a_run_of_another_fixture(monkeypatch, tmp_path, capsys):
    """`--runlog` is only checked for existence, so a mistyped path would otherwise grade
    another fixture's tree against this fixture's findings and render it as the harness."""
    _no_grading(monkeypatch)
    other = _runlog(tmp_path / "kenneth-quass-death", "2026-07-31_18-06-28")
    assert compare.main([
        "--fixture", "bagley-father-1884", "--session", "s", "--runlog", str(other),
    ]) == 2
    err = capsys.readouterr().err
    assert "is a run of 'kenneth-quass-death'" in err and "bagley-father-1884" in err


def test_compare_main_exits_2_on_an_unknown_session(monkeypatch, tmp_path, capsys):
    _no_grading(monkeypatch)
    _runlog(tmp_path / "bagley-father-1884", "2026-07-31_18-06-28")
    monkeypatch.setattr(compare, "RUNLOGS", tmp_path)
    monkeypatch.setattr(compare.export, "resolve_project", lambda dsn, sid: None)
    assert compare.main(["--fixture", "bagley-father-1884", "--session", "nope"]) == 2
    assert "no session 'nope'" in capsys.readouterr().err


def test_compare_main_grades_both_sides_with_one_instrument_and_names_the_runlog(monkeypatch, tmp_path, capsys):
    """The harness side is re-graded here, not read out of its committed log."""
    runlog = _runlog(tmp_path / "bagley-father-1884", "2026-07-31_18-06-28")
    monkeypatch.setattr(compare, "RUNLOGS", tmp_path)
    monkeypatch.setattr(compare.export, "resolve_project", lambda dsn, sid: "proj_bagley-father-1884_a1b2c3")
    monkeypatch.setattr(compare.export, "export", lambda pid, **kw: 0)
    monkeypatch.setattr(compare, "turn_rows", lambda dsn, sid: [(1.01, 34, 232_000, 0)])
    monkeypatch.setattr(compare.audit, "load", lambda dsn, sid: [])

    graded = {
        "harness": {"verdict": "pass", "per_finding": [{"finding_id": "f1", "matched": "true"}]},
        "prototype": {"verdict": "fail", "per_finding": [{"finding_id": "f1", "matched": "false"}]},
    }
    argvs: list[list[str]] = []

    def fake_grade(argv, **kw):
        argvs.append(argv)
        out = Path(argv[argv.index("--json") + 1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(graded["harness" if len(argvs) == 1 else "prototype"]), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(compare.grade, "run_grade_files", fake_grade)
    code = compare.main([
        "--fixture", "bagley-father-1884", "--session", "sess_x", "--out", str(tmp_path / "out"),
    ])
    assert code == 0
    out = capsys.readouterr().out
    assert runlog.name in out and "run 2026-07-31" in out and "committed, not re-run here" in out
    assert "expected findings last changed" in out
    assert "CAVEAT" not in out, "bagley's findings predate its latest run"
    assert "Both sides were graded" in out
    assert len(argvs) == 2, "both sides graded by the same module"
    harness_tree, _ = compare.runlog_siblings(runlog)
    assert str(harness_tree) in argvs[0], "the harness's committed tree, re-graded"
    proto_tree, _ = compare.grade.exported_documents((tmp_path / "out").resolve(), "proj_bagley-father-1884_a1b2c3")
    assert str(proto_tree) in argvs[1]
    assert "only the harness recovered:    f1" in out
    assert "its own log recorded verdict 'pass'" in out


def test_compare_main_exits_1_when_one_sides_grading_failed(monkeypatch, tmp_path, capsys):
    _runlog(tmp_path / "bagley-father-1884", "2026-07-31_18-06-28")
    monkeypatch.setattr(compare, "RUNLOGS", tmp_path)
    monkeypatch.setattr(compare.export, "resolve_project", lambda dsn, sid: "proj_bagley-father-1884_a1b2c3")
    monkeypatch.setattr(compare.export, "export", lambda pid, **kw: 0)
    monkeypatch.setattr(compare, "turn_rows", lambda dsn, sid: [])
    monkeypatch.setattr(compare.audit, "load", lambda dsn, sid: [])
    monkeypatch.setattr(
        compare.grade, "run_grade_files",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 1, "", "the judge failed\n"),
    )
    assert compare.main([
        "--fixture", "bagley-father-1884", "--session", "s", "--out", str(tmp_path / "out")
    ]) == 1
    out = capsys.readouterr().out
    assert "(not graded)" in out
    assert "Both sides were graded" not in out, "neither side was"
    assert "NOT a comparison: the harness and prototype sides produced no grading" in out


def test_compare_main_warns_when_the_findings_were_amended_after_the_harness_run(monkeypatch, tmp_path, capsys):
    _runlog(tmp_path / "bagley-father-1884", "2026-07-31_18-06-28")
    monkeypatch.setattr(compare, "RUNLOGS", tmp_path)
    monkeypatch.setattr(compare, "findings_changed", lambda fixture, **kw: "2026-09-08")
    monkeypatch.setattr(compare.export, "resolve_project", lambda dsn, sid: "proj_bagley-father-1884_a1b2c3")
    monkeypatch.setattr(compare.export, "export", lambda pid, **kw: 0)
    monkeypatch.setattr(compare, "turn_rows", lambda dsn, sid: [(1.01, 34, 232_000, 0)])
    monkeypatch.setattr(compare.audit, "load", lambda dsn, sid: [])

    def fake_grade(argv, **kw):
        out = Path(argv[argv.index("--json") + 1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"verdict": "pass", "per_finding": []}), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(compare.grade, "run_grade_files", fake_grade)
    assert compare.main([
        "--fixture", "bagley-father-1884", "--session", "s", "--out", str(tmp_path / "out")
    ]) == 0
    out = capsys.readouterr().out
    assert "expected findings last changed 2026-09-08" in out
    assert "CAVEAT: the fixture's expected findings were amended after this harness run" in out
    assert "may be one the harness was never asked to find" in out

    monkeypatch.setattr(compare, "findings_changed", lambda fixture, **kw: "2026-07-27")
    assert compare.main([
        "--fixture", "bagley-father-1884", "--session", "s", "--out", str(tmp_path / "out")
    ]) == 0
    assert "CAVEAT" not in capsys.readouterr().out


def test_compare_main_exits_1_when_the_prototype_export_fails(monkeypatch, tmp_path, capsys):
    _no_grading(monkeypatch)
    _runlog(tmp_path / "bagley-father-1884", "2026-07-31_18-06-28")
    monkeypatch.setattr(compare, "RUNLOGS", tmp_path)
    monkeypatch.setattr(compare.export, "resolve_project", lambda dsn, sid: "proj_bagley-father-1884_a1b2c3")
    monkeypatch.setattr(compare.export, "export", lambda pid, **kw: 1)
    assert compare.main([
        "--fixture", "bagley-father-1884", "--session", "s", "--out", str(tmp_path / "out")
    ]) == 1
    assert "export failed" in capsys.readouterr().err


def test_compare_main_requires_a_fixture_and_a_session():
    for argv in (["--session", "s"], ["--fixture", "bagley-father-1884"]):
        with pytest.raises(SystemExit) as e:
            compare.main(argv)
        assert e.value.code == 2
