"""Unit tests for the single-ask e2e grade (spec §16, issue #3527).

Synthetic run records only — no SDK, no network. Each failure test asserts the
printed line names the failing check, not just that the grade failed.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

from e2e.orchestrator import REPO_ROOT
from e2e.run_single_ask import (
    DEFAULT_SINGLE_ASK_FIXTURES,
    FixtureError,
    fixture_dirs,
    load_single_ask_fixture,
)
from e2e.single_ask_grade import SingleAskSpec, format_line, grade, spawned_units

SPEC = SingleAskSpec(
    id="review-sources",
    message="Review the sources attached to KNS4-P6W.",
    expected_owner="source-evaluation",
    expected_save={"section": "log", "tool": "source-evaluation"},
)
START = {"questions": [], "plans": [], "log": [{"id": "log_001", "tool": "old"}], "sources": []}


def skill(name, thread="main"):
    return {"tool": "Skill", "args": {"skill": name}, "thread": thread}


def agent(name, thread="main"):
    return {"tool": "Agent", "args": {"subagent_type": name}, "thread": thread}


def final(**extra):
    out = json.loads(json.dumps(START))
    for k, v in extra.items():
        out[k] = out[k] + v
    return out


SAVED = final(log=[{"id": "log_002", "tool": "source-evaluation"}])


def run(calls, final_research=SAVED, spec=SPEC, aborted=None):
    g = grade(
        tool_calls=calls, spec=spec, starting_research=START,
        final_research=final_research, aborted_reason=aborted,
    )
    return g, format_line(spec, g)


def test_router_first_then_owner_with_save_passes():
    g, line = run([skill("research"), agent("source-evaluation")])
    assert g.passed
    assert line.startswith("PASS review-sources")
    assert "first=source-evaluation" in line and "failed=" not in line
    assert "stop=clean" in line


def test_wrong_owner_fails_naming_owner():
    g, line = run([skill("research"), agent("check-warnings")])
    assert not g.passed
    assert "failed=[owner]" in line
    assert "first=check-warnings" in line


def test_owner_right_but_no_save_fails_naming_save():
    g, line = run([agent("source-evaluation")], final_research=final())
    assert "failed=[save]" in line
    assert "missing log tool=source-evaluation" in line


def test_log_entry_with_another_tool_is_not_the_save():
    g, line = run(
        [agent("source-evaluation")],
        final_research=final(log=[{"id": "log_002", "tool": "check-warnings"}]),
    )
    assert "failed=[save]" in line
    assert "check-warnings" in line


def test_a_pre_existing_log_entry_does_not_count_as_new():
    start_has_it = {**START, "log": START["log"] + [{"id": "log_002", "tool": "source-evaluation"}]}
    g = grade(
        tool_calls=[agent("source-evaluation")], spec=SPEC,
        starting_research=start_has_it, final_research=SAVED,
    )
    assert g.failed == ["save"]


def test_question_selection_spawn_fails_no_research_job():
    g, line = run([agent("source-evaluation"), skill("question-selection")])
    assert "failed=[no_research_job]" in line
    assert "research job: question-selection" in line


def test_nested_question_selection_still_counts_as_a_research_job():
    g, line = run([agent("source-evaluation"), agent("question-selection", thread="sub")])
    assert "failed=[no_research_job]" in line


def test_new_question_entry_with_no_spawn_fails_no_research_job():
    g, line = run(
        [agent("source-evaluation")],
        final_research=final(
            log=[{"id": "log_002", "tool": "source-evaluation"}], questions=[{"id": "q_001"}]
        ),
    )
    assert "failed=[no_research_job]" in line
    assert "new questions entry" in line


def test_research_plan_is_allowed_only_on_a_plan_ask():
    calls = [agent("source-evaluation"), agent("research-plan")]
    plans = final(log=[{"id": "log_002", "tool": "source-evaluation"}], plans=[{"id": "p_001"}])
    _, line = run(calls, final_research=plans)
    assert "failed=[no_research_job]" in line
    plan_spec = SingleAskSpec(**{**SPEC.__dict__, "is_plan_ask": True})
    g, _ = run(calls, final_research=plans, spec=plan_spec)
    assert g.passed


def test_nested_spawn_of_the_owner_is_not_the_owner():
    g, line = run([skill("research"), agent("tree-survey"), agent("source-evaluation", thread="sub")])
    assert "failed=[owner]" in line
    assert "first=tree-survey" in line
    assert "(source-evaluation)" in line


def test_only_a_nested_owner_means_no_main_thread_unit():
    g, line = run([agent("source-evaluation", thread="sub")])
    assert g.first_unit is None
    assert "first=none" in line and "failed=[owner]" in line


def test_thread_wins_over_a_missing_agent_id():
    # An entry whose result never arrived has no `agent_id`; `thread` still says sub.
    units = spawned_units([{"tool": "Agent", "args": {"subagent_type": "x"}, "thread": "sub"}])
    assert units == [{"unit": "x", "main_thread": False}]


def test_agent_id_is_the_fallback_for_records_without_thread():
    units = spawned_units([
        {"tool": "Agent", "args": {"subagent_type": "a"}, "agent_id": None},
        {"tool": "Agent", "args": {"subagent_type": "b"}, "agent_id": "abc"},
    ])
    assert [u["main_thread"] for u in units] == [True, False]


def test_setup_units_are_skipped():
    spec = SingleAskSpec(**{**SPEC.__dict__, "setup_units": ("init-project",)})
    g, _ = run([skill("research"), agent("init-project"), agent("source-evaluation")], spec=spec)
    assert g.first_unit == "source-evaluation" and g.passed


def test_plugin_namespace_prefix_is_normalised():
    g, _ = run([agent("genealogy-research:source-evaluation")])
    assert g.first_unit == "source-evaluation"


def test_two_failures_are_both_named():
    _, line = run([agent("check-warnings")], final_research=final())
    assert "failed=[owner,save]" in line


def test_an_aborted_turn_names_its_abort():
    _, line = run([], final_research=final(), aborted="max_wall_clock_seconds")
    assert "stop=max_wall_clock_seconds" in line


def test_missing_research_json_fails_save_and_no_research_job():
    g, line = run([agent("source-evaluation")], final_research=None)
    assert g.failed == ["no_research_job", "save"]
    assert "no research.json" in line


def test_delivered_and_extraction_count_are_reported_not_graded():
    calls = [
        agent("source-evaluation"),
        {"tool": "mcp__genealogy__extraction_append", "args": {}, "thread": "sub"},
        {"tool": "mcp__genealogy__research_delivered", "args": {}, "thread": "main"},
    ]
    g, line = run(calls)
    assert g.passed and g.delivered and g.extraction_appends == 1
    assert "delivered=yes" in line and "extraction_append=1" in line
    g, line = run(calls[:2])
    assert g.passed and "delivered=no" in line


# --- fixture loading --------------------------------------------------------

def test_every_committed_fixture_loads():
    dirs = fixture_dirs(DEFAULT_SINGLE_ASK_FIXTURES, None)
    assert dirs, "the panel has no fixtures"
    for d in dirs:
        fixture, spec = load_single_ask_fixture(d)
        assert fixture.researcher_question == spec.message
        assert fixture.id == d.name


def _write(tmp_path: Path, **over) -> Path:
    src = DEFAULT_SINGLE_ASK_FIXTURES / "review-sources-kenneth-quass"
    raw = json.loads((src / "fixture.json").read_text(encoding="utf-8"))
    raw.update(over)
    d = tmp_path / "f"
    d.mkdir()
    (d / "fixture.json").write_text(json.dumps(raw), encoding="utf-8")
    for name in ("starting-research.json", "starting-tree.gedcomx.json"):
        (d / name).write_text((src / name).read_text(encoding="utf-8"), encoding="utf-8")
    return d


@pytest.mark.parametrize(
    "over",
    [
        {"expected_save": {"section": "assertions"}},
        {"expected_save": {"section": "log"}},
        {"expected_save": "log"},
        {"expected_owner": ""},
    ],
)
def test_bad_fixture_is_refused(tmp_path, over):
    with pytest.raises(FixtureError):
        load_single_ask_fixture(_write(tmp_path, **over))


def test_sources_save_needs_no_tool(tmp_path):
    _, spec = load_single_ask_fixture(_write(tmp_path, expected_save={"section": "sources"}))
    assert spec.expected_save == {"section": "sources"}


# --- the orchestrator's stop hook -----------------------------------------

def test_stop_hook_returns_allow_first_in_single_ask_mode():
    """The closure cannot run without the SDK, so read its first statement."""
    src = (REPO_ROOT / "eval/harness/e2e/orchestrator.py").read_text(encoding="utf-8")
    hook = next(
        n for n in ast.walk(ast.parse(src))
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "stop_hook"
    )
    first = hook.body[0]
    assert isinstance(first, ast.If)
    assert isinstance(first.test, ast.Name) and first.test.id == "single_ask"
    ret = first.body[0]
    assert isinstance(ret, ast.Return) and isinstance(ret.value, ast.Dict)
    assert ret.value.keys == []
