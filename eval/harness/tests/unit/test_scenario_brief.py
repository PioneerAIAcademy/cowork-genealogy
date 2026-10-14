"""The judge's scenario slot reads `judge-brief.md`, never a README beside it.

Issue #2478: a scenario README is written for people and was pasted whole into
the judge prompt, where a sentence saying what a correct run does reads as
neutral background. `harness/scenario_brief.py` decides which file reaches the
`{scenario_readme}` slot; these tests pin that decision, its README fallback
(which must be reported, never silent), and that it reaches every scenario the
unit corpus references.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from harness.judge import render_prompt_parts
from harness.orchestrator import _build_warnings
from harness.rubric import empty_rubric
from harness.scenario_brief import (
    EMPTY_BRIEF_MARKER,
    NO_BRIEF_MARKER,
    SOURCE_BRIEF,
    SOURCE_BRIEF_EMPTY,
    SOURCE_NO_BRIEF,
    SOURCE_NONE,
    SOURCE_README_FALLBACK,
    load_scenario_brief,
    readme_fallback_warning,
)
from harness.warning_kinds import HARNESS_WARNING_KINDS, JUDGE_WARNING_KINDS
from harness.workspace import InvalidScenarioError

import run_tests

REPO_ROOT = Path(__file__).resolve().parents[4]
SCENARIOS_DIR = REPO_ROOT / "eval" / "fixtures" / "scenarios"
UNIT_TESTS_DIR = REPO_ROOT / "eval" / "tests" / "unit"

README_TEXT = "# demo\n\nA correct run links a_001 to I1. README_ONLY_SENTINEL\n"
BRIEF_TEXT = "Every tool response is mocked. BRIEF_SENTINEL\n"


def _render(scenario_text: str) -> str:
    prefix, suffix = render_prompt_parts(
        rubric=empty_rubric("demo"),
        judge_context=[],
        scenario_readme=scenario_text,
        user_message="do the thing",
        skills_invoked=[],
        text_response="done",
        file_changes_summary="",
        tool_calls=[],
    )
    return prefix + suffix


def _scenario(root: Path, name: str, *, readme: str | None, brief: str | None) -> Path:
    sdir = root / name
    sdir.mkdir(parents=True)
    (sdir / "research.json").write_text("{}", encoding="utf-8")
    if readme is not None:
        (sdir / "README.md").write_text(readme, encoding="utf-8")
    if brief is not None:
        (sdir / "judge-brief.md").write_text(brief, encoding="utf-8")
    return sdir


def _referenced_scenarios(tests_dir: Path) -> set[str]:
    """Every `input.scenario` named by a unit test, nested suite dirs included."""
    out: set[str] = set()
    for path in tests_dir.rglob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        scenario = (data.get("input") or {}).get("scenario")
        if scenario:
            out.add(scenario)
    return out


# --- The guard: a scenario with a brief never shows the judge its README ---


def test_brief_wins_and_readme_never_reaches_the_prompt(tmp_path: Path) -> None:
    _scenario(tmp_path, "demo", readme=README_TEXT, brief=BRIEF_TEXT)
    brief = load_scenario_brief(tmp_path, "demo")
    assert brief.source == SOURCE_BRIEF
    rendered = _render(brief.text)
    assert "BRIEF_SENTINEL" in rendered
    assert "README_ONLY_SENTINEL" not in rendered


def test_no_real_scenario_with_a_brief_renders_its_readme() -> None:
    briefed = sorted(p.parent for p in SCENARIOS_DIR.glob("*/judge-brief.md"))
    assert briefed, "no scenario carries a judge-brief.md; the guard checks nothing"
    for sdir in briefed:
        readme = sdir / "README.md"
        rendered = _render(load_scenario_brief(SCENARIOS_DIR, sdir.name).text)
        assert (sdir / "judge-brief.md").read_text(encoding="utf-8").strip() in rendered
        if readme.is_file():
            body = readme.read_text(encoding="utf-8").strip()
            assert body not in rendered, f"{sdir.name}: README text reached the judge"


def test_missing_brief_falls_back_to_readme_and_reports_it(tmp_path: Path) -> None:
    _scenario(tmp_path, "demo", readme=README_TEXT, brief=None)
    brief = load_scenario_brief(tmp_path, "demo")
    assert brief.source == SOURCE_README_FALLBACK
    assert "README_ONLY_SENTINEL" in _render(brief.text)

    warnings = _build_warnings([], scenario_brief=brief)
    assert warnings == [readme_fallback_warning(brief)]
    assert warnings[0]["kind"] == "scenario_readme_fallback"
    assert warnings[0]["scenario"] == "demo"
    assert "judge-brief.md" in warnings[0]["advisory"]


@pytest.mark.parametrize("kind", ["scenario_readme_fallback", "scenario_brief_missing"])
def test_fallback_kind_is_a_harness_advisory_not_a_judge_rule(kind: str) -> None:
    assert kind in HARNESS_WARNING_KINDS
    assert kind not in JUDGE_WARNING_KINDS


def test_brief_present_emits_no_fallback_warning(tmp_path: Path) -> None:
    _scenario(tmp_path, "demo", readme=README_TEXT, brief=BRIEF_TEXT)
    assert _build_warnings([], scenario_brief=load_scenario_brief(tmp_path, "demo")) == []


def test_suite_summary_names_the_fallback_scenarios(capsys) -> None:
    run_tests._print_readme_fallbacks([
        {"test_id": "ut_a", "readme_fallback_scenarios": ["s-one"]},
        {"test_id": "ut_b", "readme_fallback_scenarios": ["s-one", "s-two"]},
        {"test_id": "ut_c", "readme_fallback_scenarios": []},
    ])
    out = capsys.readouterr().out
    assert "2 test(s) graded without a judge brief, on a README or nothing" in out
    assert "(2 scenario(s)): s-one, s-two" in out


def test_suite_summary_silent_with_no_fallback(capsys) -> None:
    run_tests._print_readme_fallbacks([{"test_id": "ut_a", "readme_fallback_scenarios": []}])
    assert capsys.readouterr().out == ""


def test_empty_brief_is_distinct_from_no_scenario_and_from_readme(tmp_path: Path) -> None:
    _scenario(tmp_path, "demo", readme=README_TEXT, brief="  \n\n")
    brief = load_scenario_brief(tmp_path, "demo")
    assert brief.source == SOURCE_BRIEF_EMPTY
    rendered = _render(brief.text)
    assert EMPTY_BRIEF_MARKER in rendered
    assert "(stateless test)" not in rendered
    assert "README_ONLY_SENTINEL" not in rendered
    assert "(stateless test)" in _render(load_scenario_brief(tmp_path, None).text)


def test_force_readme_skips_the_brief(tmp_path: Path) -> None:
    _scenario(tmp_path, "demo", readme=README_TEXT, brief=BRIEF_TEXT)
    brief = load_scenario_brief(tmp_path, "demo", force_readme=True)
    assert brief.source == SOURCE_README_FALLBACK
    assert "README_ONLY_SENTINEL" in brief.text


# --- Reach --------------------------------------------------------------------


@pytest.mark.parametrize("scenario", [None, ""])
def test_absent_or_null_scenario_is_stateless(tmp_path: Path, scenario) -> None:
    brief = load_scenario_brief(tmp_path, scenario)
    assert (brief.text, brief.source) == ("", SOURCE_NONE)


def test_scenario_with_neither_file_is_not_stateless_and_is_reported(tmp_path: Path) -> None:
    _scenario(tmp_path, "demo", readme=None, brief=None)
    brief = load_scenario_brief(tmp_path, "demo")
    assert (brief.text, brief.source) == (NO_BRIEF_MARKER, SOURCE_NO_BRIEF)
    assert brief.lacks_brief and not brief.is_readme_fallback
    rendered = _render(brief.text)
    assert NO_BRIEF_MARKER in rendered
    assert "(stateless test)" not in rendered

    warnings = _build_warnings([], scenario_brief=brief)
    assert [w["kind"] for w in warnings] == ["scenario_brief_missing"]
    assert warnings[0]["scenario"] == "demo"


def test_brief_or_readme_never_reports_brief_missing(tmp_path: Path) -> None:
    _scenario(tmp_path, "readme-only", readme=README_TEXT, brief=None)
    _scenario(tmp_path, "briefed", readme=None, brief=BRIEF_TEXT)
    assert load_scenario_brief(tmp_path, "readme-only").source == SOURCE_README_FALLBACK
    briefed = load_scenario_brief(tmp_path, "briefed")
    assert briefed.source == SOURCE_BRIEF and not briefed.lacks_brief


@pytest.mark.parametrize("name", ["Demo", "DEMO", "demo ", "missing"])
def test_inexact_scenario_name_raises(tmp_path: Path, name: str) -> None:
    _scenario(tmp_path, "demo", readme=README_TEXT, brief=BRIEF_TEXT)
    with pytest.raises(InvalidScenarioError):
        load_scenario_brief(tmp_path, name)


def test_every_referenced_scenario_resolves_and_fallbacks_are_counted() -> None:
    referenced = _referenced_scenarios(UNIT_TESTS_DIR)
    assert len(referenced) > 50, "the corpus walk found almost nothing"
    sources = {s: load_scenario_brief(SCENARIOS_DIR, s).source for s in referenced}
    expected_fallback = {
        s for s in referenced
        if (SCENARIOS_DIR / s / "README.md").is_file()
        and not (SCENARIOS_DIR / s / "judge-brief.md").is_file()
    }
    assert {s for s, src in sources.items() if src == SOURCE_README_FALLBACK} == expected_fallback
    expected_missing = {
        s for s in referenced
        if not (SCENARIOS_DIR / s / "README.md").is_file()
        and not (SCENARIOS_DIR / s / "judge-brief.md").is_file()
    }
    assert {s for s, src in sources.items() if src == SOURCE_NO_BRIEF} == expected_missing
    assert SOURCE_NONE not in sources.values(), "a referenced scenario rendered as stateless"
    briefed = {s for s in referenced if (SCENARIOS_DIR / s / "judge-brief.md").is_file()}
    assert {"flynn-record-matching", "christian-hole-quality"} <= briefed


def test_corpus_walk_reaches_nested_suite_dirs(tmp_path: Path) -> None:
    nested = tmp_path / "suite" / "deeper"
    nested.mkdir(parents=True)
    (nested / "t.json").write_text(
        json.dumps({"input": {"scenario": "nested-only"}}), encoding="utf-8"
    )
    (tmp_path / "suite" / "u.json").write_text(
        json.dumps({"input": {"scenario": None}}), encoding="utf-8"
    )
    assert _referenced_scenarios(tmp_path) == {"nested-only"}


# --- Legitimate variants the guard must still accept --------------------------


def test_reflowed_brief_still_renders_and_hides_the_readme(tmp_path: Path) -> None:
    _scenario(
        tmp_path, "demo", readme=README_TEXT,
        brief="Every tool response\nis mocked.\n\n\nBRIEF_SENTINEL",
    )
    rendered = _render(load_scenario_brief(tmp_path, "demo").text)
    assert "BRIEF_SENTINEL" in rendered and "README_ONLY_SENTINEL" not in rendered


def test_renamed_scenario_dir_resolves_under_its_new_name(tmp_path: Path) -> None:
    _scenario(tmp_path, "old-name", readme=README_TEXT, brief=BRIEF_TEXT)
    shutil.move(str(tmp_path / "old-name"), str(tmp_path / "new-name"))
    assert load_scenario_brief(tmp_path, "new-name").source == SOURCE_BRIEF
    with pytest.raises(InvalidScenarioError):
        load_scenario_brief(tmp_path, "old-name")


def test_brief_on_an_unreferenced_scenario_is_harmless(tmp_path: Path) -> None:
    scenarios = tmp_path / "scenarios"
    shutil.copytree(SCENARIOS_DIR / "mid-research-flynn-1900-will", scenarios / "mid-research-flynn-1900-will")
    (scenarios / "mid-research-flynn-1900-will" / "judge-brief.md").write_text(
        BRIEF_TEXT, encoding="utf-8"
    )
    assert "mid-research-flynn-1900-will" not in _referenced_scenarios(UNIT_TESTS_DIR)
    assert load_scenario_brief(scenarios, "mid-research-flynn-1900-will").source == SOURCE_BRIEF


def test_forced_readme_on_a_brief_only_scenario_is_not_stateless(tmp_path: Path) -> None:
    from harness.scenario_brief import NO_README_MARKER

    _scenario(tmp_path, "demo", readme=None, brief=BRIEF_TEXT)
    brief = load_scenario_brief(tmp_path, "demo", force_readme=True)
    assert brief.text == NO_README_MARKER
    assert "(stateless test)" not in _render(brief.text)
