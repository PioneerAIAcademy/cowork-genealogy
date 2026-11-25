"""The host posts each new search link (issue #4660, lead ruling 2026-11-23, "link site").

An external-site search is a link the researcher has to open. It used to reach the chat
only if the main thread relayed the agent's report, while `project_context`'s
`awaitingUser` treated it as handed over regardless; in one alpha session 11 logged links
never reached the chat. Both hosted planes now post every hand-off a turn opened as its own
paragraph of the reply. These drive the alpha through `RealAgent.handle_turn` with real SDK
message objects, as `test_completion_halt.py` does; the worker's arm is in
`test_proto_worker.py`.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.agent import continue_policy as cp
from app.agent import real_agent

URL_A = "https://www.findagrave.com/memorial/search?firstname=Thomas&lastname=Hagell_x"
URL_B = "https://www.ancestry.com/search/?name=Thomas_Hagell&death=1882_utah-usa"
URL_C = "https://billiongraves.com/search/results?given_names=Thomas&family_names=Hagell"


def _hand_off(log_id: str, url: str, outcome: str = "partial", captured: bool = False,
              site: str = "findagrave") -> dict:
    return {"id": log_id, "tool": "external_site", "outcome": outcome, "plan_item_id": "pli_001",
            "external_site": {"site": site, "url_generated": url, "capture_received": captured}}


def _write_log(project_dir: Path, *entries: dict) -> None:
    (project_dir / "research.json").write_text(
        json.dumps({"project": {"status": "active"}, "log": list(entries)}), encoding="utf-8")


# ── the paragraph ─────────────────────────────────────────────────────────────────────


def test_the_paragraph_names_the_site_and_autolinks_the_url():
    text = cp.hand_off_link_text(URL_A)
    assert text.startswith("Search to run on findagrave.com:")
    assert text.endswith(f"<{URL_A}>"), "an autolink, so `_` in the URL is not read as markup"
    assert "log_" not in text and "pli_" not in text, "no internal ids reach the researcher"


def test_a_url_with_no_host_still_reads():
    """No scheme and no host: `<not-a-url>` would parse as an HTML tag and be dropped, so it
    is shown as code."""
    assert cp.hand_off_link_text("not-a-url") == (
        "Search to run: open this link, then send back what you find there.\n`not-a-url`")


def test_a_url_with_no_scheme_gets_https():
    """An autolink needs a scheme; `<www.ancestry.com/...>` renders as literal text."""
    text = cp.hand_off_link_text("www.ancestry.com/search/?name=Thomas_Hagell")
    assert text.startswith("Search to run on ancestry.com:")
    assert text.endswith("<https://www.ancestry.com/search/?name=Thomas_Hagell>")


@pytest.mark.parametrize("url", ["https://[findagrave.com/x", "http://[::1/x", "https://a]b.com/"])
def test_a_url_that_will_not_parse_never_raises(url):
    """`urlsplit` raises ValueError on an unbalanced bracket in the netloc."""
    text = cp.hand_off_link_text(url)
    assert text.startswith("Search to run") and text.endswith(f"<{url}>")


def test_a_control_character_is_encoded():
    text = cp.hand_off_link_text("https://www.ancestry.com/search/?name=Thomas\nHagell\t\x7f")
    assert text.endswith("<https://www.ancestry.com/search/?name=Thomas%0AHagell%09%7F>")


def test_a_url_that_cannot_sit_in_an_autolink_is_encoded():
    """An agent-logged URL may carry a raw space; an autolink holding one renders as plain
    text, so the link would not open."""
    text = cp.hand_off_link_text("https://www.ancestry.com/search/?name=Thomas Hagell&x=<1>")
    assert text.endswith("<https://www.ancestry.com/search/?name=Thomas%20Hagell&x=%3C1%3E>")


@pytest.mark.parametrize(
    ("tool", "opens"),
    [("Agent", True), ("Task", True), ("mcp__genealogy__research_log_append", True),
     ("mcp__remote-devices__Genealogy_Research__build_external_search_url", True),
     ("mcp__genealogy__record_search", False), ("Read", False), (None, False), (["Agent"], False)],
)
def test_which_calls_can_open_a_hand_off(tool, opens):
    assert cp.opens_hand_offs(tool) is opens


def test_an_unseeded_tracker_posts_nothing():
    links = cp.HandOffLinks()
    assert links.new_texts([{"log_id": "log_001", "url_generated": URL_A}]) == []


# ── the alpha, through handle_turn ────────────────────────────────────────────────────


def _messages():
    from claude_agent_sdk import (AssistantMessage, ResultMessage, TextBlock, ToolResultBlock,
                                  ToolUseBlock, UserMessage)

    def call(use_id: str, name: str = "Agent", parent: str | None = None):
        return AssistantMessage(content=[ToolUseBlock(id=use_id, name=name,
                                                      input={"subagent_type": "search-external-sites"})],
                                model="m", parent_tool_use_id=parent)

    def calls(*use_ids: str):
        return AssistantMessage(content=[ToolUseBlock(id=u, name="Agent", input={"subagent_type": "x"})
                                         for u in use_ids], model="m")

    def result(use_id: str, parent: str | None = None):
        return UserMessage(content=[ToolResultBlock(tool_use_id=use_id, content="the agent's report")],
                           parent_tool_use_id=parent)

    def said(text: str):
        return AssistantMessage(content=[TextBlock(text=text)], model="m")

    def done(**kw):
        base = dict(subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
                    num_turns=2, session_id="s1")
        base.update(kw)
        return ResultMessage(**base)

    return call, calls, result, said, done


class _Pre:
    """A script item: the CLI's PreToolUse for call ``use_id``, fired at this point."""

    def __init__(self, use_id: str, name: str = "Agent") -> None:
        self.use_id, self.name = use_id, name


