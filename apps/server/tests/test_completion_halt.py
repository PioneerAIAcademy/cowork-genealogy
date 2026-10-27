"""The completion halt (issue #3542 lead 1).

When the main-thread proof-conclusion call completes the project, the main thread's next
model call only paraphrases the agent's `summary_for_user`. Both hosted planes end the turn
at that call's PostToolUse and show the summary itself. The probe that showed a PostToolUse
halt ends the turn is `dev/probe_posttool_halt.py`.

The fixtures are real Agent returns, copied verbatim: two from committed e2e run logs (the
model-facing shapes, one framed and one not) and one PostToolUse `tool_response` captured
by that probe. A parser written from made-up strings passed while missing every real one.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.agent import continue_policy as cp
from app.agent import real_agent

FIXTURES = Path(__file__).parent / "fixtures" / "agent_returns"
FINISHED = "The research is finished. If you'd like a second opinion on it, just ask."


def _fixture(name: str):
    data = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    return data.get("tool_response", data.get("content"))


# ── summary_for_user ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("name", "opening"),
    [
        ("framed_one_block", "Jantje Willems, the wife of Jacob Jeltes"),
        ("unframed_two_blocks", "The civil birth registration filed in Guerrero"),
    ],
)
def test_the_summary_of_a_real_completing_return_is_its_two_paragraphs(name, opening):
    summary = cp.summary_for_user(_fixture(name))
    expected = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))["expected_summary"]
    assert summary == expected, "the exact two paragraphs, read off the run log and checked by hand"
    assert summary.startswith(opening)
    assert summary.endswith(FINISHED)
    assert summary.count("\n\n") == 1, "exactly two paragraphs"
    for leaked in ("agentId", "<usage>", "Subagent hand-back", "---"):
        assert leaked not in summary, leaked
    assert not any(line.startswith("  ") for line in summary.splitlines()), "the frame's indent is removed"


def test_the_posttool_dict_parses():
    """The shape the hook actually receives: a dict whose `content` carries no frame."""
    summary = cp.summary_for_user(_fixture("posttool_dict"))
    assert summary is not None
    assert summary.startswith("The 1880 census citation above follows")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Findings only, no rule.", None),
        ("Findings.\n---\n", None),
        ("Findings.\n---\n   \n", None),
        ("A table\n---\nmiddle\n---\nThe summary.", "The summary."),
        ("Findings.\r\n---\r\nPara one.\r\n\r\nPara two.", "Para one.\n\nPara two."),
        ("", None),
    ],
)
def test_summary_edges(text, expected):
    assert cp.summary_for_user({"content": [{"type": "text", "text": text}]}) == expected


@pytest.mark.parametrize("response", [None, 42, {"content": 7}, {"content": [None, 3]}, {}])
def test_a_response_with_no_text_has_no_summary(response):
    assert cp.summary_for_user(response) is None


# ── is_proof_conclusion_call / completion_halt_summary ───────────────────────────────────


@pytest.mark.parametrize(
    ("tool_input", "expected"),
    [
        ({"subagent_type": "proof-conclusion"}, True),
        ({"subagent_type": "genealogy-research:proof-conclusion"}, True),
        ({"subagent_type": "citation"}, False),
        ({"subagent_type": "proof-conclusion-v2"}, False),
        ({}, False),
        (None, False),
        ({"subagent_type": 5}, False),
    ],
)
def test_is_proof_conclusion_call(tool_input, expected):
    assert cp.is_proof_conclusion_call(tool_input) is expected


@pytest.mark.parametrize(
    ("before", "now", "halts"),
    [
        ("active", {"project": {"status": "completed"}}, True),
        ("", {"project": {"status": "completed"}}, True),
        ("completed", {"project": {"status": "completed"}}, False),
        ("active", {"project": {"status": "active"}}, False),
        ("active", None, False),
    ],
)
def test_completion_halt_summary_is_the_transition(before, now, halts):
    reads: list[int] = []

    def research_now():
        reads.append(1)
        return now

    data = {"tool_name": "Agent", "tool_input": {"subagent_type": "proof-conclusion"},
            "tool_response": _fixture("posttool_dict")}
    out = cp.completion_halt_summary(data, before, research_now)
    assert (out is not None) is halts
    if before == "completed":
        assert reads == [], "read the project though it was completed before the call"


# ── status_before_call / wants_status_before ─────────────────────────────────────────


@pytest.mark.parametrize(
    ("research", "expected"),
    [
        ({"project": {"status": "active"}}, "active"),
        ({"project": {"status": "completed"}}, "completed"),
        ({"project": {}}, ""),
        (None, "completed"),
        ({}, "completed"),
    ],
)
def test_status_before_call_never_guesses(research, expected):
    assert cp.status_before_call(research) == expected


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        ({"tool_name": "Agent", "tool_input": {"subagent_type": "proof-conclusion"}}, True),
        ({"tool_name": "Task", "tool_input": {"subagent_type": "genealogy-research:proof-conclusion"}}, True),
        ({"tool_name": "Agent", "tool_input": {"subagent_type": "proof-conclusion"}, "agent_id": None}, False),
        ({"tool_name": "Agent", "tool_input": {"subagent_type": "citation"}}, False),
        ({"tool_name": "Read", "tool_input": {"subagent_type": "proof-conclusion"}}, False),
    ],
)
def test_wants_status_before(data, expected):
    assert cp.wants_status_before(data) is expected


def test_the_ported_frame_patterns_match_the_harness():
    """`continue_policy` carries a copy of the harness's frame and trailer regexes (this
    package cannot import `eval/`). A CLI change to the frame fixed in one copy only would
    leak the trailer into the summary or quietly disable the halt."""
    import ast

    source = (Path(__file__).resolve().parents[3] / "eval" / "harness" / "harness" / "skill_runner.py").read_text(encoding="utf-8")
    harness = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name == "_HAND_BACK_HEADER":
                harness[name] = [ast.literal_eval(node.value.args[0])]
            elif name == "_AGENT_RETURN_TRAILERS":
                harness[name] = [ast.literal_eval(call.args[0]) for call in node.value.elts]
    assert set(harness) == {"_HAND_BACK_HEADER", "_AGENT_RETURN_TRAILERS"}, "the harness moved them"
    assert [cp._HAND_BACK_HEADER.pattern] == harness["_HAND_BACK_HEADER"]
    assert [p.pattern for p in cp._AGENT_RETURN_TRAILERS] == harness["_AGENT_RETURN_TRAILERS"]


# ── the alpha plane ──────────────────────────────────────────────────────────────────


class FakeMatcher:
    def __init__(self, **kw):
        self.kw = kw


def _write(project_dir: Path, status: str) -> None:
    (project_dir / "research.json").write_text(
        json.dumps({"project": {"status": status}}), encoding="utf-8"
    )


def _alpha(project_dir: Path):
    """The hooks, and a stand-in agent at the start of a turn."""
    agent = SimpleNamespace(pending_user_message=lambda: False)
    hooks = real_agent._build_hooks(FakeMatcher, project_dir, agent=agent)
    real_agent.RealAgent._begin_turn_hook_state(agent)
    return hooks, agent


def _status_hook(hooks):
    matcher = hooks["PreToolUse"][-1]
    assert matcher.kw["matcher"] == real_agent._DELEGATION_MATCHER
    return matcher.kw["hooks"][0]


def _halt_hook(hooks):
    (matcher,) = hooks["PostToolUse"]
    assert matcher.kw["matcher"] == real_agent._DELEGATION_MATCHER
    return matcher.kw["hooks"][0]


def _agent_call(response=None, subagent_type="proof-conclusion", **extra):
    return {
        "tool_name": "Agent",
        "tool_input": {"subagent_type": subagent_type, "prompt": "conclude q_001"},
        "tool_response": response if response is not None else _fixture("posttool_dict"),
        **extra,
    }


def _post(hook, payload, tid="tid"):
    return asyncio.run(hook(payload, tid, None))


def _call_through(tmp_path, hooks, payload, before: str | None, after: str, tid="tid"):
    """One Agent call as the CLI runs it: PreToolUse, the agent's work, PostToolUse."""
    if before is not None:
        _write(tmp_path, before)
    pre = {k: v for k, v in payload.items() if k != "tool_response"}
    assert _post(_status_hook(hooks), pre, tid) == {}, "the status read never changes the call"
    _write(tmp_path, after)
    return _post(_halt_hook(hooks), payload, tid)


