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
import re
import shutil
from collections import Counter
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


# --- Every referenced scenario has a brief, or is on a list that only shrinks ---

WITHOUT_BRIEF_LIST = Path(__file__).with_name("scenarios_without_brief.txt")

# How many names the list may hold. A wave of briefs lowers it by the names it removes, so a
# name can only join the list by raising this number, which a reviewer sees.
WITHOUT_BRIEF_CAP = 165

_ID_SHAPE = re.compile(r"([A-Za-z]+_?)(\d+)")
_ID_TOKEN = re.compile(r"(?<![A-Za-z0-9_\-/:.])([A-Za-z]+_?)(\d+)(?![A-Za-z0-9_\-])")


def _read_list(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]


def _entries(directory: Path) -> set[str]:
    """Exact names in a directory: `Path.is_dir` ignores case on Windows and macOS,
    and the harness does not."""
    return {p.name for p in directory.iterdir()} if directory.is_dir() else set()


def brief_guard_violations(
    tests_dir: Path, scenarios_dir: Path, listed: list[str], cap: int = WITHOUT_BRIEF_CAP
) -> list[str]:
    """Issue #2478. Each scenario a unit test references has a `judge-brief.md`
    unless it is on the list; the list holds exactly `cap` names, in byte order,
    with no repeats, each one existing, referenced and still without a brief."""
    referenced = _referenced_scenarios(tests_dir)
    dirs = _entries(scenarios_dir)
    has_brief = {name for name in dirs if "judge-brief.md" in _entries(scenarios_dir / name)}
    out: list[str] = []
    if len(listed) != cap:
        out.append(
            f"the list holds {len(listed)} names and its cap is {cap}: a wave lowers the cap by the "
            f"names it removes, and a new scenario writes a brief instead of joining the list"
        )
    if listed != sorted(listed):
        out.append("the list is not sorted (byte order: `LC_ALL=C sort`, or Python's sorted())")
    counts = Counter(listed)
    for name in sorted(n for n, c in counts.items() if c > 1):
        out.append(f"{name}: listed more than once")
    for name in sorted(counts):
        if name not in dirs:
            out.append(f"{name}: listed, but no scenario directory has exactly that name")
        elif name in has_brief:
            out.append(f"{name}: has a judge-brief.md now, so remove it from the list")
        elif name not in referenced:
            out.append(f"{name}: no unit test references it any more, so remove it from the list")
    for name in sorted(referenced - set(counts) - has_brief):
        out.append(
            f"{name}: a unit test reads it and it has no judge-brief.md; write one "
            f"(docs/specs/unit-test-spec.md §3.1)"
        )
    return out


def _fixture_values(scenario_dir: Path) -> set[str]:
    """Every id-shaped string in the scenario's JSON, under any key (`id`,
    `record_persona_id`, `ref`, ...)."""
    found: set[str] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
        elif isinstance(node, str) and _ID_SHAPE.fullmatch(node):
            found.add(node)

    for name in ("research.json", "tree.gedcomx.json"):
        path = scenario_dir / name
        if path.is_file():
            walk(json.loads(path.read_text(encoding="utf-8")))
    return found


def corpus_id_prefixes(scenarios_dir: Path) -> set[str]:
    """The id prefixes the fixtures actually use (`a_`, `log_`, `p_`, `I`, `N`, `RT` ...)."""
    out: set[str] = set()
    for sdir in scenarios_dir.iterdir():
        if sdir.is_dir():
            out |= {_ID_SHAPE.fullmatch(v).group(1) for v in _fixture_values(sdir)}
    return out


def _code_text(markdown: str) -> list[str]:
    """The code in a brief: fenced blocks whole, then inline spans of any backtick run."""
    fenced = re.compile(r"^ {0,3}(`{3,}|~{3,})[^\n]*\n(.*?)^ {0,3}\1[ \t]*$", re.M | re.S)
    code = [m.group(2) for m in fenced.finditer(markdown)]
    rest = fenced.sub("", markdown)
    code += [m.group(2) for m in re.finditer(r"(`+)(.+?)(?<!`)\1(?!`)", rest, re.S)]
    return code


