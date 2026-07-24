"""Skill-specific validators for the init-project skill.

init-project creates the two project files (research.json and
tree.gedcomx.json) from scratch. Schema validation for both files is
handled by `test_universal.py::test_research_json_validates_schema` and
`test_universal.py::test_tree_gedcomx_json_validates_schema`. This file
covers init-project-specific structural rules — both files exist after
the run, research.json sections are empty arrays at init time (tag-gated
for tests that explicitly require it), and the stub person is created.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import pytest


# --- Both files exist after init ---------------------------------------

def test_both_project_files_created(before_state, after_state, test):
    """init-project positive tests must produce BOTH research.json and
    tree.gedcomx.json. Either file missing is a structural failure even
    if the other validates."""
    if test.get("type") != "positive":
        pytest.skip("file-existence rules apply only to positive tests")
    if after_state.get("research_json") is None:
        assert False, "init-project did not create research.json"
    if after_state.get("tree_gedcomx_json") is None:
        assert False, "init-project did not create tree.gedcomx.json"


# --- Empty-section enforcement at init time (tag-gated) ----------------

# Per init-project's bootstrap rule, research.json at creation has empty
# arrays for every section except project. Tests that explicitly require
# this rule add the `init-empty-sections` tag.

_INIT_EMPTY_SECTIONS = (
    "questions", "plans", "log", "sources", "assertions",
    "person_evidence", "conflicts", "hypotheses", "timelines",
    "proof_summaries",
)


def test_init_empty_sections(after_state, test):
    """Tag-gated: at init time, every research.json array section must be
    empty. The init-project workflow surveys known information but does
    not formulate questions or plans — those are downstream skills."""
    if "init-empty-sections" not in test.get("tags", []):
        pytest.skip("not an init-empty-sections scenario")
    research = after_state.get("research_json")
    if research is None:
        assert False, "init-empty-sections requires research.json to exist"
    non_empty = []
    for section in _INIT_EMPTY_SECTIONS:
        value = research.get(section, [])
        if value:
            non_empty.append(f"{section} ({len(value)} entries)")
    assert not non_empty, (
        f"research.json sections not empty at init: {non_empty}. "
        f"init-project should leave questions/plans/log/sources/assertions/"
        f"person_evidence/conflicts/hypotheses/timelines/proof_summaries "
        f"as empty arrays."
    )
