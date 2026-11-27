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
        out[k] = out.get(k, []) + v
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


def test_plugin_namespace_prefix_is_normalized():
    g, _ = run([agent("genealogy-research:source-evaluation")])
    assert g.first_unit == "source-evaluation"


def test_two_failures_are_both_named():
    _, line = run([agent("check-warnings")], final_research=final())
    assert "failed=[owner,save]" in line


def test_an_aborted_turn_names_its_abort():
    _, line = run([], final_research=final(), aborted="max_wall_clock_seconds")
    assert "stop=max_wall_clock_seconds" in line


def test_a_capped_turn_that_saved_still_fails_on_stop():
    g, line = run([agent("source-evaluation")], aborted="max_tool_calls")
    assert not g.passed
    assert "failed=[stop]" in line


def test_a_background_spawn_is_flagged():
    calls = [{**agent("source-evaluation"), "response_summary": "Async agent launched successfully. agentId: a1"}]
    g, line = run(calls, final_research=final())
    assert g.background_spawns == 1
    assert "background spawns: 1" in line
    _, quiet = run([agent("source-evaluation")])
    assert "background spawns" not in quiet


def test_missing_research_json_fails_save_and_no_research_job():
    g, line = run([agent("source-evaluation")], final_research=None)
    assert g.failed == ["no_research_job", "save"]
    assert "no research.json" in line


def test_extraction_count_is_reported_not_graded():
    calls = [
        agent("source-evaluation"),
        {"tool": "mcp__genealogy__extraction_append", "args": {}, "thread": "sub"},
    ]
    g, line = run(calls)
    assert g.passed and g.extraction_appends == 1
    assert "extraction_append=1" in line


# --- fixture loading --------------------------------------------------------

def test_every_committed_fixture_loads():
    dirs = fixture_dirs(DEFAULT_SINGLE_ASK_FIXTURES, None)
    assert dirs, "the panel has no fixtures"
    for d in dirs:
        fixture, spec = load_single_ask_fixture(d)
        assert fixture.researcher_question == spec.message
        assert fixture.id == d.name


def _write(tmp_path: Path, **over) -> Path:
    src = DEFAULT_SINGLE_ASK_FIXTURES / "review-sources-george-watrous"
    raw = json.loads((src / "fixture.json").read_text(encoding="utf-8"))
    raw.update(over)
    d = tmp_path / str(raw.get("id") or "f")
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
        {"is_plan_ask": "false"},
        {"setup_units": "init-project"},
        {"model": "claude-sonnet-4-6"},
        {"caps": []},
    ],
)
def test_bad_fixture_is_refused(tmp_path, over):
    with pytest.raises(FixtureError):
        load_single_ask_fixture(_write(tmp_path, **over))


def test_a_fixture_that_is_not_an_object_is_refused(tmp_path):
    d = _write(tmp_path)
    (d / "fixture.json").write_text("[]", encoding="utf-8")
    with pytest.raises(FixtureError):
        load_single_ask_fixture(d)


def test_sources_save_needs_no_tool(tmp_path):
    _, spec = load_single_ask_fixture(_write(tmp_path, expected_save={"section": "sources"}))
    assert spec.expected_save == {"section": "sources"}


def _orchestrator_source() -> str:
    return (REPO_ROOT / "eval/harness/e2e/orchestrator.py").read_text(encoding="utf-8")


def test_tree_block_is_lifted_only_in_single_ask_mode():
    tree = ast.parse(_orchestrator_source())
    guards = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.BoolOp) and isinstance(n.op, ast.And)
        and any(
            isinstance(v, ast.Call) and getattr(v.func, "id", None) == "is_blocked_tree_tool"
            for v in n.values
        )
    ]
    assert len(guards) == 1, "the live-tree deny must be guarded exactly once"
    first = guards[0].values[0]
    assert isinstance(first, ast.UnaryOp) and isinstance(first.op, ast.Not)
    assert getattr(first.operand, "id", None) == "single_ask"


def test_run_agent_sends_the_override_message():
    tree = ast.parse(_orchestrator_source())
    run_agent = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "_run_agent"
    )
    overrides = [
        n for n in ast.walk(run_agent)
        if isinstance(n, ast.If)
        and isinstance(n.test, ast.Compare)
        and getattr(n.test.left, "id", None) == "user_message"
        and isinstance(n.test.ops[0], ast.Is)
    ]
    assert len(overrides) == 1, "_run_agent must fall back to the /research rendering only when no message is given"


def test_message_thread_reads_parent_tool_use_id():
    from types import SimpleNamespace

    from e2e.orchestrator import message_thread

    assert message_thread(SimpleNamespace(parent_tool_use_id=None)) == "main"
    assert message_thread(SimpleNamespace()) == "main"
    assert message_thread(SimpleNamespace(parent_tool_use_id="toolu_1")) == "sub"
    assert _orchestrator_source().count('"thread": message_thread(message)') == 2


def test_run_single_ask_turn_turns_the_mode_on(monkeypatch, tmp_path):
    import asyncio

    import e2e.orchestrator as orch

    seen: dict = {}

    async def fake_run_agent(**kwargs):
        seen.update(kwargs)
        return ([agent("source-evaluation")], [], {"usage": {}}, None, None, [], [], [], [])

    monkeypatch.setattr(orch, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orch, "collect_subagents", lambda ws: ([], "ok"))
    monkeypatch.setattr(orch, "backfill_background_tool_calls", lambda ws, tc: None)
    monkeypatch.setattr(orch, "merge_whole_run_usage", lambda u, s: ({}, 0.42))
    fixture, _ = load_single_ask_fixture(DEFAULT_SINGLE_ASK_FIXTURES / "review-sources-george-watrous")
    record = asyncio.run(
        orch.run_single_ask_turn(fixture=fixture, message="M", workspace=tmp_path)
    )
    assert seen["single_ask"] is True
    assert seen["user_message"] == "M"
    assert seen["resume_on_stall"] is False
    assert record["message"] == "M"
    assert record["usage"]["whole_run_cost_usd_estimated"] == 0.42


