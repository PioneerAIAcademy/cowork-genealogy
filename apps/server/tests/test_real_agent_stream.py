"""Streaming + subagent attribution in RealAgent.map_message.

Two properties this file exists to hold:

**Subagent turns are labelled.** The SDK does not nest a subagent's messages —
it emits them on the same stream, tagged with ``parent_tool_use_id``. Read that
and a record-extractor's tool calls are attributable; ignore it (as we did) and
they land in the parent's bubble looking like the orchestrator's own work.

**Delta events never reach the transcript.** ``include_partial_messages`` turns
one assistant message into hundreds of deltas. They are live-only; recording
them would evict the real conversation from the capped replay buffer within a
single streamed turn, so a reconnect would rebuild an empty chat.
"""

from claude_agent_sdk import (
    AssistantMessage,
    StreamEvent,
    TaskNotificationMessage,
    TaskProgressMessage,
    TaskStartedMessage,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
)

from app.agent.real_agent import TRANSIENT_KINDS, map_message


def _task_started(tool_use_id="tu_1", description="record-extractor"):
    return TaskStartedMessage(
        subtype="task_started", data={}, task_id="t1", description=description,
        uuid="u1", session_id="s1", tool_use_id=tool_use_id,
    )


def test_task_started_registers_the_label_and_announces_the_subagent():
    tasks: dict[str, str] = {}
    out = map_message(_task_started(), {}, tasks)

    assert out == [{"kind": "task_started", "agent": "record-extractor", "task_id": "t1"}]
    # The label is retained so later messages carrying this parent id resolve.
    assert tasks["tu_1"] == "record-extractor"


def test_subagent_blocks_are_attributed_to_the_running_task():
    tasks: dict[str, str] = {}
    map_message(_task_started(), {}, tasks)

    sub = AssistantMessage(
        content=[ToolUseBlock(id="b1", name="person_read", input={"personId": "X"})],
        model="claude-sonnet-4-6", parent_tool_use_id="tu_1",
    )
    (ev,) = map_message(sub, {}, tasks)
    assert ev["kind"] == "tool_use" and ev["agent"] == "record-extractor"


def test_subagent_text_and_thinking_blocks_carry_the_agent_label():
    """The web fold drops labelled prose (chatEvents.ts: subagent text never
    reaches the chat), so the label has to be on TextBlock and ThinkingBlock
    too, not only on the tool chips the older tests cover."""
    tasks: dict[str, str] = {}
    map_message(_task_started(), {}, tasks)

    sub = AssistantMessage(
        content=[
            TextBlock(text="Found 12 assertions in the household."),
            ThinkingBlock(thinking="Now checking the ages.", signature="sig"),
        ],
        model="m", parent_tool_use_id="tu_1",
    )
    out = map_message(sub, {}, tasks)
    assert [e["kind"] for e in out] == ["text", "thinking"]
    assert all(e["agent"] == "record-extractor" for e in out)


def test_main_agent_blocks_carry_no_agent_label():
    """Absence of the field is what the UI keys on — an unlabelled chip is the
    main agent's, so a stray label would misattribute the orchestrator's work."""
    tasks: dict[str, str] = {}
    map_message(_task_started(), {}, tasks)

    main = AssistantMessage(content=[TextBlock(text="hi")], model="m", parent_tool_use_id=None)
    (ev,) = map_message(main, {}, tasks)
    assert "agent" not in ev


def test_task_progress_reports_what_the_subagent_is_doing_now():
    """This is the payload behind the status line — the answer to "what is
    record extraction doing?" that a bare elapsed-seconds spinner cannot give."""
    msg = TaskProgressMessage(
        subtype="task_progress", data={}, task_id="t1", description="record-extractor",
        usage={"total_tokens": 5000, "tool_uses": 12, "duration_ms": 90000},
        uuid="u", session_id="s", tool_use_id="tu_1", last_tool_name="person_read",
    )
    (ev,) = map_message(msg, {}, {})
    assert ev["kind"] == "task_progress"
    assert ev["agent"] == "record-extractor"
    assert ev["last_tool"] == "person_read"
    assert ev["tool_uses"] == 12


