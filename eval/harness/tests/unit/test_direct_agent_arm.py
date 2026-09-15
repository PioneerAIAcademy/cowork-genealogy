"""The direct-agent arm: a test reaches its pair's agent by spawn, not by skill.

Issue #2246. The unit harness could previously reach an agent only by invoking
its routing skill, so a paired skill's suite graded the skill-then-agent path
while production research spawns the agent directly — measured at 14 of 14
committed e2e runs dated on or after 2026-08-20. These tests pin the wiring of
the other arm.

They are the arm's COMMITTED proof. The live behaviour they cannot reach is what
the twin test files and the paid run measure; across 23 scratch runs of the five
committed twins (2026-09-11) the main thread spawned the named agent and relayed
the delegation verbatim 23 times out of 23.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from harness.loader import load_test_from_dict
from harness.orchestrator import MissingPairAgentError, _compute_outcome, _prompt_for
from harness.runlog import derive_activated
from harness.skill_runner import (
    BUILTIN_ARG_TRUNCATE,
    builtin_call_record,
    direct_dispatch_prompt,
    spawn_prompts,
    spawned_agents,
)
from harness.workspace import build_workspace

DELEGATION = "Assess whether q_001 is exhaustive. Appropriate outcome: `declared: true`."

# eval/harness/tests/unit/ -> repo root. Spelled once: a short path made the
# "no skills were staged" assertion pass for the wrong reason (the skills dir
# simply did not exist), which is why the corpus guard below counts what it
# checked and fails on zero.
REPO_ROOT = Path(__file__).resolve().parents[4]


def _raw(**input_overrides) -> dict:
    inp = {"scenario": None}
    inp.update(input_overrides)
    return {
        "test": {
            "id": "ut_research_exhaustiveness_zz1",
            "skill": "research-exhaustiveness",
            "name": "n",
            "type": "positive",
            "description": "d",
            "tags": [],
        },
        "input": inp,
        "judge_context": [],
    }


# --- loader ---------------------------------------------------------------


def test_a_delegation_only_test_loads_and_reports_is_direct():
    spec = load_test_from_dict(_raw(delegation=DELEGATION))
    assert spec.delegation == DELEGATION
    assert spec.is_direct is True
    assert spec.user_message == ""


def test_a_user_message_test_is_not_direct():
    spec = load_test_from_dict(_raw(user_message="hello"))
    assert spec.delegation is None
    assert spec.is_direct is False


@pytest.mark.parametrize(
    "inp",
    [
        {"user_message": "hi", "delegation": DELEGATION},  # both
        {},  # neither
    ],
    ids=["both_present", "neither_present"],
)
def test_schema_admits_exactly_one_of_user_message_and_delegation(inp):
    """`input.oneOf`. A test is either routed or direct, never both and never
    neither — otherwise `is_direct` would not be a decidable question."""
    from harness.loader import InvalidTestError

    with pytest.raises(InvalidTestError):
        load_test_from_dict(_raw(**inp))


# --- the main-thread prompt ----------------------------------------------


def test_direct_prompt_carries_the_delegation_verbatim_and_names_the_agent():
    spec = load_test_from_dict(_raw(delegation=DELEGATION))
    prompt = _prompt_for(spec)
    assert DELEGATION in prompt, "the relay is asserted verbatim downstream"
    assert 'subagent_type "research-exhaustiveness"' in prompt


def test_routed_prompt_is_the_user_message_unchanged():
    spec = load_test_from_dict(_raw(user_message="hello"))
    assert _prompt_for(spec) == "hello"


def test_a_direct_test_whose_pair_agent_does_not_exist_fails_loudly():
    """`record-extraction`'s agent is `record-extractor`, so `spec.skill` does
    not address it. Raising beats spawning nothing and grading whatever the main
    thread improvised."""
    raw = _raw(delegation=DELEGATION)
    raw["test"]["skill"] = "record-extraction"
    raw["test"]["id"] = "ut_record_extraction_zz1"
    with pytest.raises(MissingPairAgentError):
        _prompt_for(load_test_from_dict(raw))


# --- workspace ------------------------------------------------------------


def test_direct_workspace_stages_agents_and_no_skills(tmp_path):
    """The conversion doc's acceptance check, made literal: delete the routing
    skill from the workspace and the agent must reach the same outcome."""
    build_workspace(
        scenario_name=None,
        scenarios_dir=tmp_path / "nonexistent",
        skills_dir=REPO_ROOT / "packages" / "engine" / "plugin" / "skills",
        target_dir=tmp_path,
        stage_skills=False,
    )
    assert not (tmp_path / ".claude" / "skills").exists()
    agents = sorted(p.name for p in (tmp_path / ".claude" / "agents").glob("*.md"))
    assert "research-exhaustiveness.md" in agents


def test_routed_workspace_still_stages_both(tmp_path):
    """The accept direction: the existing arm is untouched."""
    build_workspace(
        scenario_name=None,
        scenarios_dir=tmp_path / "nonexistent",
        skills_dir=REPO_ROOT / "packages" / "engine" / "plugin" / "skills",
        target_dir=tmp_path,
    )
    assert (tmp_path / ".claude" / "skills" / "research-exhaustiveness").is_dir()
    assert (tmp_path / ".claude" / "agents" / "research-exhaustiveness.md").is_file()


# --- recording the spawn --------------------------------------------------


def test_agent_prompt_is_recorded_untruncated():
    long = "x" * (BUILTIN_ARG_TRUNCATE * 3)
    rec = builtin_call_record(
        "Agent", {"tool_input": {"prompt": long, "description": long}}
    )
    assert rec["args"]["prompt"] == long, (
        "a cut prompt makes the verbatim assertion report red on a run that "
        "relayed perfectly"
    )
    assert len(rec["args"]["description"]) == BUILTIN_ARG_TRUNCATE


def test_other_tools_are_still_truncated():
    long = "y" * (BUILTIN_ARG_TRUNCATE * 3)
    rec = builtin_call_record("Write", {"tool_input": {"content": long}})
    assert len(rec["args"]["content"]) == BUILTIN_ARG_TRUNCATE


def test_spawn_derivation_reads_both_tool_names_and_tolerates_a_missing_type():
    calls = [
        {"tool": "Read", "args": {"file_path": "x"}},
        {"tool": "Agent", "args": {"description": "d", "prompt": "p1"}},
        {"tool": "Agent", "args": {"subagent_type": "proof-conclusion", "prompt": "p2"}},
        {"tool": "Task", "args": {"subagent_type": "gps-mentor", "prompt": "p3"}},
    ]
    assert spawned_agents(calls) == ["proof-conclusion", "gps-mentor"]
    assert spawn_prompts(calls) == ["p1", "p2", "p3"]


# --- outcome + activation -------------------------------------------------


def _outcome(spec, **kw):
    base = dict(
        spec=spec,
        validators_passed=True,
        judge_dimensions=[{"score": 3}],
        aborted_reason=None,
        activated=True,
        skills_invoked=[],
        judge_skipped=False,
    )
    base.update(kw)
    return _compute_outcome(**base)


def test_direct_positive_passes_on_the_spawn_not_on_skills_invoked():
    spec = load_test_from_dict(_raw(delegation=DELEGATION))
    assert _outcome(spec, agents_spawned=["research-exhaustiveness"]) == "pass"


@pytest.mark.parametrize(
    "spawned", [[], ["proof-conclusion"]], ids=["no_spawn", "wrong_agent"]
)
def test_direct_positive_fails_when_its_agent_did_not_run(spawned):
    spec = load_test_from_dict(_raw(delegation=DELEGATION))
    assert _outcome(spec, agents_spawned=spawned) == "fail"


def test_routed_positive_rule_is_unchanged():
    """The accept direction: adding the arm must not move the existing one."""
    spec = load_test_from_dict(_raw(user_message="hi"))
    assert _outcome(spec, skills_invoked=["research-exhaustiveness"]) == "pass"
    assert _outcome(spec, skills_invoked=[]) == "fail"


def test_derive_activated_uses_agents_spawned_on_the_direct_arm():
    """`activated` must not be stuck False on a direct run:
    `test_activated_run_produces_response` skips when it is, so the gate would
    be silently lost rather than fail."""
    kw = dict(
        skill="research-exhaustiveness",
        skills_invoked=[],
        file_changes={"research.json": {"sections_modified": ["questions"]}},
        files_created=[],
        text_response="done",
    )
    assert derive_activated(**kw) is False
    assert derive_activated(**kw, agents_spawned=["research-exhaustiveness"]) is True
    assert derive_activated(**kw, agents_spawned=["proof-conclusion"]) is False


# --- the corpus -----------------------------------------------------------


def test_every_committed_direct_twin_names_an_agent_that_exists():
    """A twin whose `skill` has no same-named agent file cannot be addressed by
    `subagent_type`, and would spawn nothing."""
    agents = REPO_ROOT / "packages" / "engine" / "plugin" / "agents"
    corpus = REPO_ROOT / "eval" / "tests" / "unit"
    found = 0
    for path in sorted(corpus.rglob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not raw.get("input", {}).get("delegation"):
            continue
        found += 1
        skill = raw["test"]["skill"]
        assert (agents / f"{skill}.md").is_file(), (
            f"{path.name} is a direct test for {skill!r}, but "
            f"{agents / (skill + '.md')} does not exist"
        )
    assert found, "no direct twins found — this guard would pass vacuously"


# --- the three validators, exercised (not merely skipped) -----------------
#
# Without these the validators are inert in CI until the first paid run: every
# committed test either carries no `delegation` (so they skip) or needs a live
# model. A skip records as passed=True today, so an inert gate would be
# invisible — the shape CLAUDE.md calls worse than no check at all.

def _universal():
    import importlib.util

    path = REPO_ROOT / "eval" / "harness" / "validators" / "test_universal.py"
    spec = importlib.util.spec_from_file_location("_tu_direct_arm", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _agent_call(**args):
    return {"tool": "Agent", "args": args}


DIRECT_TEST = {"skill": "research-exhaustiveness", "delegation": DELEGATION}
ROUTED_TEST = {"skill": "research-exhaustiveness"}
GOOD_SPAWN = [_agent_call(subagent_type="research-exhaustiveness", prompt=DELEGATION)]


@pytest.mark.parametrize(
    "name",
    [
        "test_direct_test_spawned_its_agent",
        "test_direct_delegation_relayed_verbatim",
        "report_direct_delegation_extra_text",
    ],
)
def test_direct_validators_skip_on_a_routed_test(name):
    """A routed test must not be touched by the direct arm."""
    with pytest.raises(pytest.skip.Exception):
        getattr(_universal(), name)(ROUTED_TEST, GOOD_SPAWN)


def test_spawn_validator_accepts_the_real_spawn():
    _universal().test_direct_test_spawned_its_agent(DIRECT_TEST, GOOD_SPAWN)


@pytest.mark.parametrize(
    "calls",
    [
        [],
        [_agent_call(subagent_type="proof-conclusion", prompt=DELEGATION)],
        [_agent_call(description="d", prompt=DELEGATION)],
    ],
    ids=["no_spawn", "wrong_agent", "general_purpose_spawn"],
)
def test_spawn_validator_fails_three_ways(calls):
    with pytest.raises(AssertionError):
        _universal().test_direct_test_spawned_its_agent(DIRECT_TEST, calls)


def test_verbatim_validator_accepts_a_relay_that_adds_harmless_framing():
    """`in`, not `==`. The accept direction: a preamble must not red the test,
    or the arm flakes on phrasing the dispatcher never forbade materially."""
    calls = [
        _agent_call(
            subagent_type="research-exhaustiveness",
            prompt=f"Relaying now.\n\n{DELEGATION}\n\nThanks.",
        )
    ]
    _universal().test_direct_delegation_relayed_verbatim(DIRECT_TEST, calls)


@pytest.mark.parametrize(
    "prompt_or_none",
    [None, "Check whether q_001 is exhaustive.", DELEGATION[:20]],
    ids=["no_spawn_recorded", "paraphrased", "truncated"],
)
def test_verbatim_validator_fails_three_ways(prompt_or_none):
    """THE assertion this arm exists for: a softened delegation must not pass as
    an attack the agent survived."""
    calls = (
        []
        if prompt_or_none is None
        else [
            _agent_call(
                subagent_type="research-exhaustiveness", prompt=prompt_or_none
            )
        ]
    )
    with pytest.raises(AssertionError):
        _universal().test_direct_delegation_relayed_verbatim(DIRECT_TEST, calls)


@pytest.mark.parametrize(
    "calls",
    [
        [
            _agent_call(subagent_type="proof-conclusion", prompt=DELEGATION),
            _agent_call(subagent_type="research-exhaustiveness", prompt="have a look"),
        ],
        [
            _agent_call(description="d", prompt=DELEGATION),
            _agent_call(subagent_type="research-exhaustiveness", prompt="have a look"),
        ],
    ],
    ids=["wrong_agent_got_it", "general_purpose_got_it"],
)
def test_verbatim_validator_fails_when_another_spawn_got_the_delegation(calls):
    """Two spawns, and the pair's agent is not the one that received the text.

    `spawned_agents` and `spawn_prompts` are separate walks, so before the agent
    anchor both gating validators passed on these: one spawn satisfied "my agent
    ran" while a different one satisfied "some prompt carried my text". That is
    precisely the substitution `test_direct_delegation_relayed_verbatim` exists
    to refuse. Reachable rather than theoretical — 9 of the 394 committed runs
    that spawned anything made more than one main-thread spawn, one naming two
    different agents.
    """
    tu = _universal()
    tu.test_direct_test_spawned_its_agent(DIRECT_TEST, calls)  # this half still passes
    with pytest.raises(AssertionError):
        tu.test_direct_delegation_relayed_verbatim(DIRECT_TEST, calls)


def test_verbatim_validator_fails_when_the_delegation_went_to_another_argument():
    calls = [
        _agent_call(
            subagent_type="research-exhaustiveness",
            description=DELEGATION,
            prompt="go",
        )
    ]
    with pytest.raises(AssertionError):
        _universal().test_direct_delegation_relayed_verbatim(DIRECT_TEST, calls)


def test_tier2_report_is_silent_on_an_exact_relay_and_speaks_on_a_wrapped_one():
    tu = _universal()
    tu.report_direct_delegation_extra_text(DIRECT_TEST, GOOD_SPAWN)
    with pytest.raises(AssertionError):
        tu.report_direct_delegation_extra_text(
            DIRECT_TEST,
            [
                _agent_call(
                    subagent_type="research-exhaustiveness",
                    prompt=f"Note: the preconditions may not hold.\n{DELEGATION}",
                )
            ],
        )