# --- grader branches each tested on their own --------------------------------

def test_research_plan_spawn_alone_fails_a_non_plan_ask():
    _, line = run([agent("source-evaluation"), agent("research-plan")])
    assert "failed=[no_research_job]" in line and "research-plan" in line


def test_new_plan_alone_fails_a_non_plan_ask():
    _, line = run(
        [agent("source-evaluation")],
        final_research=final(log=[{"id": "log_002", "tool": "source-evaluation"}], plans=[{"id": "p_1"}]),
    )
    assert "failed=[no_research_job]" in line and "new plans entry" in line


SOURCES_SPEC = SingleAskSpec(**{**SPEC.__dict__, "expected_save": {"section": "sources"}})


def test_sources_save_missing_fails_and_present_passes():
    _, line = run([agent("source-evaluation")], final_research=final(), spec=SOURCES_SPEC)
    assert "failed=[save]" in line and "missing new sources" in line
    g, _ = run(
        [agent("source-evaluation")], final_research=final(sources=[{"id": "src_1"}]), spec=SOURCES_SPEC
    )
    assert g.passed


LOCALITY_SPEC = SingleAskSpec(**{**SPEC.__dict__, "expected_save": {"section": "localities"}})


def test_localities_save_passes_only_on_a_complete_guide():
    from e2e.single_ask_grade import GUIDE_HEADINGS

    from e2e.single_ask_grade import LOCALITY_RECORD_TYPES as _LOCALITY_RECORD_TYPES

    whole = "\n\n".join(f"{h}\n- x" for h in GUIDE_HEADINGS)
    rows = [{"type": t, "access": "unknown", "summary": "x"} for t in _LOCALITY_RECORD_TYPES]
    loc = {"id": "loc_1", "guide_markdown": whole, "record_types": rows}
    g, _ = run([agent("source-evaluation")], final_research=final(localities=[loc]), spec=LOCALITY_SPEC)
    assert g.passed
    short = whole.replace("## Boundary changes\n- x", "")
    g, line = run([agent("source-evaluation")], final_research=final(localities=[{**loc, "guide_markdown": short}]), spec=LOCALITY_SPEC)
    assert not g.passed and "## Boundary changes" in line
    g, line = run([agent("source-evaluation")], final_research=final(localities=[{**loc, "record_types": rows[1:]}]), spec=LOCALITY_SPEC)
    assert not g.passed and "record_types: census" in line
    g, line = run([agent("source-evaluation")], final_research=final(), spec=LOCALITY_SPEC)
    assert "missing new localities" in line


def test_the_graders_heading_list_is_the_validators():
    validator = (REPO_ROOT / "eval" / "harness" / "validators" / "test_locality_guide.py").read_text(encoding="utf-8")
    tree = ast.parse(validator)
    lines = next(
        ast.literal_eval(n.value) for n in tree.body
        if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == "_GUIDE_HEADING_LINES" for t in n.targets)
    )
    from e2e.single_ask_grade import GUIDE_HEADINGS

    assert GUIDE_HEADINGS == lines


PLAN_SPEC = SingleAskSpec(
    **{**SPEC.__dict__, "expected_owner": "research-plan", "expected_save": {"section": "plans"}, "is_plan_ask": True}
)


def test_plans_save_missing_fails_and_present_passes():
    _, line = run([agent("research-plan")], final_research=final(), spec=PLAN_SPEC)
    assert "failed=[save]" in line and "missing new plans" in line
    g, _ = run([agent("research-plan")], final_research=final(plans=[{"id": "pl_001"}]), spec=PLAN_SPEC)
    assert g.passed


def test_plans_save_needs_a_plan_ask(tmp_path):
    _, spec = load_single_ask_fixture(_write(tmp_path, expected_save={"section": "plans"}, is_plan_ask=True))
    assert spec.expected_save == {"section": "plans"}
    with pytest.raises(FixtureError, match="is_plan_ask"):
        load_single_ask_fixture(_write(tmp_path, id="no-plan-ask", expected_save={"section": "plans"}))


def test_missing_research_json_names_itself_in_the_save_detail():
    g, _ = run([agent("source-evaluation")], final_research=None)
    assert g.checks["save"] == (False, "no research.json")


def test_task_spelling_counts_as_a_spawn():
    g, _ = run([{"tool": "Task", "args": {"subagent_type": "source-evaluation"}, "thread": "main"}])
    assert g.first_unit == "source-evaluation"


# --- loader fields that feed the grade ---------------------------------------

def test_loader_carries_plan_ask_and_setup_units(tmp_path):
    _, spec = load_single_ask_fixture(
        _write(tmp_path, is_plan_ask=True, setup_units=["init-project"])
    )
    assert spec.is_plan_ask is True
    assert spec.setup_units == ("init-project",)


def test_loader_carries_caps(tmp_path):
    fixture, _ = load_single_ask_fixture(_write(tmp_path, caps={"max_cost_usd": 1.5}))
    assert fixture.caps.max_cost_usd == 1.5