def test_the_alpha_halts_on_the_call_that_completes_the_project(tmp_path):
    hooks, agent = _alpha(tmp_path)
    out = _call_through(tmp_path, hooks, _agent_call(), "active", "completed")
    summary = cp.summary_for_user(_fixture("posttool_dict"))
    assert out == {"continue": False, "stopReason": summary}
    assert agent._hook_counter["completion_summary"] == summary


@pytest.mark.parametrize(
    ("label", "before", "payload"),
    [
        ("already completed before the call", "completed", _agent_call()),
        ("no research.json before the call", None, _agent_call()),
        ("a subagent's own Agent call", "active", _agent_call(agent_id="sub-1")),
        ("another agent", "active", _agent_call(subagent_type="citation",
                                                response={"agentType": "citation", "content": "x\n---\ny"})),
        ("no summary in the return", "active", _agent_call(response={"content": "no rule here"})),
    ],
)
def test_the_alpha_does_not_halt(tmp_path, label, before, payload):
    hooks, agent = _alpha(tmp_path)
    assert _call_through(tmp_path, hooks, payload, before, "completed") == {}, label
    assert agent._hook_counter["completion_summary"] is None, label


def test_the_alpha_does_not_halt_when_the_project_stays_open(tmp_path):
    hooks, _agent = _alpha(tmp_path)
    assert _call_through(tmp_path, hooks, _agent_call(), "active", "active") == {}