def _run(tmp_path: Path, script: list, *, summary: str | None = None) -> list[dict]:
    """One turn. `script` holds SDK messages and zero-argument callables; a callable runs at
    its place in the stream, which is how a subagent's write lands between its Agent call and
    the call's result."""
    from _fakes import ReplayFakeClient, attach, turn_events

    agent = real_agent.RealAgent(tmp_path)
    agent._hook_counter = {"tool_calls": 0}

    class Scripted(ReplayFakeClient):
        async def receive_response(self):
            """Each tool call fires the agent's PreToolUse seed before it is yielded, as the
            CLI's hook runs before the tool does; a `_Pre` fires it earlier still, so a write
            can land between the hook and the host reading the `tool_use`."""
            from claude_agent_sdk import AssistantMessage, ToolUseBlock

            if summary is not None:
                agent._hook_counter["completion_summary"] = summary
            fired: set[str] = set()
            for item in script:
                if isinstance(item, _Pre):
                    fired.add(item.use_id)
                    agent._seed_hand_offs({"tool_name": item.name})
                elif callable(item):
                    item()
                else:
                    if isinstance(item, AssistantMessage):
                        for block in item.content:
                            if isinstance(block, ToolUseBlock) and block.id not in fired:
                                fired.add(block.id)
                                data = {"tool_name": block.name}
                                if item.parent_tool_use_id:
                                    data["agent_id"] = "sub"
                                agent._seed_hand_offs(data)
                    yield item

    attach(agent, Scripted([]))
    return asyncio.run(turn_events(agent, "search them all"))


def _links(events: list[dict]) -> list[str]:
    return [e["text"] for e in events if e["kind"] == "text" and e["text"].startswith("Search to run")]


def test_handle_turn_posts_a_new_hand_off_link(tmp_path):
    """The acceptance check: a link a search agent logged reaches the chat, right after the
    agent's result, whatever the main thread then writes."""
    call, _calls, result, said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        call("toolu_1"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A)),
        result("toolu_1"),
        said("The probate file turned up."),
        done(),
    ])
    kinds = [e["kind"] for e in events]
    at = kinds.index("tool_result")
    assert events[at + 1]["kind"] == "text"
    assert events[at + 1]["text"] == cp.hand_off_link_text(URL_A)
    assert f"<{URL_A}>" in events[at + 1]["text"]
    assert _links(events) == [cp.hand_off_link_text(URL_A)], "posted once, not again at turn end"


def test_two_links_from_one_return_are_two_paragraphs_in_log_order(tmp_path):
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        call("toolu_1"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A), _hand_off("log_042", URL_C, site="billiongraves")),
        result("toolu_1"),
        done(),
    ])
    assert _links(events) == [cp.hand_off_link_text(URL_A), cp.hand_off_link_text(URL_C)]