def test_loader_refuses_a_fixture_without_its_starting_tree(tmp_path):
    d = _write(tmp_path)
    (d / "starting-tree.gedcomx.json").unlink()
    with pytest.raises(FixtureError):
        load_single_ask_fixture(d)


def test_fixture_dirs_takes_one_slug(tmp_path):
    for name in ("a", "b"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "fixture.json").write_text("{}", encoding="utf-8")
    assert fixture_dirs(tmp_path, "b") == [tmp_path / "b"]
    assert fixture_dirs(tmp_path, None) == [tmp_path / "a", tmp_path / "b"]


# --- main(): exit codes for runs that never happened or cannot be graded ----

FIXTURE_SAVED = final(log=[{"id": "log_002", "tool": "source_evaluation"}])


def _main_with(monkeypatch, tmp_path, capsys, aborted, final_research=FIXTURE_SAVED):
    import e2e.run_single_ask as rsa

    async def fake_turn(**kwargs):
        return {"tool_calls": [agent("source-evaluation")], "usage": {}, "aborted_reason": aborted, "error": "boom"}

    def fake_workspace(fixture, target, *a, **k):
        (Path(target) / "research.json").write_text(json.dumps(final_research), encoding="utf-8")
        return Path(target)

    monkeypatch.setattr(rsa, "run_single_ask_turn", fake_turn)
    monkeypatch.setattr(rsa, "build_workspace", fake_workspace)
    monkeypatch.setattr(rsa, "load_env_file", lambda: None)
    monkeypatch.setattr(rsa, "stage_openrouter_key", lambda: None)
    entry = tmp_path / "index.js"
    entry.write_text("", encoding="utf-8")
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    _write(fixtures)
    code = rsa.main([
        "--fixtures-root", str(fixtures), "--runlog-root", str(tmp_path / "runs"),
        "--mcp-server-entry", str(entry),
    ])
    return code, capsys.readouterr()


def test_main_exits_2_and_writes_nothing_when_the_server_was_unavailable(monkeypatch, tmp_path, capsys):
    code, out = _main_with(monkeypatch, tmp_path, capsys, "mcp_unavailable")
    assert code == 2
    assert "never happened" in out.err
    assert not (tmp_path / "runs").exists()


def test_main_prints_ungraded_and_exits_1_on_host_slept(monkeypatch, tmp_path, capsys):
    code, out = _main_with(monkeypatch, tmp_path, capsys, "host_slept")
    assert code == 1
    assert "UNGRADED" in out.out and "stop=host_slept" in out.out


def test_main_exits_0_on_a_pass_and_writes_the_run_log(monkeypatch, tmp_path, capsys):
    code, out = _main_with(monkeypatch, tmp_path, capsys, None)
    assert code == 0, out
    assert out.out.startswith("PASS ")
    logs = list((tmp_path / "runs").rglob("run-*.json"))
    assert len(logs) == 1
    assert json.loads(logs[0].read_text(encoding="utf-8"))["grade"]["passed"] is True


def test_loader_refuses_an_id_that_is_not_the_directory_name(tmp_path):
    d = _write(tmp_path)
    moved = d.rename(tmp_path / "copied-fixture")
    with pytest.raises(FixtureError, match="not the directory name"):
        load_single_ask_fixture(moved)


@pytest.mark.parametrize("body", ["{not json", "[]"])
def test_loader_refuses_a_bad_starting_research(tmp_path, body):
    d = _write(tmp_path)
    (d / "starting-research.json").write_text(body, encoding="utf-8")
    with pytest.raises(FixtureError, match="starting-research.json"):
        load_single_ask_fixture(d)


def test_cost_cap_labels_but_does_not_fail_stop():
    g, line = run([agent("source-evaluation")], aborted="cost_cap")
    assert g.passed
    assert "stop=cost_cap" in line


def test_a_namespaced_expected_owner_and_setup_unit_match():
    spec = SingleAskSpec(**{
        **SPEC.__dict__,
        "expected_owner": "genealogy-research:source-evaluation",
        "setup_units": ("genealogy-research:init-project",),
    })
    g, _ = run([agent("init-project"), agent("source-evaluation")], spec=spec)
    assert g.passed, g.checks


def test_the_record_keeps_subagent_summaries(monkeypatch, tmp_path):
    import asyncio

    import e2e.orchestrator as orch

    async def fake_run_agent(**kwargs):
        return ([], [], {}, None, None, [], [], [], [])

    monkeypatch.setattr(orch, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orch, "collect_subagents", lambda ws: ([{"agent_type": "source-evaluation"}], "ok"))
    monkeypatch.setattr(orch, "backfill_background_tool_calls", lambda ws, tc: None)
    monkeypatch.setattr(orch, "merge_whole_run_usage", lambda u, s: ({}, 0.1))
    fixture, _ = load_single_ask_fixture(DEFAULT_SINGLE_ASK_FIXTURES / "review-sources-george-watrous")
    record = asyncio.run(orch.run_single_ask_turn(fixture=fixture, message="M", workspace=tmp_path))
    assert record["subagents"] == [{"agent_type": "source-evaluation"}]


# --- owner lists, save alternatives, forbidden/required tools (issue #3571's panel) ---

ATTACHED = SingleAskSpec(
    id="death-already-attached",
    message="Can you find the death record for X?",
    expected_owner=(None, "search-records"),
    expected_save={"section": "sources", "absent": True},
    forbidden_tools=("record_search",),
    required_tools=("person_read",),
)
READ = {"tool": "mcp__genealogy__person_read", "args": {}, "thread": "main"}
SEARCH = {"tool": "mcp__genealogy__record_search", "args": {}, "thread": "main"}
NEW_SOURCE = final(sources=[{"id": "src_001"}])


