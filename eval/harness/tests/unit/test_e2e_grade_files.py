"""Unit tests for e2e.grade_files — the CLI that grades a final tree/research from
anywhere against an e2e fixture.

Offline: `run_judge` is monkeypatched everywhere, so no judge call, no key, no network.
What is actually checked is the contract the prototype side depends on — the fixture is
loaded by the orchestrator's own loader, the avoid guard is applied AFTER the judge with
the fixture's own subject ids, a `fail` verdict is a result rather than an error, and a
missing input exits 2 instead of raising.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e import grade_files
from e2e.orchestrator import DEFAULT_FIXTURES_ROOT

REAL_FIXTURE = "bagley-father-1884"


# ── helpers ──────────────────────────────────────────────────────────────────────


def write_fixture(root: Path, slug: str, *, findings: list[dict] | None = None, **extra) -> Path:
    """A minimal fixture directory `load_fixture` accepts."""
    d = root / slug
    d.mkdir(parents=True)
    fixture_json = {
        "id": slug,
        "researcher_question": "Who were the parents of Ada Lovelace?",
        "model": {"judge": "claude-haiku-4-5-20251001"},
    }
    fixture_json.update(extra)
    (d / "fixture.json").write_text(json.dumps(fixture_json), encoding="utf-8")
    (d / "expected-findings.json").write_text(
        json.dumps({"findings": findings if findings is not None else [
            {"id": "f1", "type": "relationship", "description": "Ada's father is Byron", "required": True},
        ]}),
        encoding="utf-8",
    )
    return d


def judge_output(**overrides) -> dict:
    base = {
        "per_finding": [{"finding_id": "f1", "matched": "true", "agent_evidence": "", "notes": ""}],
        "recall_required": 1.0,
        "recall_total": 1.0,
        "verdict": "pass",
        "rationale": "ok",
        "proof_quality": {"score": 3},
    }
    base.update(overrides)
    return base


def tree_and_research(tmp_path: Path) -> tuple[Path, Path]:
    tree = tmp_path / "tree.gedcomx.json"
    tree.write_text(json.dumps({"persons": [{"id": "I1"}]}), encoding="utf-8")
    research = tmp_path / "research.json"
    research.write_text(json.dumps({"proof_summaries": [{"text": "…"}]}), encoding="utf-8")
    return tree, research


@pytest.fixture
def no_env(monkeypatch):
    """A key in the process env, and eval/.env never read (so the suite is hermetic)."""
    monkeypatch.setattr(grade_files, "load_env_file", lambda *a, **k: None)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-a-real-key")


# ── the fixture loader is the orchestrator's ─────────────────────────────────────


def test_fixture_for_is_the_orchestrators_loader_on_a_real_fixture():
    fixture = grade_files.fixture_for(REAL_FIXTURE)
    meta = json.loads((DEFAULT_FIXTURES_ROOT / REAL_FIXTURE / "fixture.json").read_text(encoding="utf-8"))
    expected = json.loads(
        (DEFAULT_FIXTURES_ROOT / REAL_FIXTURE / "expected-findings.json").read_text(encoding="utf-8")
    )
    assert fixture.id == REAL_FIXTURE
    assert fixture.researcher_question == meta["researcher_question"]
    assert fixture.expected_findings == expected
    assert fixture.judge_model == meta["model"]["judge"], "the fixture's judge model, not the default"
    assert meta["source_pid"] in fixture.subject_person_ids, "the avoid guard's subject exemption"


def test_fixture_for_refuses_a_slug_with_no_fixture_json(tmp_path):
    (tmp_path / "not-a-fixture").mkdir()
    with pytest.raises(grade_files.InputError, match="no fixture 'not-a-fixture'"):
        grade_files.fixture_for("not-a-fixture", fixtures_root=tmp_path)


# ── grade(): run_judge then apply_avoid_guard, the orchestrator's order ───────────


def test_grade_runs_the_judge_then_the_avoid_guard_with_the_fixtures_own_arguments(tmp_path, monkeypatch):
    fixture_dir = write_fixture(tmp_path, "look-alike")
    (fixture_dir / "starting-research.json").write_text(
        json.dumps({"project": {"subject_person_ids": ["ABC-123"]}}), encoding="utf-8"
    )
    fixture = grade_files.fixture_for("look-alike", fixtures_root=tmp_path)
    tree = {"persons": [{"id": "I1"}]}
    research = {"proof_summaries": []}
    calls: list[tuple] = []

    def fake_run_judge(**kwargs):
        calls.append(("run_judge", kwargs))
        return judge_output()

    def fake_guard(output, **kwargs):
        calls.append(("apply_avoid_guard", output, kwargs))
        return {**output, "avoid_guard": {"forced_false": []}}

    monkeypatch.setattr(grade_files, "run_judge", fake_run_judge)
    monkeypatch.setattr(grade_files, "apply_avoid_guard", fake_guard)

    out = grade_files.grade(fixture, final_tree=tree, final_research=research)

    assert [c[0] for c in calls] == ["run_judge", "apply_avoid_guard"], "the guard runs AFTER the judge"
    judge_kwargs = calls[0][1]
    assert judge_kwargs["research_question"] == fixture.researcher_question
    assert judge_kwargs["expected_findings"] == fixture.expected_findings
    assert judge_kwargs["final_tree"] is tree and judge_kwargs["final_research"] is research
    assert judge_kwargs["model"] == "claude-haiku-4-5-20251001", "the fixture's judge model by default"
    _, guarded_output, guard_kwargs = calls[1]
    assert guarded_output == judge_output(), "the guard grades the JUDGE's output, not the raw fixture"
    assert guard_kwargs["expected_findings"] == fixture.expected_findings
    assert guard_kwargs["final_tree"] is tree
    assert guard_kwargs["subject_person_ids"] == fixture.subject_person_ids == frozenset({"ABC-123"})
    assert out["avoid_guard"] == {"forced_false": []}, "the guard's output is what is returned"


def test_grade_model_argument_overrides_the_fixtures_judge(tmp_path, monkeypatch):
    write_fixture(tmp_path, "slug")
    fixture = grade_files.fixture_for("slug", fixtures_root=tmp_path)
    seen: dict = {}
    monkeypatch.setattr(grade_files, "run_judge", lambda **kw: seen.update(kw) or judge_output())
    monkeypatch.setattr(grade_files, "apply_avoid_guard", lambda out, **kw: out)
    grade_files.grade(fixture, final_tree={}, model="claude-opus-4-8")
    assert seen["model"] == "claude-opus-4-8"


# ── rendering ────────────────────────────────────────────────────────────────────


def test_render_names_the_verdict_and_one_line_per_expected_finding(tmp_path):
    write_fixture(tmp_path, "slug", findings=[
        {"id": "f1", "type": "relationship", "description": "Ada's father is Byron"},
        {"id": "f2", "type": "fact", "description": "Ada was born 10 December 1815"},
    ])
    fixture = grade_files.fixture_for("slug", fixtures_root=tmp_path)
    text = grade_files.render(fixture, judge_output(
        verdict="partial",
        per_finding=[{"finding_id": "f1", "matched": "true"}, {"finding_id": "f2", "matched": "false"}],
        recall_required=0.5, recall_total=0.5,
    ))
    assert "verdict   partial" in text and "recall required 0.50" in text
    lines = [line for line in text.splitlines() if line.startswith(("f1", "f2"))]
    assert lines[0].startswith("f1") and "true" in lines[0] and "Ada's father is Byron" in lines[0]
    assert lines[1].startswith("f2") and "false" in lines[1] and "born 10 December 1815" in lines[1]


def test_render_shows_an_ungraded_finding_and_a_finding_the_fixture_does_not_list(tmp_path):
    write_fixture(tmp_path, "slug", findings=[{"id": "f1", "description": "Ada's father is Byron"}])
    fixture = grade_files.fixture_for("slug", fixtures_root=tmp_path)
    text = grade_files.render(fixture, judge_output(
        per_finding=[{"finding_id": "f9", "matched": "false"}]
    ))
    assert "f1" in text and "(not graded)" in text, "an expected finding the judge skipped is still a row"
    assert "f9" in text and "graded anyway" in text, "a stray grade is shown, not dropped"


def test_render_reports_what_the_avoid_guard_forced(tmp_path):
    write_fixture(tmp_path, "slug", findings=[{"id": "f1", "description": "the namesake", "polarity": "avoid"}])
    fixture = grade_files.fixture_for("slug", fixtures_root=tmp_path)
    text = grade_files.render(fixture, judge_output(
        verdict="fail",
        per_finding=[{"finding_id": "f1", "matched": "false"}],
        avoid_guard={"forced_false": [{"finding_id": "f1", "person_ids": ["XXXX-YYY"]}]},
    ))
    assert "avoid-guard forced f1 to false" in text and "XXXX-YYY" in text


def test_render_says_so_when_the_fixture_lists_no_findings(tmp_path):
    write_fixture(tmp_path, "slug", findings=[])
    fixture = grade_files.fixture_for("slug", fixtures_root=tmp_path)
    text = grade_files.render(fixture, judge_output(per_finding=[]))
    assert "(the fixture lists no expected findings)" in text


def test_title_of_trims_to_one_line_and_falls_back_to_the_type():
    long = {"description": "x" * 200, "type": "relationship"}
    assert len(grade_files.title_of(long)) == grade_files.TITLE_WIDTH
    assert grade_files.title_of({"description": "a\n  b", "type": "fact"}) == "a b"
    assert grade_files.title_of({"type": "fact"}) == "(fact)"


def test_labels_of_tolerates_a_judge_output_with_no_per_finding():
    assert grade_files.labels_of({}) == {}
    assert grade_files.labels_of({"per_finding": "not a list"}) == {}
    assert grade_files.labels_of({"per_finding": [{"finding_id": "f1", "matched": "partial"}]}) == {"f1": "partial"}


# ── the CLI: arguments and exit codes ────────────────────────────────────────────


def test_main_exits_0_on_a_fail_verdict_and_prints_the_table(tmp_path, monkeypatch, capsys, no_env):
    write_fixture(tmp_path, "slug")
    tree, research = tree_and_research(tmp_path)
    monkeypatch.setattr(grade_files, "run_judge", lambda **kw: judge_output(
        verdict="fail", per_finding=[{"finding_id": "f1", "matched": "false"}]
    ))
    monkeypatch.setattr(grade_files, "apply_avoid_guard", lambda out, **kw: out)
    code = grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--research", str(research),
        "--fixtures-root", str(tmp_path),
    ])
    assert code == 0, "a fail verdict is a result, not an error"
    assert "verdict   fail" in capsys.readouterr().out


def test_main_passes_the_research_through_and_omits_it_when_not_given(tmp_path, monkeypatch, no_env):
    write_fixture(tmp_path, "slug")
    tree, research = tree_and_research(tmp_path)
    seen: list[dict] = []
    monkeypatch.setattr(grade_files, "run_judge", lambda **kw: seen.append(kw) or judge_output())
    monkeypatch.setattr(grade_files, "apply_avoid_guard", lambda out, **kw: out)

    grade_files.main(["--fixture", "slug", "--tree", str(tree), "--fixtures-root", str(tmp_path)])
    assert seen[-1]["final_research"] is None
    assert seen[-1]["final_tree"] == {"persons": [{"id": "I1"}]}

    grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--research", str(research),
        "--fixtures-root", str(tmp_path),
    ])
    assert seen[-1]["final_research"] == {"proof_summaries": [{"text": "…"}]}


def test_main_writes_the_raw_judge_output_with_json(tmp_path, monkeypatch, no_env):
    write_fixture(tmp_path, "slug")
    tree, _ = tree_and_research(tmp_path)
    graded = judge_output(avoid_guard={"forced_false": []})
    monkeypatch.setattr(grade_files, "run_judge", lambda **kw: judge_output())
    monkeypatch.setattr(grade_files, "apply_avoid_guard", lambda out, **kw: graded)
    out_path = tmp_path / "nested" / "judge.json"
    assert grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--json", str(out_path),
        "--fixtures-root", str(tmp_path),
    ]) == 0
    assert json.loads(out_path.read_text(encoding="utf-8")) == graded, "the GUARDED output, not the raw judge's"


def test_main_exits_2_on_a_missing_fixture_tree_or_research(tmp_path, monkeypatch, capsys, no_env):
    write_fixture(tmp_path, "slug")
    tree, _ = tree_and_research(tmp_path)

    def must_not_run(**kw):
        raise AssertionError("the judge must not be called on a missing input")

    monkeypatch.setattr(grade_files, "run_judge", must_not_run)

    assert grade_files.main([
        "--fixture", "nope", "--tree", str(tree), "--fixtures-root", str(tmp_path)
    ]) == 2
    assert "no fixture 'nope'" in capsys.readouterr().err

    assert grade_files.main([
        "--fixture", "slug", "--tree", str(tmp_path / "gone.json"), "--fixtures-root", str(tmp_path)
    ]) == 2
    assert "cannot read the final tree" in capsys.readouterr().err

    assert grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--research", str(tmp_path / "gone.json"),
        "--fixtures-root", str(tmp_path),
    ]) == 2
    assert "cannot read the final research" in capsys.readouterr().err

    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert grade_files.main([
        "--fixture", "slug", "--tree", str(bad), "--fixtures-root", str(tmp_path)
    ]) == 2
    assert "not valid JSON" in capsys.readouterr().err


def test_main_exits_2_without_a_key_and_never_calls_the_judge(tmp_path, monkeypatch, capsys):
    write_fixture(tmp_path, "slug")
    tree, _ = tree_and_research(tmp_path)
    monkeypatch.setattr(grade_files, "load_env_file", lambda *a, **k: None)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    def must_not_run(**kw):
        raise AssertionError("the judge must not be called without a key")

    monkeypatch.setattr(grade_files, "run_judge", must_not_run)
    assert grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--fixtures-root", str(tmp_path)
    ]) == 2
    assert "no ANTHROPIC_API_KEY" in capsys.readouterr().err


def test_main_reads_eval_env_before_deciding_the_key_is_missing(tmp_path, monkeypatch):
    """The key normally lives in eval/.env, not the shell — so the loader must run."""
    write_fixture(tmp_path, "slug")
    tree, _ = tree_and_research(tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(
        grade_files, "load_env_file",
        lambda *a, **k: monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-from-eval-env"),
    )
    monkeypatch.setattr(grade_files, "run_judge", lambda **kw: judge_output())
    monkeypatch.setattr(grade_files, "apply_avoid_guard", lambda out, **kw: out)
    assert grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--fixtures-root", str(tmp_path)
    ]) == 0


def test_main_exits_1_when_the_judge_itself_fails(tmp_path, monkeypatch, capsys, no_env):
    write_fixture(tmp_path, "slug")
    tree, _ = tree_and_research(tmp_path)

    def boom(**kw):
        raise RuntimeError("upstream 529")

    monkeypatch.setattr(grade_files, "run_judge", boom)
    assert grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--fixtures-root", str(tmp_path)
    ]) == 1
    assert "the judge failed (RuntimeError: upstream 529)" in capsys.readouterr().err


def test_main_forwards_model_to_the_judge(tmp_path, monkeypatch, no_env):
    write_fixture(tmp_path, "slug")
    tree, _ = tree_and_research(tmp_path)
    seen: dict = {}
    monkeypatch.setattr(grade_files, "run_judge", lambda **kw: seen.update(kw) or judge_output())
    monkeypatch.setattr(grade_files, "apply_avoid_guard", lambda out, **kw: out)
    grade_files.main([
        "--fixture", "slug", "--tree", str(tree), "--model", "claude-opus-4-8",
        "--fixtures-root", str(tmp_path),
    ])
    assert seen["model"] == "claude-opus-4-8"


def test_main_requires_a_fixture_and_a_tree():
    with pytest.raises(SystemExit) as e:
        grade_files.main(["--tree", "x.json"])
    assert e.value.code == 2
    with pytest.raises(SystemExit) as e:
        grade_files.main(["--fixture", "slug"])
    assert e.value.code == 2
