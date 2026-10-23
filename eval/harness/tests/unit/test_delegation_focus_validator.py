"""`test_delegation_names_focus_and_target` — the gps-mentor delegation names its
focus and target_id, in any letter case.

Each direction is proven: the capitalised spawn that failed ut_research_so2 now
passes, and a spawn missing either field still fails.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from test_research import test_delegation_names_focus_and_target as validator  # noqa: E402

TAGGED = {"tags": ["routing", "routes-to:gps-mentor", "asserts-delegation-focus"]}


def _spawn(prompt: str) -> list[dict]:
    return [{"tool": None, "args": {"subagent_type": "gps-mentor", "prompt": prompt}}]


@pytest.mark.parametrize(
    "prompt",
    [
        "Review the project. focus: on-demand target_id: project",
        # The spawn ut_research_so2 recorded, verbatim, which the case-sensitive
        # match failed.
        "Please give a second-opinion review of this genealogy research project before "
        "the researcher shares it with their family. Focus: on-demand. Target_id: project. ",
        "FOCUS: proof-critique\nTARGET_ID: ps_001",
    ],
)
def test_a_delegation_naming_both_fields_passes_in_any_case(prompt):
    validator(TAGGED, _spawn(prompt))


@pytest.mark.parametrize(
    "prompt",
    [
        "Please review the project before the researcher shares it.",
        "Focus: on-demand. Review the whole project.",
        "Target_id: project. Give a second opinion.",
    ],
)
def test_a_delegation_missing_either_field_still_fails(prompt):
    with pytest.raises(AssertionError, match="omits"):
        validator(TAGGED, _spawn(prompt))