def test_null_owner_passes_when_the_main_thread_answers_with_no_unit():
    g, line = run([skill("research"), READ], final_research=START, spec=ATTACHED)
    assert g.passed, line
    assert "expected=none|search-records" in line


def test_owner_list_passes_on_its_named_unit_and_fails_on_another():
    g, _ = run([agent("search-records"), READ], final_research=START, spec=ATTACHED)
    assert g.checks["owner"][0]
    g, line = run([agent("source-evaluation"), READ], final_research=START, spec=ATTACHED)
    assert g.failed == ["owner"] and "expected none|search-records" in g.checks["owner"][1]


def test_absent_save_fails_on_a_new_source():
    g, line = run([READ], final_research=NEW_SOURCE, spec=ATTACHED)
    assert g.failed == ["save"] and "1 new sources, expected none" in line


def test_forbidden_tool_fails_on_either_thread_and_any_spelling():
    for call in (SEARCH, {**SEARCH, "thread": "sub"},
                 {**SEARCH, "tool": "mcp__remote-devices__Genealogy_Research__record_search"}):
        g, line = run([READ, call], final_research=START, spec=ATTACHED)
        assert g.failed == ["forbidden_tools"], line
        assert "forbidden_tools: called record_search" in line


def test_required_tool_missing_fails():
    g, line = run([skill("research")], final_research=START, spec=ATTACHED)
    assert g.failed == ["required_tools"] and "never called without error: person_read" in line


def test_an_errored_required_call_does_not_count():
    g, line = run([{**READ, "is_error": True}], final_research=START, spec=ATTACHED)
    assert g.failed == ["required_tools"], line


# --- read_before_search: the read comes before the first search, on any thread --------

ATTACHED_FIRST = SingleAskSpec(
    id="children-attached-first",
    message="Find all the children of X.",
    expected_owner="search-records",
    expected_save={"section": "log", "tool": "record_search"},
    read_before_search=("record_read",),
)
RECORD_READ = {"tool": "mcp__genealogy__record_read", "args": {}, "thread": "main"}
SEARCHED = final(log=[{"id": "log_002", "tool": "record_search"}])


def test_a_read_before_the_first_search_passes_on_either_thread():
    for read in (RECORD_READ, {**RECORD_READ, "thread": "sub"}):
        g, line = run([read, agent("search-records"), {**SEARCH, "thread": "sub"}], final_research=SEARCHED, spec=ATTACHED_FIRST)
        assert g.passed, line
        assert g.checks["read_before_search"] == (True, "[record_read] called before the first search")
        assert g.first_unit == "search-records" and "first=search-records" in line, line


def test_a_read_only_after_the_first_search_fails():
    calls = [agent("search-records"), {**SEARCH, "thread": "sub"}, RECORD_READ]
    g, line = run(calls, final_research=SEARCHED, spec=ATTACHED_FIRST)
    assert g.failed == ["read_before_search"], line
    assert "read_before_search: not called without error before the first search: record_read" in line


def test_an_errored_read_before_the_search_does_not_count():
    calls = [{**RECORD_READ, "is_error": True}, agent("search-records"), {**SEARCH, "thread": "sub"}]
    g, line = run(calls, final_research=SEARCHED, spec=ATTACHED_FIRST)
    assert g.failed == ["read_before_search"], line


def test_any_search_tool_ends_the_window_and_a_turn_with_no_search_needs_the_read_anywhere():
    full_text = {"tool": "mcp__genealogy__fulltext_search", "args": {}, "thread": "sub"}
    g, _ = run([agent("search-records"), full_text, RECORD_READ], final_research=SEARCHED, spec=ATTACHED_FIRST)
    assert g.failed == ["read_before_search"]
    g, _ = run([agent("search-records"), RECORD_READ], final_research=SEARCHED, spec=ATTACHED_FIRST)
    assert g.passed and "searched nothing" in g.checks["read_before_search"][1]
    g, _ = run([agent("search-records")], final_research=SEARCHED, spec=ATTACHED_FIRST)
    assert g.failed == ["read_before_search"]


def test_read_before_search_is_not_graded_unless_the_fixture_sets_it():
    g, _ = run([agent("source-evaluation")])
    assert "read_before_search" not in g.checks


# --- names_unsaved: a turn that saved no source says so ------------------------------

UNSAVED = SingleAskSpec(
    id="children-unsaved",
    message="Find all the children of X.",
    expected_owner="search-records",
    expected_save={"section": "log", "tool": "record_search"},
    names_unsaved=True,
)


def run_reply(text, final_research=SEARCHED, spec=UNSAVED):
    g = grade(
        tool_calls=[agent("search-records"), {**SEARCH, "thread": "sub"}], spec=spec,
        starting_research=START, final_research=final_research, last_text=text,
    )
    return g, format_line(spec, g)


@pytest.mark.parametrize("reply", [
    "Nothing was extracted or attached.",
    "I have not written any sources, assertions or namesake records.",
    "Charles H. Phipps (b. 1854) is not yet saved to the project.",
    "I did not save the 1854 candidate.",
    "These two finds are unsaved.",
    "I saved no records this turn.",
    "None of them was saved.",
    "No candidates were added.",
    "The children aren't saved yet.",
])
def test_a_turn_that_saved_nothing_and_says_so_passes(reply):
    g, line = run_reply(f"Found two sons in the 1860 household. {reply}\n\nContinue with `running the searches`?")
    assert g.passed, line
    assert g.checks["names_unsaved"][1].startswith("says what it did not save: ")


