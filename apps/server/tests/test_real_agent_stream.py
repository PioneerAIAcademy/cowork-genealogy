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