def test_a_parallel_batch_posts_each_link_once_after_its_own_return(tmp_path):
    """The Hagell shape: two search agents in one batch. The second return re-sees the
    first's rows and posts only its own."""
    _call, calls, result, _said, done = _messages()
    _write_log(tmp_path)
    a, b = _hand_off("log_041", URL_A), _hand_off("log_045", URL_B, site="ancestry")
    events = _run(tmp_path, [
        calls("toolu_1", "toolu_2"),
        lambda: _write_log(tmp_path, a),
        result("toolu_1"),
        lambda: _write_log(tmp_path, a, b),
        result("toolu_2"),
        done(),
    ])
    assert _links(events) == [cp.hand_off_link_text(URL_A), cp.hand_off_link_text(URL_B)]
    kinds = [e["kind"] for e in events]
    first, second = [i for i, k in enumerate(kinds) if k == "tool_result"]
    assert URL_A in events[first + 1]["text"] and URL_B in events[second + 1]["text"]


def test_a_link_sent_again_under_a_new_id_is_posted_again(tmp_path):
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path, _hand_off("log_001", URL_A))
    events = _run(tmp_path, [
        call("toolu_1"),
        lambda: _write_log(tmp_path, _hand_off("log_001", URL_A), _hand_off("log_009", URL_A)),
        result("toolu_1"),
        done(),
    ])
    assert _links(events) == [cp.hand_off_link_text(URL_A)]


@pytest.mark.parametrize(
    ("label", "before", "after"),
    [
        ("already open when the turn began", [_hand_off("log_001", URL_A)], [_hand_off("log_001", URL_A)]),
        ("closed by a later entry for the same url", [],
         [_hand_off("log_041", URL_A), _hand_off("log_042", URL_A, outcome="error")]),
        ("a positive entry logged without a capture", [], [_hand_off("log_041", URL_A, outcome="positive")]),
        ("a capture already received", [], [_hand_off("log_041", URL_A, captured=True)]),
        ("an autonomous deferral", [], [_hand_off("log_041", URL_A, outcome="negative")]),
    ],
)
def test_no_link_is_posted(tmp_path, label, before, after):
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path, *before)
    events = _run(tmp_path, [call("toolu_1"), lambda: _write_log(tmp_path, *after), result("toolu_1"), done()])
    assert _links(events) == [], label


def test_a_hand_off_the_main_thread_logs_itself_is_posted(tmp_path):
    """`research_log_append` is allowed on the main thread (the plugin hook's
    MAIN_THREAD_OK), so a hand-off can open with no delegation at all."""
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        call("toolu_1", name="mcp__genealogy__research_log_append"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A)),
        result("toolu_1"),
        done(),
    ])
    assert _links(events) == [cp.hand_off_link_text(URL_A)]
    at = [e["kind"] for e in events].index("tool_result")
    assert events[at + 1]["text"] == cp.hand_off_link_text(URL_A), "at the call's result"


def test_a_subagents_own_calls_neither_seed_nor_post(tmp_path):
    """Only a main-thread delegation counts; a subagent's tool traffic carries a parent."""
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        call("toolu_sub", parent="toolu_outer"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A)),
        result("toolu_sub", parent="toolu_outer"),
        done(),
    ])
    assert _links(events) == []


def test_a_non_agent_tool_result_posts_nothing(tmp_path):
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        call("toolu_1", name="mcp__genealogy__project_context"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A)),
        result("toolu_1"),
        done(),
    ])
    assert _links(events) == []


def test_a_turn_with_no_delegation_never_reads_the_project(tmp_path, monkeypatch):
    """The worker's rule (worker.py, COMPLETED_LABELLED_SQL): no read a turn would pay for
    nothing. The alpha keeps it too, so the two planes behave alike."""
    _call, _calls, _result, said, done = _messages()
    reads: list[object] = []
    monkeypatch.setattr(real_agent, "read_research_json", lambda d: reads.append(d) or {})
    events = _run(tmp_path, [said("Hello."), done()])
    assert reads == []
    assert "usage" in [e["kind"] for e in events]