@pytest.mark.parametrize("reply", [
    "I read the attached census households and found two sons, Charles and George.",
    "Mary E. is in the tree but not in any attached census household.",
    "The 1860 household is not attached to his profile.",
    "Charles was not recorded in the 1850 census.",
])
def test_a_turn_that_saved_nothing_and_does_not_say_so_fails(reply):
    g, line = run_reply(f"{reply}\n\nContinue with `running the searches`?")
    assert g.failed == ["names_unsaved"], line
    assert "names_unsaved: saved no source and the reply does not say so" in line


def test_a_turn_that_saved_a_source_passes_without_saying_anything():
    saved = final(log=[{"id": "log_002", "tool": "record_search"}], sources=[{"id": "src_001"}])
    g, line = run_reply("Found and saved the 1860 household.", final_research=saved)
    assert g.passed, line
    assert g.checks["names_unsaved"] == (True, "saved 1 source(s)")


def test_names_unsaved_with_no_main_thread_text_fails():
    g, line = run_reply(None)
    assert g.checks["names_unsaved"] == (False, "no main-thread text"), line


def test_names_unsaved_is_not_graded_unless_the_fixture_sets_it():
    g, _ = run_reply("Found two sons.", spec=ATTACHED_FIRST)
    assert "names_unsaved" not in g.checks


def test_loader_carries_names_unsaved_and_refuses_a_non_bool(tmp_path):
    _, spec = load_single_ask_fixture(_write(tmp_path, id="ok-unsaved", names_unsaved=True))
    assert spec.names_unsaved is True
    with pytest.raises(FixtureError, match="names_unsaved must be true or false"):
        load_single_ask_fixture(_write(tmp_path, id="bad-unsaved", names_unsaved="yes"))


def test_loader_carries_read_before_search_and_refuses_a_bad_name(tmp_path):
    _, spec = load_single_ask_fixture(_write(tmp_path, id="ok-read", read_before_search=["record_read"]))
    assert spec.read_before_search == ("record_read",)
    with pytest.raises(FixtureError, match="read_before_search names"):
        load_single_ask_fixture(_write(tmp_path, id="bad-read", read_before_search=["mcp__genealogy__record_read"]))


def test_a_background_spawn_fails_an_absence_pass():
    bg = {**agent("search-records"), "response_summary": "Async agent launched"}
    g, line = run([READ, bg], final_research=START, spec=ATTACHED)
    assert set(g.failed) == {"forbidden_tools", "save"}, line
    assert "an absence cannot be confirmed" in line


def test_tool_check_details_name_what_was_checked():
    g, _ = run([READ], final_research=START, spec=ATTACHED)
    assert g.checks["forbidden_tools"] == (True, "none of [record_search] called")
    assert g.checks["required_tools"] == (True, "[person_read] called")


FIND = SingleAskSpec(
    id="find-death",
    message="Can you find his death record?",
    expected_owner="search-records",
    expected_save=(
        {"section": "sources"},
        {"section": "log", "tool": "record_search", "outcome": "negative"},
    ),
)


@pytest.mark.parametrize(
    "extra, ok",
    [
        ({"sources": [{"id": "src_001"}]}, True),
        ({"log": [{"id": "log_002", "tool": "record_search", "outcome": "negative"}]}, True),
        ({"log": [{"id": "log_002", "tool": "record_search", "outcome": "positive"}]}, False),
        ({"log": [{"id": "log_002", "tool": "full_text_search", "outcome": "negative"}]}, False),
        ({}, False),
    ],
)
def test_any_one_save_alternative_passes(extra, ok):
    g, line = run([agent("search-records")], final_research=final(**extra), spec=FIND)
    assert g.passed is ok, line
    if not ok:
        assert "missing new sources or missing log tool=record_search outcome=negative" in line


def test_empty_tool_lists_pass_unchanged():
    g, _ = run([skill("research"), skill("source-evaluation")])
    assert g.checks["forbidden_tools"] == (True, "none declared")
    assert g.checks["required_tools"] == (True, "none declared")


def test_loader_carries_lists_and_keeps_absent_a_bool(tmp_path):
    _, spec = load_single_ask_fixture(_write(
        tmp_path,
        expected_owner=[None, "search-records"],
        expected_save=[{"section": "sources", "absent": True}],
        forbidden_tools=["record_search"],
        required_tools=["person_read"],
    ))
    assert spec.expected_owner == (None, "search-records")
    assert spec.expected_save == ({"section": "sources", "absent": True},)
    assert spec.forbidden_tools == ("record_search",) and spec.required_tools == ("person_read",)


