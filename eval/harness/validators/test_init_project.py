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
    if the other validates.

    Exception: tests tagged `no-premature-write` verify the opposite --
    that init-project correctly blocks and asks (e.g. a bare PID with no
    stated objective, per issue #1320) instead of writing files before it
    has what it needs. For those, no files existing is the correct,
    passing outcome, not a structural failure."""
    if test.get("type") != "positive":
        pytest.skip("file-existence rules apply only to positive tests")
    if "no-premature-write" in test.get("tags", []):
        pytest.skip("no-premature-write test: correct behavior is to write nothing yet")
    if after_state.get("research_json") is None:
        assert False, "init-project did not create research.json"
    if after_state.get("tree_gedcomx_json") is None:
        assert False, "init-project did not create tree.gedcomx.json"


# --- No premature write (tag-gated) -------------------------------------

def test_no_premature_write(after_state, test):
    """Tag-gated, paired with the no-premature-write skip above: tests
    tagged `no-premature-write` must positively assert neither project
    file exists. Skipping the file-existence check without asserting its
    opposite leaves nothing to catch a run that writes anyway — this is
    the invariant `ut_init_project_010` actually leans on."""
    if "no-premature-write" not in test.get("tags", []):
        pytest.skip("not a no-premature-write scenario")
    assert after_state.get("research_json") is None, (
        "init-project wrote research.json before the objective was captured"
    )
    assert after_state.get("tree_gedcomx_json") is None, (
        "init-project wrote tree.gedcomx.json before the objective was captured"
    )


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


# --- The write PATH, not just the resulting state ----------------------

def test_project_files_written_through_the_writer_tools(tool_calls, after_state, test):
    """init-project must create the project by CALLING `project_create`.

    One assertion, on one tool, because `project_create` writes BOTH documents
    in a single validated call — there is no second write to check and no order
    to get right. An earlier version of this validator required a
    `research_append` with `section: "project"`, which encoded a design that was
    abandoned before it shipped: it failed 8 of 11 tests on a skill that was
    behaving correctly, and because a failed validator skips the judge, it also
    threw away the grades. A check that encodes a stale design is worse than no
    check, because its red looks like the skill's fault.

    Every check above reads the after-state, and the after-state cannot see
    this. The unit harness grants `Write` and `Edit` to every skill from a fixed
    baseline independent of frontmatter, and its PreToolUse hook carries no
    protected-file rule — so a run in which the model ignores the rewritten body
    and hand-serializes research.json produces a byte-identical after-state and
    an identical grade. A check on the output alone therefore cannot fail for
    the reason it exists, which is exactly the unfalsifiable shape this repo has
    a standing rule against.

    What it is guarding is not hypothetical. In Cowork the raw-write lockdown
    denies those writes, so `init-project` could not create a project at all and
    the agent routed around the guard through the device bridge — and the write
    landed. The e2e corpus cannot see it either: every fixture starts from an
    existing project.

    Scoped to positive tests that were supposed to produce files. A
    `no-premature-write` test correctly writes nothing, and a negative test's
    calls belong to the routed-to skill.
    """
    if test.get("type") != "positive":
        pytest.skip("write-path rules apply only to positive tests")
    if "no-premature-write" in test.get("tags", []):
        pytest.skip("no-premature-write test: correct behavior is to write nothing yet")

    called = {(call.get("tool") or "").rsplit("__", 1)[-1] for call in tool_calls or []}

    assert "project_create" in called, (
        "init-project never called project_create — both project files reached "
        "disk some other way, and in Cowork that route is the one the write "
        f"lockdown denies. Tools called: {sorted(called) or 'none'}"
    )

    # `project_create` deliberately writes no `researcher_profile` — the seed
    # must never invent one. So a profile in the output can only have arrived
    # through `research_append`, or through a raw write the lockdown denies in
    # production but the harness permits. Conditional on the profile existing,
    # because a run where the researcher volunteered nothing legitimately makes
    # exactly one call.
    if (after_state.get("research_json") or {}).get("researcher_profile"):
        assert "research_append" in called, (
            "research.json ends with a researcher_profile but research_append was "
            "never called — project_create does not write one, so it arrived by a "
            f"route the lockdown denies. Tools called: {sorted(called) or 'none'}"
        )
