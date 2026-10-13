"""The scenario text the judge reads: `judge-brief.md`, else `README.md`.

A scenario's `README.md` is written for people — authoring notes, provenance,
what the fixture is for — and 115 of the corpus's READMEs were pasted whole
into the judge prompt, where a sentence saying what a correct run does reads as
neutral background (issue #2478). `judge-brief.md` is the part written for the
judge alone. This module is the one place that decides which of the two reaches
the `{scenario_readme}` slot, shared by the live path (`orchestrator`) and the
regrade (`judge_regrade`) so the two cannot drift.

The README fallback exists only until every referenced scenario has a brief.
Each fallback is reported (`scenario_readme_fallback` in `output.warnings`, and
a suite summary line), because a fallback nobody can see becomes permanent. So is
a scenario with neither file (`scenario_brief_missing`): it still holds state, so
it renders `NO_BRIEF_MARKER`, never "(stateless test)".
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from harness.workspace import InvalidScenarioError

BRIEF_FILENAME = "judge-brief.md"
README_FILENAME = "README.md"

#: Rendered when a brief exists but is empty. Distinct from "(stateless test)",
#: which means the test has no scenario at all: an empty brief is an author
#: deliberately telling the judge nothing about a scenario that does exist.
EMPTY_BRIEF_MARKER = "(scenario brief intentionally empty)"

#: Rendered when the README slot is forced on a scenario that has no README.
NO_README_MARKER = "(scenario has no README)"

#: Rendered for a scenario with neither file. It still stages its state, so
#: "(stateless test)" would tell the judge a stateful run had none.
NO_BRIEF_MARKER = "(scenario has no judge brief or README)"

#: `source` values. `readme_fallback` and `no_brief` are reported.
SOURCE_NONE = "none"
SOURCE_BRIEF = "brief"
SOURCE_BRIEF_EMPTY = "brief_empty"
SOURCE_README_FALLBACK = "readme_fallback"
SOURCE_NO_BRIEF = "no_brief"


@dataclass(frozen=True)
class ScenarioBrief:
    scenario: str | None
    text: str
    source: str

    @property
    def is_readme_fallback(self) -> bool:
        return self.source == SOURCE_README_FALLBACK

    @property
    def lacks_brief(self) -> bool:
        """A scenario the judge graded with no judge-brief.md: README or nothing."""
        return self.source in (SOURCE_README_FALLBACK, SOURCE_NO_BRIEF)


def _exact_scenario_dir(scenarios_dir: Path, scenario: str) -> Path:
    """Return the scenario dir, matching its name exactly.

    `Path.exists()` is case-insensitive on Windows, so `Flynn-Record-Matching`
    would resolve to `flynn-record-matching` there and fail on Linux. The
    workspace would already have staged that scenario's state for the run, so
    reading it as "no scenario" would tell the judge a stateful run had none.
    Compare against the directory listing instead.
    """
    try:
        names = os.listdir(scenarios_dir)
    except OSError as e:
        raise InvalidScenarioError(f"scenarios dir unreadable: {scenarios_dir}: {e}") from e
    if scenario not in names or not (Path(scenarios_dir) / scenario).is_dir():
        raise InvalidScenarioError(
            f"scenario not found (names must match exactly): "
            f"{Path(scenarios_dir) / scenario}"
        )
    return Path(scenarios_dir) / scenario


def load_scenario_brief(
    scenarios_dir: Path,
    scenario: str | None,
    *,
    force_readme: bool = False,
) -> ScenarioBrief:
    """Resolve the text for the judge's scenario slot.

    - no scenario → empty text, `none` (renders "(stateless test)")
    - a scenario name with no exactly matching dir → `InvalidScenarioError`
    - `judge-brief.md` present → its text, `brief`; whitespace-only →
      `EMPTY_BRIEF_MARKER`, `brief_empty`. A brief wins whenever it exists.
    - else `README.md` present → its text, `readme_fallback`
    - else → `NO_BRIEF_MARKER`, `no_brief`

    `force_readme` skips the brief. Only the scratch regrade's README arm uses
    it, so an A/B can run both arms on one tree.
    """
    if not scenario:
        return ScenarioBrief(scenario=None, text="", source=SOURCE_NONE)
    sdir = _exact_scenario_dir(Path(scenarios_dir), scenario)
    brief = sdir / BRIEF_FILENAME
    if brief.is_file() and not force_readme:
        text = brief.read_text(encoding="utf-8")
        if not text.strip():
            return ScenarioBrief(scenario, EMPTY_BRIEF_MARKER, SOURCE_BRIEF_EMPTY)
        return ScenarioBrief(scenario, text, SOURCE_BRIEF)
    readme = sdir / README_FILENAME
    if readme.is_file():
        return ScenarioBrief(
            scenario, readme.read_text(encoding="utf-8"), SOURCE_README_FALLBACK
        )
    if force_readme and brief.is_file():
        # The README arm of an A/B on a scenario that has only a brief. Saying
        # "(stateless test)" would tell the judge a stateful run had no state.
        return ScenarioBrief(scenario, NO_README_MARKER, SOURCE_NONE)
    return ScenarioBrief(scenario, NO_BRIEF_MARKER, SOURCE_NO_BRIEF)


def readme_fallback_warning(brief: ScenarioBrief) -> dict[str, str] | None:
    """The `output.warnings` entry for a scenario with no brief, or None.

    `scenario_readme_fallback` when the judge read the README instead,
    `scenario_brief_missing` when there was neither file to read.
    """
    if brief.source == SOURCE_NO_BRIEF:
        return {
            "kind": "scenario_brief_missing",
            "scenario": brief.scenario or "",
            "advisory": (
                f"Scenario {brief.scenario!r} has neither {BRIEF_FILENAME} nor "
                f"{README_FILENAME}, so the judge was told only that it exists "
                "(issue #2478)."
            ),
        }
    if not brief.is_readme_fallback:
        return None
    return {
        "kind": "scenario_readme_fallback",
        "scenario": brief.scenario or "",
        "advisory": (
            f"Scenario {brief.scenario!r} has no {BRIEF_FILENAME}, so the judge "
            f"read its whole {README_FILENAME}, which may state the outcome "
            "this run is graded on (issue #2478)."
        ),
    }