@pytest.mark.parametrize(
    "over, match",
    [
        ({"expected_owner": []}, "missing"),
        ({"expected_owner": [None, 3]}, "unit names or null"),
        ({"expected_owner": [""]}, "unit names or null"),
        ({"expected_owner": 3}, "a name or a list"),
        ({"expected_owner": {"x": 1}}, "a name or a list"),
        ({"expected_save": []}, "missing"),
        ({"expected_save": [{"section": "sources"}, "log"]}, "section must be"),
        ({"expected_save": {"section": "sources", "absent": "true"}}, "true or false"),
        ({"expected_save": {"section": "sources", "absent": True, "tool": "x"}}, "does not take"),
        ({"expected_save": {"section": "sources", "outcome": "negative"}}, "does not take"),
        ({"expected_save": {"section": "log", "tool": "record_search", "outcom": "negative"}}, "does not take"),
        ({"expected_save": {"section": "log", "tool": "record_search", "outcome": "nil"}}, "outcome must be"),
        ({"expected_save": [{"section": "sources", "absent": True}, {"section": "sources"}]}, "always passes"),
        ({"expected_save": {"section": "sources", "absent": True}}, "needs required_tools"),
        (
            {
                "expected_owner": [None, "search-records"],
                "expected_save": [
                    {"section": "log", "tool": "record_search"},
                    {"section": "sources", "absent": True},
                ],
            },
            "needs required_tools",
        ),
        ({"forbidden_tools": "record_search"}, "list of tool names"),
        ({"required_tools": [""]}, "list of tool names"),
        ({"forbidden_tools": ["mcp__genealogy__record_search"]}, "bare name"),
        ({"forbidden_tools": ["record_searh"]}, "which is no tool"),
        ({"forbiden_tools": ["record_search"]}, "unknown keys"),
    ],
)
def test_bad_list_shapes_are_refused(tmp_path, over, match):
    with pytest.raises(FixtureError, match=match):
        load_single_ask_fixture(_write(tmp_path, **over))


def test_absent_false_and_a_known_builtin_load(tmp_path):
    _, spec = load_single_ask_fixture(_write(
        tmp_path,
        expected_save=[{"section": "sources", "absent": False}],
        required_tools=["Read"],
    ))
    assert spec.expected_save == ({"section": "sources", "absent": False},)


def test_committed_absence_fixture_matches_the_graded_spec():
    _, spec = load_single_ask_fixture(DEFAULT_SINGLE_ASK_FIXTURES / "death-attached-susan-cornwell")
    assert (spec.expected_owner, spec.expected_save, spec.forbidden_tools, spec.required_tools) == (
        ATTACHED.expected_owner, ATTACHED.expected_save,
        ATTACHED.forbidden_tools, ATTACHED.required_tools,
    )
    _, spec = load_single_ask_fixture(DEFAULT_SINGLE_ASK_FIXTURES / "find-death-john-mcnerny")
    assert (spec.expected_owner, spec.expected_save) == (FIND.expected_owner, FIND.expected_save)


# --- empty-folder fixtures and the offer check (issue #4509) -----------------

def _empty_folder(tmp_path: Path, **over) -> Path:
    d = _write(tmp_path, **over)
    for name in ("starting-research.json", "starting-tree.gedcomx.json"):
        (d / name).unlink()
    return d


def test_loader_takes_a_fixture_with_neither_starting_file_as_an_empty_folder(tmp_path):
    fixture, spec = load_single_ask_fixture(_empty_folder(tmp_path))
    assert fixture.starting_research_path is None
    assert fixture.starting_tree_path is None
    assert spec.ends_on_offer is False


@pytest.mark.parametrize("keep", ["starting-research.json", "starting-tree.gedcomx.json"])
def test_loader_refuses_a_fixture_with_one_starting_file(tmp_path, keep):
    d = _write(tmp_path)
    for name in ("starting-research.json", "starting-tree.gedcomx.json"):
        if name != keep:
            (d / name).unlink()
    with pytest.raises(FixtureError, match="both starting files or neither"):
        load_single_ask_fixture(d)


@pytest.mark.parametrize("value", ["true", 1, None])
def test_loader_refuses_a_non_bool_ends_on_offer(tmp_path, value):
    with pytest.raises(FixtureError, match="ends_on_offer must be true or false"):
        load_single_ask_fixture(_write(tmp_path, ends_on_offer=value))


def test_loader_carries_ends_on_offer(tmp_path):
    _, spec = load_single_ask_fixture(_write(tmp_path, ends_on_offer=True))
    assert spec.ends_on_offer is True


def test_build_workspace_copies_nothing_for_an_empty_folder_fixture(tmp_path):
    from e2e.orchestrator import build_workspace

    fx = tmp_path / "fx"
    fx.mkdir()
    fixture, _ = load_single_ask_fixture(_empty_folder(fx))
    skills, agents, ws = tmp_path / "skills", tmp_path / "agents", tmp_path / "ws"
    for d in (skills, agents, ws):
        d.mkdir()
    build_workspace(fixture, ws, skills, agents)
    for name in ("research.json", "tree.gedcomx.json", "starting-tree.gedcomx.json"):
        assert not (ws / name).exists(), name


def _offer(step="search"):
    from harness.skill_runner import load_step_boundary

    line = load_step_boundary().offer_line(step)
    assert line, f"no offer label for {step}"
    return line


def _offer_spec(**over):
    return SingleAskSpec(**{**SPEC.__dict__, "ends_on_offer": True, **over})


def run_offer(last_text, spec=None):
    spec = spec or _offer_spec()
    g = grade(
        tool_calls=[skill("research"), agent("source-evaluation")], spec=spec,
        starting_research=START, final_research=SAVED, last_text=last_text,
    )
    return g, format_line(spec, g)


def test_offer_check_passes_on_a_continue_line():
    g, line = run_offer(f"Here is what I found.\n\n{_offer()}")
    assert g.passed, line
    assert g.checks["ends_on_offer"][0]