def test_no_reading_before_the_call_never_halts(tmp_path):
    """A PostToolUse whose PreToolUse never recorded a status (another call's id) counts
    as already completed: the halt never fires on a guess."""
    hooks, _agent = _alpha(tmp_path)
    _write(tmp_path, "active")
    _post(_status_hook(hooks), {k: v for k, v in _agent_call().items() if k != "tool_response"}, "tid-1")
    _write(tmp_path, "completed")
    assert _post(_halt_hook(hooks), _agent_call(), "tid-2") == {}


def test_the_id_in_the_payload_is_used_when_none_is_passed(tmp_path):
    hooks, _agent = _alpha(tmp_path)
    _write(tmp_path, "active")
    payload = {**_agent_call(), "tool_use_id": "tid-9"}
    _post(_status_hook(hooks), {k: v for k, v in payload.items() if k != "tool_response"}, None)
    _write(tmp_path, "completed")
    assert _post(_halt_hook(hooks), payload, None)["continue"] is False


def test_a_raising_read_allows_the_call(tmp_path, monkeypatch):
    hooks, _agent = _alpha(tmp_path)

    def boom(_dir):
        raise OSError("disk gone")

    monkeypatch.setattr(real_agent, "read_research_json", boom)
    assert _call_through(tmp_path, hooks, _agent_call(), "active", "completed") == {}


def test_the_turn_boundary_clears_the_halt_state(tmp_path):
    hooks, agent = _alpha(tmp_path)
    assert _call_through(tmp_path, hooks, _agent_call(), "active", "completed")["continue"] is False
    real_agent.RealAgent._begin_turn_hook_state(agent)
    assert agent._hook_counter["completion_summary"] is None
    assert agent._hook_counter["status_before"] == {}
    # A follow-up question in the completed project: the same call no longer halts.
    assert _call_through(tmp_path, hooks, _agent_call(), None, "completed") == {}


def test_a_stand_in_still_clears():
    agent = SimpleNamespace(_hook_counter={"tool_calls": 0})
    real_agent.RealAgent._begin_turn_hook_state(agent)
    assert agent._hook_counter["status_before"] == {}
    assert agent._hook_counter["completion_summary"] is None


