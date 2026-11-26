"""Every `execution.run_skills` entry in the unit-test corpus names a `Skill("<name>")`
call its skill's SKILL.md makes.

`compute_allowed_tools` raises at RUN time on one that does not, which aborts the test
inside a paid suite (#4791: ut_research_vr1 and vo1, after the router's wording named
the call without the `Skill("…")` literal). This catches it offline.
"""

from __future__ import annotations

import json
from pathlib import Path

from harness.allowed_tools import skill_refs_for_skill

REPO = Path(__file__).resolve().parents[4]
TESTS = REPO / "eval" / "tests" / "unit"
SKILLS = REPO / "packages" / "engine" / "plugin" / "skills"


def _declarations() -> list[tuple[str, str, str]]:
    out = []
    for path in sorted(TESTS.glob("*/*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        skill = (data.get("test") or {}).get("skill")
        for callee in (data.get("execution") or {}).get("run_skills") or []:
            out.append((path.relative_to(REPO).as_posix(), str(skill), str(callee)))
    return out


def test_the_corpus_declares_some_run_skills():
    assert _declarations(), "no test declares run_skills; this check would pass vacuously"


def test_every_run_skills_callee_is_a_skill_call_its_skill_makes():
    bad = [
        (path, skill, callee)
        for path, skill, callee in _declarations()
        if callee not in skill_refs_for_skill(SKILLS / skill / "SKILL.md")
    ]
    assert not bad, (
        "these tests declare run_skills that their skill's SKILL.md never invokes as "
        f'Skill("<name>"), so the harness aborts them at run time: {bad}'
    )
