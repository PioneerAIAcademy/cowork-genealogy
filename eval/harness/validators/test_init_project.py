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
    if the other validates. Per issue #1510, every opening-turn question
    (objective, experience level, access) is non-blocking and defaults
    silently if unanswered, so a positive test always completes in one
    pass -- there is no longer a premature-write exception to gate."""
    if test.get("type") != "positive":
        pytest.skip("file-existence rules apply only to positive tests")
    if after_state.get("research_json") is None:
        assert False, "init-project did not create research.json"
    if after_state.get("tree_gedcomx_json") is None:
        assert False, "init-project did not create tree.gedcomx.json"


# --- Opening-turn defaults, checked exactly (tag-gated) -----------------

# Issue #1510: the objective's default is defined as a fixed, verbatim
# string, the same way a defaulted narration_guidance is verbatim rather
# than paraphrased. That makes it checkable in code instead of leaving
# "did the skill hallucinate a specific direction?" to judge interpretation.
_DEFAULT_OBJECTIVE = (
    "General research: build out the tree and identify gaps and next steps."
)


def test_objective_default_verbatim(after_state, test):
    """Tag-gated on `objective-default`: when the test's premise is that the
    user stated no objective, the stored `project.objective` must be this
    exact string -- not a paraphrase, and not a specific direction invented
    from person data. Runs whether or not the test also expects the profile
    fields to default (see `test_profile_defaults_when_all_default` below
    for that tag), since a test can default the objective alone."""
    if "objective-default" not in test.get("tags", []):
        pytest.skip("not an objective-default scenario")
    research = after_state.get("research_json")
    if research is None:
        assert False, "objective-default requires research.json to exist"
    objective = (research.get("project") or {}).get("objective")
    assert objective == _DEFAULT_OBJECTIVE, (
        f"objective should default to the verbatim generic text when unstated, "
        f"got: {objective!r}"
    )


def test_profile_defaults_when_all_default(after_state, test):
    """Tag-gated on `opening-turn-all-defaults`: when the test's premise is
    that the user answered none of the three opening-turn questions,
    `researcher_profile.experience_level` and `.subscriptions` must hold
    the documented defaults exactly -- `intermediate` and `["none"]` -- not
    be left absent (the pre-#1510 dead-edge-case behavior) and not hold
    anything else."""
    if "opening-turn-all-defaults" not in test.get("tags", []):
        pytest.skip("not an all-defaults scenario")
    research = after_state.get("research_json")
    if research is None:
        assert False, "opening-turn-all-defaults requires research.json to exist"
    profile = research.get("researcher_profile")
    assert profile is not None, (
        "researcher_profile is absent -- the opening turn always asks and always "
        "proceeds, so this section should always be written, even when every "
        "answer defaults"
    )
    assert profile.get("experience_level") == "intermediate", (
        f"experience_level should default to 'intermediate', got: "
        f"{profile.get('experience_level')!r}"
    )
    assert profile.get("subscriptions") == ["none"], (
        f"subscriptions should default to ['none'], got: "
        f"{profile.get('subscriptions')!r}"
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

    Scoped to positive tests that were supposed to produce files -- a
    negative test's calls belong to the routed-to skill.
    """
    if test.get("type") != "positive":
        pytest.skip("write-path rules apply only to positive tests")

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