def test_handle_turn_shows_the_summary_before_usage(tmp_path):
    """The browser never receives `stopReason` on this plane (`map_message` has no
    `ResultMessage` branch), so without this event a completed turn ends with no text."""
    from claude_agent_sdk import ResultMessage

    from _fakes import ReplayFakeClient, attach, turn_events

    agent = real_agent.RealAgent(tmp_path)
    agent._hook_counter = {"tool_calls": 0}
    done = ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1,
                         is_error=False, num_turns=2, session_id="s1")

    class HaltingClient(ReplayFakeClient):
        """Sets the summary mid-turn, as the PostToolUse hook does after the reset."""

        async def receive_response(self):
            agent._hook_counter["completion_summary"] = "The research is finished."
            async for message in super().receive_response():
                yield message

    attach(agent, HaltingClient([done]))
    events = asyncio.run(turn_events(agent, "conclude it"))
    kinds = [e["kind"] for e in events]
    assert "text" in kinds and "usage" in kinds, kinds
    assert kinds.index("text") < kinds.index("usage")
    assert events[kinds.index("text")]["text"] == "The research is finished."


def test_handle_turn_adds_no_text_without_a_halt(tmp_path):
    from claude_agent_sdk import ResultMessage

    from _fakes import ReplayFakeClient, attach, turn_events

    agent = real_agent.RealAgent(tmp_path)
    agent._hook_counter = {"tool_calls": 0}
    done = ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1,
                         is_error=False, num_turns=1, session_id="s1")
    attach(agent, ReplayFakeClient([done]))
    events = asyncio.run(turn_events(agent, "next"))
    assert "text" not in [e["kind"] for e in events]


# ── the prototype worker: the arm in `make_posttool_hook` ────────────────────────────

from proto.worker import options as worker_options  # noqa: E402


def _worker_hook(status_before="active", research_now=None):
    completed: list[str] = []
    hook = worker_options.make_posttool_hook(
        turn_id="t1", finish=lambda _id: None, log=lambda **_f: None,
        research=lambda: research_now if research_now is not None else {"project": {"status": "completed"}},
        status_before=lambda _use_id: status_before,
        on_completed=completed.append,
    )
    return hook, completed


def test_the_worker_halts_with_exactly_the_continue__dict():
    hook, completed = _worker_hook()
    out = _post(hook, _agent_call())
    summary = cp.summary_for_user(_fixture("posttool_dict"))
    assert out == {"continue_": False, "stopReason": summary}, "no PreToolUse deny half"
    assert completed == [summary]


@pytest.mark.parametrize(
    ("label", "status_before", "payload"),
    [
        ("completed before the call", "completed", _agent_call()),
        ("a subagent's own Agent call", "active", _agent_call(agent_id="sub-1")),
        ("another agent", "active", _agent_call(subagent_type="citation",
                                                response={"agentType": "citation", "content": "x\n---\ny"})),
        ("no summary in the return", "active", _agent_call(response={"content": "no rule here"})),
    ],
)
def test_the_worker_does_not_halt(label, status_before, payload):
    hook, completed = _worker_hook(status_before=status_before)
    assert _post(hook, payload) == {}, label
    assert completed == [], label


def test_the_worker_does_not_halt_while_the_project_is_open():
    hook, completed = _worker_hook(research_now={"project": {"status": "active"}})
    assert _post(hook, _agent_call()) == {}
    assert completed == []


def test_an_unarmed_posttool_hook_never_halts():
    """The existing callers pass none of the three: the hook only times calls."""
    hook = worker_options.make_posttool_hook(turn_id="t1", finish=lambda _id: None)
    assert _post(hook, _agent_call()) == {}


def test_the_worker_allows_the_call_when_the_read_raises():
    completed: list[str] = []

    def boom():
        raise OSError("store gone")

    hook = worker_options.make_posttool_hook(
        turn_id="t1", finish=lambda _id: None, log=lambda **_f: None,
        research=boom, status_before=lambda _use_id: "active", on_completed=completed.append,
    )
    assert _post(hook, _agent_call()) == {}
    assert completed == []