def brief_id_violations(scenario_dir: Path, prefixes: set[str]) -> list[str]:
    """Issue #2478. Every fixture id a brief names in code (`a_017`, `p_2`,
    `I12`, `N3` ...) exists in that scenario's JSON. An id is a word whose
    letter prefix the fixtures use, followed by digits."""
    if "judge-brief.md" not in _entries(scenario_dir):
        return []
    values = _fixture_values(scenario_dir)
    named = {
        m.group(0)
        for chunk in _code_text((scenario_dir / "judge-brief.md").read_text(encoding="utf-8"))
        for m in _ID_TOKEN.finditer(chunk)
        if m.group(1) in prefixes
    }
    return [
        f"{scenario_dir.name}: judge-brief.md names `{token}`, which nothing in its research.json "
        f"or tree.gedcomx.json carries; a reference that is not a fixture id, such as a "
        f"microfilm number, goes outside backticks"
        for token in sorted(named - values)
    ]


def test_every_referenced_scenario_has_a_brief_or_is_listed() -> None:
    listed = _read_list(WITHOUT_BRIEF_LIST)
    assert listed, "the list is empty: delete it and this list check with it (issue #2478's last step)"
    assert brief_guard_violations(UNIT_TESTS_DIR, SCENARIOS_DIR, listed) == []


def test_every_brief_names_only_ids_its_fixture_holds() -> None:
    briefs = sorted(SCENARIOS_DIR.glob("*/judge-brief.md"))
    assert briefs, "no brief to check"
    prefixes = corpus_id_prefixes(SCENARIOS_DIR)
    assert {"a_", "log_", "p_", "I", "N"} <= prefixes, "the prefix walk found almost nothing"
    assert [v for b in briefs for v in brief_id_violations(b.parent, prefixes)] == []


def _guard_corpus(tmp_path: Path, scenarios: dict[str, bool]) -> tuple[Path, Path]:
    tests_dir, scenarios_dir = tmp_path / "tests", tmp_path / "scenarios"
    tests_dir.mkdir()
    for name, has_brief in scenarios.items():
        _scenario(scenarios_dir, name, readme=README_TEXT, brief=BRIEF_TEXT if has_brief else None)
        (tests_dir / f"{name}.json").write_text(
            json.dumps({"input": {"scenario": name}}), encoding="utf-8"
        )
    return tests_dir, scenarios_dir


def _violations(tests_dir: Path, scenarios_dir: Path, listed: list[str]) -> list[str]:
    return brief_guard_violations(tests_dir, scenarios_dir, listed, cap=len(listed))


def test_guard_fails_a_new_scenario_with_no_brief(tmp_path: Path) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"old": False, "planted": False})
    violations = _violations(tests_dir, scenarios_dir, ["old"])
    assert len(violations) == 1 and violations[0].startswith("planted: a unit test reads it")


def test_guard_passes_a_new_scenario_with_a_brief(tmp_path: Path) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"old": False, "new": True})
    assert _violations(tests_dir, scenarios_dir, ["old"]) == []


def test_guard_fails_a_new_scenario_added_to_the_list(tmp_path: Path) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"old": False, "planted": False})
    violations = brief_guard_violations(tests_dir, scenarios_dir, ["old", "planted"], cap=1)
    assert len(violations) == 1 and violations[0].startswith("the list holds 2 names and its cap is 1")


def test_guard_fails_a_wave_that_does_not_lower_the_cap(tmp_path: Path) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"a": False, "b": True})
    violations = brief_guard_violations(tests_dir, scenarios_dir, ["a"], cap=2)
    assert violations == [
        "the list holds 1 names and its cap is 2: a wave lowers the cap by the names it removes, "
        "and a new scenario writes a brief instead of joining the list"
    ]


def test_guard_fails_a_listed_scenario_that_now_has_a_brief(tmp_path: Path) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"a": False, "b": True})
    assert _violations(tests_dir, scenarios_dir, ["a", "b"]) == [
        "b: has a judge-brief.md now, so remove it from the list"
    ]


@pytest.mark.parametrize(
    ("listed", "expected"),
    [
        (["b", "a"], "the list is not sorted (byte order: `LC_ALL=C sort`, or Python's sorted())"),
        (["a", "a", "b"], "a: listed more than once"),
        (["a", "b", "gone"], "gone: listed, but no scenario directory has exactly that name"),
        (["A", "b"], "A: listed, but no scenario directory has exactly that name"),
    ],
)
def test_guard_fails_a_malformed_list(tmp_path: Path, listed: list[str], expected: str) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"a": False, "b": False})
    assert expected in _violations(tests_dir, scenarios_dir, listed)


