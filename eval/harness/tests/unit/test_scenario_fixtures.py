"""Lint: every shared scenario fixture under `eval/fixtures/scenarios/`
must be schema-valid.

The harness runnability gate (`harness.runnability.check_runnable`)
validates a scenario's `research.json` **and** `tree.gedcomx.json`
against the project schemas before running any test that references the
scenario. A fixture that drifts from the schema — e.g. when a new
required field is added to `research.schema.json` but the fixtures are
not migrated — silently makes every test using that scenario un-runnable
at harness runtime.

No other unit test loads these fixtures, so without this lint the drift
only surfaces when someone runs `run_tests.py`. This test pins the same
schema contract the runnability gate enforces, but as a fast,
network-free unit test that runs in CI.

A second lint here pins the counts a scenario README asserts against the
`research.json` beside it. A README is pasted verbatim into the judge
prompt as `{scenario_readme}` (`harness/orchestrator.py::_load_scenario_readme`
-> `eval/harness/judge/prompt.md`), so a README that restates the fixture's
contents is a second source of truth the judge is told to believe. When it
drifts the judge grades against a project state that does not exist:
`mid-research-flynn`'s README claimed 4 sources against a fixture holding 9,
and a judge duly failed a skill for "fabricating" `src_006` (issue #1333).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from harness.schema_validator import (
    validate_research_json,
    validate_tree_gedcomx_json,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
SCENARIOS_DIR = REPO_ROOT / "eval" / "fixtures" / "scenarios"
TESTS_DIR = REPO_ROOT / "eval" / "tests"


def _scenario_dirs() -> list[Path]:
    dirs = sorted(
        p for p in SCENARIOS_DIR.glob("*") if (p / "research.json").exists()
    )
    assert dirs, (
        f"No scenario fixtures found under {SCENARIOS_DIR}. Check the "
        "fixtures directory layout."
    )
    return dirs


def _intentionally_invalid_scenarios(tests_dir: Path = TESTS_DIR) -> set[str]:
    """Scenario names referenced by tests that set `intentionally_invalid`.

    These scenarios are broken on purpose (a validator/guardrail skill must
    be able to run against invalid input), so the schema-validity lint must
    exempt them. The per-test flag stays the single source of truth — this
    lint reads it from the tests rather than introducing a per-scenario
    marker.
    """
    invalid: set[str] = set()
    for f in tests_dir.rglob("*.json"):
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(raw, dict) and raw.get("intentionally_invalid") is True:
            scenario = (raw.get("input") or {}).get("scenario")
            if isinstance(scenario, str) and scenario:
                invalid.add(scenario)
    return invalid


INTENTIONALLY_INVALID_SCENARIOS = _intentionally_invalid_scenarios()


def _lintable_scenario_dirs() -> list[Path]:
    """Scenario dirs the validity lint runs over: every fixture except the
    ones a test deliberately broke (`intentionally_invalid`).

    Those four `mid-research-flynn-*` fixtures are invalid on purpose so the
    `validate-schema` skill tests (ut_validate_schema_004–007) can prove the
    skill *detects* each error class. Linting them as "must be valid" would be
    wrong, and parametrizing-then-skipping them only adds noise to the run —
    so they are excluded at collection time instead. The skill tests are what
    keep them honest: if one accidentally became valid, those tests fail
    (they assert the skill reports "validation FAILED"). The
    `intentionally_invalid` test flag remains the single source of truth for
    which scenarios are exempt; the fixture READMEs document the breakage.
    """
    return [
        p for p in _scenario_dirs()
        if p.name not in INTENTIONALLY_INVALID_SCENARIOS
    ]


@pytest.mark.parametrize("scenario", _lintable_scenario_dirs(), ids=lambda p: p.name)
def test_scenario_research_json_is_schema_valid(scenario: Path) -> None:
    path = scenario / "research.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_research_json(data)
    assert errors == [], (
        f"{path.relative_to(REPO_ROOT)} fails research.schema.json "
        "validation:\n  - " + "\n  - ".join(errors)
    )


@pytest.mark.parametrize("scenario", _lintable_scenario_dirs(), ids=lambda p: p.name)
def test_scenario_tree_gedcomx_json_is_schema_valid(scenario: Path) -> None:
    path = scenario / "tree.gedcomx.json"
    if not path.exists():
        pytest.skip(f"{scenario.name} has no tree.gedcomx.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_tree_gedcomx_json(data)
    assert errors == [], (
        f"{path.relative_to(REPO_ROOT)} fails tree.gedcomx schema "
        "validation:\n  - " + "\n  - ".join(errors)
    )


# README bullet label -> the `research.json` array whose length it claims.
# Only labels a README states as a leading count belong here; id-enumeration
# bullets ("GedcomX persons: I1 (…), I2 (…)") assert no count and are ignored.
# Singular spellings are aliases, not decoration: `Timeline`, `Proof summary`,
# `Hypothesis` and `Question` are all in live use in the corpus (8 bullets
# across 6 fixtures). None states a leading count *today*, so a plural-only map
# misses nothing yet — but the spec's promise is that any count a README states
# is pinned, and "- **Proof summary:** 2 summaries" would silently escape one.
README_COUNT_LABELS = {
    "Questions": "questions",
    "Question": "questions",
    "Plans": "plans",
    "Plan": "plans",
    "Log": "log",
    "Sources": "sources",
    "Source": "sources",
    "Assertions": "assertions",
    "Assertion": "assertions",
    "Person evidence": "person_evidence",
    "Conflicts": "conflicts",
    "Conflict": "conflicts",
    "Hypotheses": "hypotheses",
    "Hypothesis": "hypotheses",
    "Timelines": "timelines",
    "Timeline": "timelines",
    "Proof summaries": "proof_summaries",
    "Proof summary": "proof_summaries",
    "Evaluations": "evaluations",
    "Evaluation": "evaluations",
    "Localities": "localities",
    "Locality": "localities",
    "Known holdings": "known_holdings",
    "Known holding": "known_holdings",
}

# A count in these fixtures is a small array length. A leading 4-digit number is
# a year — `- **Sources:** 1850 census (FS), 1860 census` is a legal bullet that
# states no count, and reading 1850 as one would hard-fail CI with "README says
# 1850, research.json has 2". No corpus README has that shape today; this keeps
# the first one that does from looking like a drift failure.
MAX_PLAUSIBLE_COUNT = 1000

_BULLET_RE = re.compile(r"^- \*\*(?P<label>[^*]+):\*\*(?P<value>.*)$", re.MULTILINE)
_LEADING_INT_RE = re.compile(r"\s*(\d+)\b")


def _readme_count_claims(readme_text: str) -> list[tuple[str, str, int]]:
    """Every `- **<Label>:** <N> …` bullet, as (label, research_key, claimed).

    The **leading**-integer requirement is the whole design. A scan for the
    first number anywhere in the bullet reads `q_002 (1850 census placement,
    resolved)` as a claim of 1850 questions and `t_001 (Patrick, 4 events, 1
    gap)` as a claim of 4 timelines: measured against this corpus that form
    flags 18 scenarios, 16 of them spuriously. Anchoring on the leading
    integer flags 2, both genuine. A bullet that opens with prose asserts no
    count and is skipped — this lint pins counts that are *stated*, it does
    not require any to be stated.
    """
    claims: list[tuple[str, str, int]] = []
    for match in _BULLET_RE.finditer(readme_text):
        key = README_COUNT_LABELS.get(match.group("label").strip())
        if key is None:
            continue
        leading = _LEADING_INT_RE.match(match.group("value"))
        if leading is None:
            continue
        claimed = int(leading.group(1))
        if claimed >= MAX_PLAUSIBLE_COUNT:  # a year, not a count
            continue
        claims.append((match.group("label").strip(), key, claimed))
    return claims


@pytest.mark.parametrize("scenario", _scenario_dirs(), ids=lambda p: p.name)
def test_scenario_readme_counts_match_research_json(scenario: Path) -> None:
    readme = scenario / "README.md"
    if not readme.exists():
        pytest.skip(f"{scenario.name} has no README.md")
    data = json.loads((scenario / "research.json").read_text(encoding="utf-8"))
    mismatches = [
        f"{label}: README says {claimed}, research.json has "
        f"{len(data.get(key) or [])}"
        for label, key, claimed in _readme_count_claims(
            readme.read_text(encoding="utf-8")
        )
        if claimed != len(data.get(key) or [])
    ]
    assert mismatches == [], (
        f"{readme.relative_to(REPO_ROOT)} states counts its research.json "
        "contradicts. The judge reads this file verbatim, so correct the "
        "README (or the fixture) before the next eval run:\n  - "
        + "\n  - ".join(mismatches)
    )


def test_readme_count_claims_reads_only_leading_integers() -> None:
    claims = _readme_count_claims(
        "# scenario\n\n"
        "- **Sources:** 4 sources (1850 census, death cert)\n"
        "- **Questions:** q_001 (parentage), q_002 (1850 census placement)\n"
        "- **Timelines:** t_001 (Patrick, 4 events, 1 gap)\n"
        "- **Objective:** 3 generations of the Flynn line\n"
        "- **Log:** 12 entries\n"
        "- **Assertions:** 1850 census yielded most of these\n"
        "- **Proof summary:** 2 summaries\n"
    )
    # Sources and Log state a leading count. Questions and Timelines open with
    # prose, so their embedded numbers are not claims. Objective is not a
    # countable section at all. Assertions opens with a YEAR, which is not a
    # count. Proof summary is a singular alias and does state one.
    assert claims == [
        ("Sources", "sources", 4),
        ("Log", "log", 12),
        ("Proof summary", "proof_summaries", 2),
    ]


def test_intentionally_invalid_scenarios_reads_the_flag(tmp_path) -> None:
    tests_dir = tmp_path / "tests" / "some-skill"
    tests_dir.mkdir(parents=True)
    # A flagged test contributes its scenario; an unflagged one does not.
    (tests_dir / "flagged.json").write_text(
        json.dumps(
            {
                "input": {"scenario": "broken-on-purpose"},
                "intentionally_invalid": True,
            }
        ),
        encoding="utf-8",
    )
    (tests_dir / "normal.json").write_text(
        json.dumps({"input": {"scenario": "perfectly-fine"}}),
        encoding="utf-8",
    )
    result = _intentionally_invalid_scenarios(tmp_path / "tests")
    assert result == {"broken-on-purpose"}