@pytest.mark.parametrize(
    "text",
    [
        "Here is what I found. Nothing more to do.",
        "Continue with polishing the family tree?",  # an invented label offers nothing
        f"{_offer()}\n\nLet me know what you think.",  # the offer is not the last line
        None,
    ],
)
def test_offer_check_fails_without_a_named_offer(text):
    g, line = run_offer(text)
    assert not g.passed
    assert g.failed == ["ends_on_offer"]
    assert "failed=[ends_on_offer]" in line and "ends_on_offer:" in line


def test_offer_check_is_not_graded_unless_the_fixture_asks():
    g, _ = run_offer(None, spec=SPEC)
    assert g.passed
    assert "ends_on_offer" not in g.checks


def test_last_main_text_skips_subagent_and_harness_lines():
    from e2e.single_ask_grade import last_main_text

    narration = [
        {"kind": "assistant", "thread": "main", "text": "first"},
        {"kind": "assistant", "thread": "main", "text": _offer()},
        {"kind": "assistant", "thread": "sub", "text": "a subagent's last words"},
        {"kind": "harness", "text": "harness note"},
    ]
    assert last_main_text(narration) == _offer()
    assert last_main_text([{"kind": "assistant", "thread": "sub", "text": "x"}]) is None
    assert last_main_text(None) is None


NO_PID_SPEC = SingleAskSpec(
    id="no-pid", message="Locate the birth date of Marie Anne Brigard.",
    expected_owner="init-project", expected_save=({"section": "log", "absent": True},),
    required_tools=("project_context",),
)
CONTEXT_CALL = {"tool": "mcp__genealogy__project_context", "args": {}, "thread": "main"}


def test_empty_folder_with_no_research_json_after_is_no_new_rows():
    g = grade(
        tool_calls=[skill("research"), CONTEXT_CALL, agent("init-project")],
        spec=NO_PID_SPEC, starting_research=None, final_research=None,
    )
    assert g.passed, format_line(NO_PID_SPEC, g)
    assert g.checks["no_research_job"] == (True, "none started")


def test_empty_folder_with_no_research_json_still_fails_a_present_save():
    spec = SingleAskSpec(**{**NO_PID_SPEC.__dict__, "expected_save": {"section": "sources"}})
    g = grade(
        tool_calls=[skill("research"), CONTEXT_CALL, agent("init-project")],
        spec=spec, starting_research=None, final_research=None,
    )
    assert g.failed == ["save"]
    assert g.checks["no_research_job"][0]


def test_route_note_hook_sends_the_shipped_decision():
    import asyncio

    from harness.context_policy import _route, route_note_hook

    prompt = {"prompt": "Find records on KWCF-S1C."}
    out = asyncio.run(route_note_hook(prompt, None, None))
    assert out == _route.decision(prompt, {})
    assert out["hookSpecificOutput"]["additionalContext"] == f"{_route.CONTEXT}\n\n{_route.SOURCES_NOTE}"
    hand_back = {"prompt": '<agent-message from="a1">done</agent-message>'}
    assert asyncio.run(route_note_hook(hand_back, None, None)) == {}


def test_run_agent_binds_the_route_hook_only_in_single_ask_mode():
    tree = ast.parse(_orchestrator_source())
    picks = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.IfExp)
        and getattr(n.test, "id", None) == "single_ask"
        and getattr(n.body, "id", None) == "route_note_hook"
        and getattr(n.orelse, "id", None) == "sources_note_hook"
    ]
    assert len(picks) == 1, "_run_agent must pick route_note_hook when single_ask, else sources_note_hook"


def test_main_grades_an_empty_folder_run_with_its_offer(monkeypatch, tmp_path, capsys):
    import e2e.run_single_ask as rsa

    seen: dict = {}

    async def fake_turn(**kwargs):
        return {
            "tool_calls": [skill("research"), agent("init-project"), agent("search-records")],
            "narration": [
                {"kind": "assistant", "thread": "main", "text": f"No match found.\n{_offer()}"},
                {"kind": "assistant", "thread": "sub", "text": "subagent text"},
            ],
            "usage": {}, "aborted_reason": None, "error": None,
        }

    def fake_workspace(fixture, target, *a, **k):
        seen["research_path"] = fixture.starting_research_path
        (Path(target) / "research.json").write_text(json.dumps(
            {"log": [{"id": "log_001", "tool": "record_search", "outcome": "negative"}]}
        ), encoding="utf-8")
        return Path(target)

    monkeypatch.setattr(rsa, "run_single_ask_turn", fake_turn)
    monkeypatch.setattr(rsa, "build_workspace", fake_workspace)
    monkeypatch.setattr(rsa, "load_env_file", lambda: None)
    monkeypatch.setattr(rsa, "stage_openrouter_key", lambda: None)
    entry = tmp_path / "index.js"
    entry.write_text("", encoding="utf-8")
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    _empty_folder(
        fixtures, expected_owner="search-records", setup_units=["init-project"],
        expected_save={"section": "log", "tool": "record_search", "outcome": "negative"},
        ends_on_offer=True,
    )
    code = rsa.main([
        "--fixtures-root", str(fixtures), "--runlog-root", str(tmp_path / "runs"),
        "--mcp-server-entry", str(entry),
    ])
    out = capsys.readouterr()
    assert code == 0, out
    assert seen["research_path"] is None
    log = json.loads(next((tmp_path / "runs").rglob("run-*.json")).read_text(encoding="utf-8"))
    assert log["grade"]["checks"]["ends_on_offer"]["ok"] is True



@pytest.mark.parametrize(
    "save",
    [{"section": "sources"}, [{"section": "log", "tool": "record_search"}, {"section": "sources"}]],
)
def test_loader_refuses_a_sources_save_in_an_empty_folder(tmp_path, save):
    with pytest.raises(FixtureError, match="cannot save `sources`"):
        load_single_ask_fixture(_empty_folder(tmp_path, expected_save=save))