def test_guard_fails_a_listed_scenario_no_test_reads(tmp_path: Path) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"a": False})
    _scenario(scenarios_dir, "orphan", readme=README_TEXT, brief=None)
    assert _violations(tests_dir, scenarios_dir, ["a", "orphan"]) == [
        "orphan: no unit test references it any more, so remove it from the list"
    ]


def test_guard_does_not_take_a_miscased_brief_file(tmp_path: Path) -> None:
    tests_dir, scenarios_dir = _guard_corpus(tmp_path, {"old": False, "new": False})
    (scenarios_dir / "new" / "Judge-Brief.md").write_text(BRIEF_TEXT, encoding="utf-8")
    violations = _violations(tests_dir, scenarios_dir, ["old"])
    assert len(violations) == 1 and violations[0].startswith("new: a unit test reads it")


def test_list_file_reads_names_and_skips_comments(tmp_path: Path) -> None:
    path = tmp_path / "list.txt"
    path.write_text("# header\n\n  alpha  \nbeta\n# trailing\n", encoding="utf-8")
    assert _read_list(path) == ["alpha", "beta"]


PREFIXES = {"a_", "log_", "p_", "I", "R", "N", "RT"}


def _briefed(tmp_path: Path, brief: str) -> Path:
    sdir = _scenario(tmp_path, "demo", readme=None, brief=brief)
    (sdir / "research.json").write_text(
        json.dumps({
            "assertions": [{"id": "a_017", "record_persona_id": "p_2"}],
            "log": [{"id": "log_003"}],
        }),
        encoding="utf-8",
    )
    (sdir / "tree.gedcomx.json").write_text(
        json.dumps({"persons": [{"id": "I12"}, {"id": "N3"}], "relationships": [{"id": "R27"}]}),
        encoding="utf-8",
    )
    return sdir


@pytest.mark.parametrize(
    "brief",
    [
        "Assertion `a_017` from `log_003` names `I12` (`R27`).\n",
        "Persona `p_2` is the record's second person.\n",
        "The name `N3` belongs to `I12`.\n",
        "Two assertions, `a_017, log_003 (birth)`, share a span.\n",
        "Doubled ``a_017`` backticks.\n",
    ],
)
def test_id_check_passes_ids_the_fixture_holds(tmp_path: Path, brief: str) -> None:
    assert brief_id_violations(_briefed(tmp_path, brief), PREFIXES) == []


@pytest.mark.parametrize(
    ("brief", "bad"),
    [
        ("Assertion `a_018` is planted.\n", "a_018"),
        ("Person `I99` is the subject.\n", "I99"),
        ("Entry `\nlog_004\n` sits across lines.\n", "log_004"),
        ("Name `N9` is invented.\n", "N9"),
        ("Persona `p_7` is invented.\n", "p_7"),
        ("Two in one span: `a_017, a_018 (death)`.\n", "a_018"),
        ("```\nshown\n```\nThen `a_018` after a fence.\n", "a_018"),
        ("```json\n{\"id\": \"a_019\"}\n```\n", "a_019"),
        ("Doubled ``a_018 `x` `` span.\n", "a_018"),
    ],
)
def test_id_check_fails_an_id_the_fixture_lacks(tmp_path: Path, brief: str, bad: str) -> None:
    violations = brief_id_violations(_briefed(tmp_path, brief), PREFIXES)
    assert len(violations) == 1 and f"`{bad}`" in violations[0]


def test_id_check_ignores_prose_unknown_prefixes_and_lookalikes(tmp_path: Path) -> None:
    brief = (
        "Ids like a_999 in prose, film M246, `research.json`, `pli_`, `I`, `zz_9`, "
        "`ark:/61903/1:1:a_999`, `I99x` and `a_999-b` are not checked.\n"
    )
    assert brief_id_violations(_briefed(tmp_path, brief), PREFIXES) == []


def test_id_check_tells_the_author_a_film_in_code_goes_outside_backticks(tmp_path: Path) -> None:
    violations = brief_id_violations(_briefed(tmp_path, "The census is on film `M432`.\n"), PREFIXES | {"M"})
    assert len(violations) == 1 and "goes outside backticks" in violations[0]


def test_corpus_prefixes_come_from_every_key(tmp_path: Path) -> None:
    _briefed(tmp_path, "x\n")
    assert corpus_id_prefixes(tmp_path) == {"a_", "p_", "log_", "I", "N", "R"}