def test_an_unreadable_project_posts_nothing_and_the_turn_goes_on(tmp_path, monkeypatch):
    call, _calls, result, said, done = _messages()

    def boom(_dir):
        raise OSError("disk gone")

    monkeypatch.setattr(real_agent, "read_research_json", boom)
    events = _run(tmp_path, [call("toolu_1"), result("toolu_1"), said("Done."), done()])
    kinds = [e["kind"] for e in events]
    assert _links(events) == []
    assert "error" not in kinds and "usage" in kinds


def test_a_stopped_turn_posts_its_link_at_the_end(tmp_path):
    """The researcher pressed Stop while the search agent ran: its result never came back,
    but its link was logged. The sweep at the result posts it, before `usage`."""
    call, _calls, _result, _said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        call("toolu_1"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A)),
        done(is_error=True, terminal_reason="aborted_tools"),
    ])
    kinds = [e["kind"] for e in events]
    assert _links(events) == [cp.hand_off_link_text(URL_A)]
    link_at = next(i for i, e in enumerate(events) if e["kind"] == "text")
    assert link_at < kinds.index("usage")
    assert "error" not in kinds, "a Stop is not a failure"


def test_a_completion_halt_still_ends_on_its_summary(tmp_path):
    """A posted link is the host's words, not the model going on past the halt, so it must
    not clear the summary the halt ends the turn on."""
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        call("toolu_1"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A)),
        result("toolu_1"),
        done(),
    ], summary="This research is finished.")
    texts = [e["text"] for e in events if e["kind"] == "text"]
    assert texts == [cp.hand_off_link_text(URL_A), "This research is finished."]


def test_a_write_that_lands_before_the_host_reads_the_call_is_still_posted(tmp_path):
    """The race the seed's place closes: the CLI runs a fast `research_log_append` before the
    host reads its `tool_use`. The seed ran in the PreToolUse hook, before the write, so the
    row is new at the result."""
    call, _calls, result, _said, done = _messages()
    _write_log(tmp_path)
    events = _run(tmp_path, [
        _Pre("toolu_1", name="mcp__genealogy__research_log_append"),
        lambda: _write_log(tmp_path, _hand_off("log_041", URL_A)),
        call("toolu_1", name="mcp__genealogy__research_log_append"),
        result("toolu_1"),
        done(),
    ])
    assert _links(events) == [cp.hand_off_link_text(URL_A)]


def test_an_unparseable_project_is_not_read_as_empty(tmp_path):
    """A research.json that will not parse (a BOM, a hand edit) is "could not read": the turn
    stays unseeded, and the hand-off already open is not posted again once the file reads."""
    call, _calls, result, _said, done = _messages()
    (tmp_path / "research.json").write_bytes(b"\xef\xbb\xbf" + json.dumps(
        {"project": {"status": "active"}, "log": [_hand_off("log_001", URL_A)]}).encode("utf-8"))
    events = _run(tmp_path, [
        call("toolu_1"),
        lambda: _write_log(tmp_path, _hand_off("log_001", URL_A)),
        result("toolu_1"),
        done(),
    ])
    assert _links(events) == []


def test_the_seed_hook_is_wired_for_every_call_that_can_open_a_hand_off(tmp_path):
    import re

    class Matcher:
        def __init__(self, matcher=None, hooks=(), timeout=None):
            self.matcher, self.hooks = matcher, list(hooks)

    agent = real_agent.RealAgent(tmp_path)
    hooks = real_agent._build_hooks(Matcher, tmp_path, agent)
    [seed] = [m for m in hooks["PreToolUse"] if any(h.__name__ == "hand_off_seed" for h in m.hooks)]
    for tool in ("Agent", "Task", "mcp__genealogy__research_log_append",
                 "mcp__remote-devices__Genealogy_Research__build_external_search_url"):
        assert re.search(seed.matcher, tool), tool
    for tool in ("Read", "mcp__genealogy__record_search", "AgentX", "mcp__genealogy__research_log_append_v2"):
        assert not re.search(seed.matcher, tool), tool

    _write_log(tmp_path, _hand_off("log_001", URL_A))
    agent._hand_off_links = cp.HandOffLinks()
    asyncio.run(seed.hooks[0]({"tool_name": "Agent", "agent_id": "sub"}, "t0", None))
    assert not agent._hand_off_links.seeded, "a subagent's call does not seed"
    assert asyncio.run(seed.hooks[0]({"tool_name": "Agent"}, "t1", None)) == {}
    assert agent._hand_off_links.seen == {"log_001"}