def test_a_research_json_that_does_not_parse_is_not_an_untouched_folder():
    g = grade(
        tool_calls=[skill("research"), CONTEXT_CALL, agent("init-project")],
        spec=NO_PID_SPEC, starting_research=None, final_research=None,
        research_json_exists=True,
    )
    assert g.failed == ["no_research_job", "save"]
    assert g.checks["save"] == (False, "research.json unreadable")


# --- known_issue: a FAIL an open issue owns stays out of the exit code -------

def test_loader_carries_known_issue(tmp_path):
    _, spec = load_single_ask_fixture(_write(tmp_path, known_issue="#2813"))
    assert spec.known_issue == "#2813"


@pytest.mark.parametrize("value", ["2813", "#0", "#2813 items 3-4", 2813, None, ["#2813"]])
def test_loader_refuses_a_known_issue_that_is_not_an_issue_number(tmp_path, value):
    with pytest.raises(FixtureError, match="known_issue must be an issue number"):
        load_single_ask_fixture(_write(tmp_path, known_issue=value))


def _known_spec():
    return SingleAskSpec(**{**SPEC.__dict__, "known_issue": "#2813"})


def test_a_known_failure_prints_known_fail_and_its_issue():
    g, line = run([skill("research"), agent("check-warnings")], spec=_known_spec())
    assert not g.passed
    assert line.startswith("KNOWN-FAIL review-sources")
    assert "failed=[owner]" in line and "known_issue=#2813" in line


def test_a_known_issue_fixture_that_passes_says_to_remove_it():
    g, line = run([skill("research"), agent("source-evaluation")], spec=_known_spec())
    assert g.passed
    assert line.startswith("PASS review-sources")
    assert "remove known_issue" in line


def _main_known(monkeypatch, tmp_path, capsys, calls_by_fixture, known):
    import e2e.run_single_ask as rsa

    async def fake_turn(*, fixture, **kwargs):
        return {"tool_calls": calls_by_fixture[fixture.id], "usage": {}, "aborted_reason": None, "error": None}

    def fake_workspace(fixture, target, *a, **k):
        (Path(target) / "research.json").write_text(json.dumps(FIXTURE_SAVED), encoding="utf-8")
        return Path(target)

    monkeypatch.setattr(rsa, "run_single_ask_turn", fake_turn)
    monkeypatch.setattr(rsa, "build_workspace", fake_workspace)
    monkeypatch.setattr(rsa, "load_env_file", lambda: None)
    monkeypatch.setattr(rsa, "stage_openrouter_key", lambda: None)
    entry = tmp_path / "index.js"
    entry.write_text("", encoding="utf-8")
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    for fid in calls_by_fixture:
        over = {"id": fid}
        if fid in known:
            over["known_issue"] = "#2813"
        _write(fixtures, **over)
    code = rsa.main([
        "--fixtures-root", str(fixtures), "--runlog-root", str(tmp_path / "runs"),
        "--mcp-server-entry", str(entry),
    ])
    return code, capsys.readouterr().out


def test_main_exits_0_when_the_only_failure_is_known(monkeypatch, tmp_path, capsys):
    code, out = _main_known(monkeypatch, tmp_path, capsys, {
        "a-pass": [agent("source-evaluation")],
        "b-known": [agent("check-warnings")],
    }, known={"b-known"})
    assert code == 0, out
    assert "KNOWN-FAIL b-known" in out
    assert "2 fixtures: 1 pass, 1 known fail, 0 fail or ungraded" in out


def test_main_exits_1_on_a_failure_with_no_known_issue(monkeypatch, tmp_path, capsys):
    code, out = _main_known(monkeypatch, tmp_path, capsys, {
        "a-known": [agent("check-warnings")],
        "b-new": [agent("check-warnings")],
    }, known={"a-known"})
    assert code == 1, out
    assert "FAIL b-new" in out and "KNOWN-FAIL b-new" not in out
    assert "2 fixtures: 0 pass, 1 known fail, 1 fail or ungraded" in out


def _unnamed_known_issues(root: Path) -> list[str]:
    """Each fixture under `root` whose README does not name its known_issue ("Issue #N owns it")."""
    unnamed = []
    for d in fixture_dirs(root, None):
        _, spec = load_single_ask_fixture(d)
        if spec.known_issue and f"Issue {spec.known_issue} owns it" not in (d / "README.md").read_text(
            encoding="utf-8"
        ):
            unnamed.append(d.name)
    return unnamed


def test_every_committed_known_issue_is_named_in_its_readme():
    assert _unnamed_known_issues(DEFAULT_SINGLE_ASK_FIXTURES) == []


def test_the_readme_check_flags_a_known_issue_its_readme_does_not_name(tmp_path):
    # The panel may carry no known_issue at all, so the committed check can pass on none;
    # this keeps the check itself able to fail.
    named = _write(tmp_path, id="named", known_issue="#2813")
    (named / "README.md").write_text("Issue #2813 owns it.\n", encoding="utf-8")
    unnamed = _write(tmp_path, id="unnamed", known_issue="#2813")
    (unnamed / "README.md").write_text("Owned elsewhere.\n", encoding="utf-8")
    plain = _write(tmp_path, id="plain")
    (plain / "README.md").write_text("No known issue.\n", encoding="utf-8")
    assert _unnamed_known_issues(tmp_path) == ["unnamed"]