def test_task_done_releases_the_label():
    tasks: dict[str, str] = {}
    map_message(_task_started(), {}, tasks)
    msg = TaskNotificationMessage(
        subtype="task_notification", data={}, task_id="t1", status="completed",
        output_file="/tmp/o", summary="extracted 18 assertions", uuid="u",
        session_id="s", tool_use_id="tu_1",
    )
    (ev,) = map_message(msg, {}, tasks)

    assert ev["kind"] == "task_done" and ev["status"] == "completed"
    assert ev["agent"] == "record-extractor"
    assert "tu_1" not in tasks, "a finished task must not keep labelling later events"


def test_stream_events_become_content_deltas():
    text = StreamEvent(uuid="u", session_id="s", event={
        "type": "content_block_delta", "delta": {"type": "text_delta", "text": "Charl"}})
    thinking = StreamEvent(uuid="u", session_id="s", event={
        "type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "weigh"}})

    assert map_message(text, {}, {}) == [{"kind": "text_delta", "text": "Charl"}]
    assert map_message(thinking, {}, {}) == [{"kind": "thinking_delta", "text": "weigh"}]


def test_non_content_stream_events_are_dropped():
    """Block start/stop and message_delta add nothing the canonical block event
    does not already carry; forwarding them is pure wire noise."""
    for raw in ({"type": "content_block_start"}, {"type": "message_delta"}, {}):
        assert map_message(StreamEvent(uuid="u", session_id="s", event=raw), {}, {}) == []


def test_every_streaming_kind_is_marked_transient():
    """The guard that keeps the replay buffer intact: if map_message learns to
    emit a new high-frequency kind, it must be added to TRANSIENT_KINDS or the
    pump will record it and evict the conversation.
    """
    streamed = StreamEvent(uuid="u", session_id="s", event={
        "type": "content_block_delta", "delta": {"type": "text_delta", "text": "x"}})
    progress = TaskProgressMessage(
        subtype="task_progress", data={}, task_id="t", description="d",
        usage={"total_tokens": 1, "tool_uses": 1, "duration_ms": 1},
        uuid="u", session_id="s",
    )
    for msg in (streamed, progress):
        for ev in map_message(msg, {}, {}):
            assert ev["kind"] in TRANSIENT_KINDS

    # ...and the recorded kinds must NOT be transient, or the transcript empties.
    block = AssistantMessage(content=[TextBlock(text="done")], model="m", parent_tool_use_id=None)
    for ev in map_message(block, {}, {}):
        assert ev["kind"] not in TRANSIENT_KINDS


# --- task_id on every subagent event (phase 2 item 3) ---
#
# Attribution today is the Task's DESCRIPTION STRING, not an id, and descriptions
# repeat: in the captured session five labels were each used by two different tasks
# (docs/captures/2026-09-29-mcandrew-children/). So "which step produced this
# paragraph" cannot be answered from the stream, and anchoring cannot be built on it.
#
# The id map is an OPTIONAL parameter: every existing caller keeps working unchanged
# and simply gets no task_id, which is what makes this safe to add.

def test_subagent_events_carry_the_task_id_when_the_map_is_supplied():
    tasks: dict[str, str] = {}
    task_ids: dict[str, str] = {}
    map_message(_task_started(), {}, tasks, task_ids=task_ids)

    sub = AssistantMessage(
        content=[ToolUseBlock(id="b1", name="person_read", input={"personId": "X"})],
        model="claude-sonnet-4-6", parent_tool_use_id="tu_1",
    )
    (ev,) = map_message(sub, {}, tasks, task_ids=task_ids)
    assert ev["agent"] == "record-extractor"
    assert ev["task_id"] == "t1", "the id is what disambiguates two tasks sharing a label"


def test_two_tasks_sharing_a_description_are_told_apart_by_id():
    """The shape that makes the label useless on its own."""
    tasks: dict[str, str] = {}
    task_ids: dict[str, str] = {}
    first = TaskStartedMessage(
        subtype="task_started", data={}, task_id="t1", description="record-extractor",
        uuid="u1", session_id="s1", tool_use_id="tu_1",
    )
    second = TaskStartedMessage(
        subtype="task_started", data={}, task_id="t2", description="record-extractor",
        uuid="u2", session_id="s1", tool_use_id="tu_2",
    )
    map_message(first, {}, tasks, task_ids=task_ids)
    map_message(second, {}, tasks, task_ids=task_ids)

    def ev_for(parent):
        msg = AssistantMessage(
            content=[ToolUseBlock(id="b", name="person_read", input={})],
            model="claude-sonnet-4-6", parent_tool_use_id=parent,
        )
        (e,) = map_message(msg, {}, tasks, task_ids=task_ids)
        return e

    a, b = ev_for("tu_1"), ev_for("tu_2")
    assert a["agent"] == b["agent"] == "record-extractor"
    assert a["task_id"] == "t1" and b["task_id"] == "t2"


def test_omitting_the_id_map_leaves_every_existing_caller_unchanged():
    tasks: dict[str, str] = {}
    map_message(_task_started(), {}, tasks)
    sub = AssistantMessage(
        content=[ToolUseBlock(id="b1", name="person_read", input={})],
        model="claude-sonnet-4-6", parent_tool_use_id="tu_1",
    )
    (ev,) = map_message(sub, {}, tasks)
    assert ev["agent"] == "record-extractor"
    assert "task_id" not in ev, "no map supplied -> no id stamped, and nothing breaks"


# --- The decision card needs the options, not a 160-char summary (phase 3 item 1) ---
#
# `_tool_summary` flattens a tool's input to its first four keys, truncated to 160
# characters. For AskUserQuestion that mangles the questions array into an unusable
# string -- measured in the committed corpus, where `questions` arrives cut off
# mid-word. A card showing candidates side by side cannot be built from it.
#
# So the decision tool, and only it, carries its input structured alongside the
# summary. Every other tool is untouched: the summary is what chips render, and
# widening it for all tools would put whole record payloads on the wire.

def _ask(questions):
    return AssistantMessage(
        content=[ToolUseBlock(id="b1", name="AskUserQuestion", input={"questions": questions})],
        model="claude-sonnet-4-6",
    )


QS = [{
    "question": "Which Mary Hales?",
    "header": "Person",
    "options": [
        {"label": "Mary Hales of Ohio (Recommended)", "description": "b. 1832, matches the census"},
        {"label": "Mary Hales of Indiana", "description": "b. 1841, weaker match"},
    ],
}]


def test_the_decision_tool_carries_its_questions_structured():
    (ev,) = map_message(_ask(QS), {}, {})
    assert ev["kind"] == "tool_use" and ev["tool"] == "AskUserQuestion"
    assert ev["questions"] == QS, "the card needs the options, not a truncated string"


def test_the_summary_is_still_there_for_the_chip():
    (ev,) = map_message(_ask(QS), {}, {})
    assert ev["summary"], "the chip still renders a summary as it does for every tool"


def test_every_other_tool_is_left_alone():
    """Widening this for all tools would put whole record payloads on the wire."""
    msg = AssistantMessage(
        content=[ToolUseBlock(id="b1", name="record_read", input={"ark": "x", "big": "y" * 500})],
        model="claude-sonnet-4-6",
    )
    (ev,) = map_message(msg, {}, {})
    assert "questions" not in ev


def test_a_malformed_ask_does_not_break_the_stream():
    """A hook that raises ends the turn; so does an event builder. A decision whose
    input is not the shape we expect must still produce a chip."""
    for bad in ({"questions": "not a list"}, {}, {"questions": []}):
        msg = AssistantMessage(
            content=[ToolUseBlock(id="b1", name="AskUserQuestion", input=bad)],
            model="claude-sonnet-4-6",
        )
        (ev,) = map_message(msg, {}, {})
        assert ev["kind"] == "tool_use"
        assert "questions" not in ev, "only a well-formed list is carried"
