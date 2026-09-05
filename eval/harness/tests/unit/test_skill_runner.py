"""Smoke tests for harness.skill_runner. The real-API integration is in e2e."""

from harness import skill_runner


def test_constants_present():
    assert "Read" in skill_runner.BASELINE_ALLOWED
    assert "Skill" in skill_runner.BASELINE_ALLOWED
    assert "Bash" in skill_runner.DISALLOWED_BACKSTOP
    assert skill_runner.DEFAULT_MODEL.startswith("claude-")


def test_task_allowed_for_agent_delegation():
    """Task moved out of the backstop (agent-mode): plugin subagents are
    staged into every workspace and a skill delegates only when its
    SKILL.md instructs it — matching the e2e orchestrator's baseline."""
    assert "Task" in skill_runner.BASELINE_ALLOWED
    assert "Task" not in skill_runner.DISALLOWED_BACKSTOP


def test_sdk_version_probe_silent_on_pinned_version():
    """0.1.81 is within the known-good range — probe returns None."""
    from harness.skill_runner import _check_sdk_version
    assert _check_sdk_version() is None


def test_sdk_version_probe_warns_on_future_major(monkeypatch):
    """When the installed SDK is outside the known-good range, return
    a stderr-bound warning string so the operator can verify disallowed_tools."""
    import harness.skill_runner as sr

    def fake_version(_pkg):
        return "0.2.0"

    monkeypatch.setattr(
        "importlib.metadata.version", fake_version, raising=False
    )
    # The function imports inside; patch where it's called from.
    monkeypatch.setattr(sr, "_check_sdk_version", sr._check_sdk_version)
    # Re-run the check with the monkeypatched version.
    warning = sr._check_sdk_version()
    assert warning is not None
    assert "0.2.0" in warning
    assert "disallowed_tools" in warning


def test_classify_exception_abort_reason_matches_max_turns_phrasing():
    """A bare exception carrying the SDK's own max_turns wording is
    classified as the deterministic 'max_turns' reason, not the generic
    (retryable) 'error' bucket — regression test for the misclassification
    that caused ut_proof_conclusion_016 to burn a wasted retry attempt."""
    from harness.skill_runner import _classify_exception_abort_reason

    exc = Exception(
        "Claude Code returned an error result: Reached maximum number of turns (30)"
    )
    assert _classify_exception_abort_reason(exc) == "max_turns"


def test_classify_exception_abort_reason_defaults_to_error():
    from harness.skill_runner import _classify_exception_abort_reason

    exc = Exception("connection reset by peer")
    assert _classify_exception_abort_reason(exc) == "error"


def test_skill_run_result_shape():
    r = skill_runner.SkillRunResult(
        text_response="hi",
        skills_invoked=[],
        tool_calls=[],
        duration_ms=1.0,
        usage={},
    )
    assert r.text_response == "hi"
    assert r.aborted_reason is None
    assert r.error is None
    # WS1: attempted_mcp_calls defaults to an empty list — every caller
    # that constructs SkillRunResult directly (stubs, tests) gets the
    # field for free, and the orchestrator's uncovered-call gate reads it.
    assert r.attempted_mcp_calls == []
    assert r.unread_skill_calls == []
    assert r.builtin_tool_calls == []


def test_builtin_call_record_captures_a_read():
    """The blind spot this closes: a Read left no trace anywhere, so a
    subagent that skipped its reference file looked identical to one that
    read it (issue #702)."""
    from harness.skill_runner import builtin_call_record

    record = builtin_call_record(
        "Read", {"tool_input": {"file_path": "/p/references/probate.md"}}
    )
    assert record == {
        "tool": "Read",
        "args": {"file_path": "/p/references/probate.md"},
    }


def test_builtin_call_record_ignores_mcp_calls():
    """MCP calls are already recorded twice (tool_calls, attempted_mcp_calls);
    recording them a third time would double-count the uncovered-call gate."""
    from harness.skill_runner import builtin_call_record

    assert builtin_call_record(
        "mcp__genealogy__record_read", {"tool_input": {"recordId": "x"}}
    ) is None


def test_builtin_call_record_keeps_agent_id_when_inside_a_subagent():
    """`agent_id` is present only inside a Task-spawned subagent, so it is
    what distinguishes the extractor agent reading a file from the main
    thread reading it — the question a delegated-reference design asks."""
    from harness.skill_runner import builtin_call_record

    record = builtin_call_record(
        "Read",
        {
            "tool_input": {"file_path": "/p/x.md"},
            "agent_id": "record-extractor-1",
        },
    )
    assert record["agent_id"] == "record-extractor-1"
    # Main-thread calls carry no agent_id, and the key is omitted rather
    # than set to None so the schema can forbid unknown/null shapes.
    main = builtin_call_record("Read", {"tool_input": {"file_path": "/p/x.md"}})
    assert "agent_id" not in main


def test_builtin_call_record_truncates_long_arguments():
    """Run logs are committed; an untruncated Write argument would carry a
    whole file body into the corpus."""
    from harness.skill_runner import builtin_call_record, BUILTIN_ARG_TRUNCATE

    record = builtin_call_record(
        "Write", {"tool_input": {"content": "x" * 5000}}
    )
    assert len(record["args"]["content"]) == BUILTIN_ARG_TRUNCATE


class _HookDrivingStream:
    """An async message stream that first drives the registered PreToolUse hook
    with scripted inputs, then yields its messages so run_skill completes."""

    def __init__(self, hook, hook_inputs, messages, returns=None):
        self._hook = hook
        self._hook_inputs = hook_inputs
        self._messages = messages
        self._started = False
        self._i = 0
        # Optional sink for what the hook RETURNED per input. A deny is only
        # visible in the return value, so a test asserting on the deny needs
        # this; widened rather than copied (issue #2022 review).
        self._returns = returns

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._started:
            self._started = True
            for inp in self._hook_inputs:
                out = await self._hook(inp, "tool-use-id", None)
                if self._returns is not None:
                    self._returns.append(out)
        if self._i >= len(self._messages):
            raise StopAsyncIteration
        msg = self._messages[self._i]
        self._i += 1
        return msg

    async def aclose(self):
        return None


def test_run_skill_collects_builtin_calls_through_the_real_hook(tmp_path, monkeypatch):
    """The tests above prove the RECORD; this proves the WIRING.

    Deleting the hook's two collection lines leaves every other test green
    while `builtin_tool_calls` stays empty — and because run_output omits the
    field when empty, a broken collector writes byte-identical output to a run
    that genuinely called no built-in tool. That is the exact ambiguity this
    field exists to remove, so the collection needs a test that fails when it
    is gone.

    The orchestrator's `run_output` spread stays covered-by-inspection, as
    `file_changes` and `warnings` already are — same boundary
    test_e2e_context_block.py draws around the `blocked_context_calls=` kwarg.
    """
    import asyncio

    from claude_agent_sdk import ResultMessage

    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(
            hook,
            [
                # Inside the extractor subagent — carries agent_id.
                {
                    "tool_name": "Read",
                    "tool_input": {"file_path": "/p/references/probate.md"},
                    "agent_id": "agent-record-extractor",
                },
                # Main thread — the SDK omits agent_id entirely.
                {
                    "tool_name": "Read",
                    "tool_input": {"file_path": "/p/research.json"},
                },
                # MCP calls are recorded elsewhere and must not land here.
                {
                    "tool_name": "mcp__genealogy__record_read",
                    "tool_input": {"recordId": "x"},
                },
            ],
            [
                ResultMessage(
                    subtype="result",
                    duration_ms=1,
                    duration_api_ms=1,
                    is_error=False,
                    num_turns=1,
                    session_id="S1",
                )
            ],
        )

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(
                skill_runner_mode="api_key", api_key="x", detail="stub"
            ),
        )
    )

    assert result.builtin_tool_calls == [
        {
            "tool": "Read",
            "args": {"file_path": "/p/references/probate.md"},
            "agent_id": "agent-record-extractor",
        },
        {"tool": "Read", "args": {"file_path": "/p/research.json"}},
    ]


def test_the_result_messages_ledger_reaches_the_key_skill_tokens_reads(
    tmp_path, monkeypatch
):
    """Both halves of the token seam, spelled once, against a real ResultMessage.

    `run_skill` writes the ledger under a key and `_skill_tokens` reads it back
    out; each was tested against its own hand-built dict, so the two spelled it
    independently. Renaming the key here leaves the whole suite green — the
    reader silently falls back to `usage`, which is the defect the ledger read
    exists to fix. The `usage` block below deliberately disagrees with the
    ledger, so a fallback cannot pass by coincidence.
    """
    import asyncio

    from claude_agent_sdk import ResultMessage

    from harness import skill_runner as sr
    from harness.auth import AuthConfig
    from harness.orchestrator import _skill_tokens

    ledger = {
        "claude-opus-5": {
            "inputTokens": 100,
            "outputTokens": 2_000,
            "cacheReadInputTokens": 1_000,
            "cacheCreationInputTokens": 500,
        },
        "claude-sonnet-4-6": {
            "inputTokens": 50,
            "outputTokens": 8_000,
            "cacheReadInputTokens": 900,
            "cacheCreationInputTokens": 400,
        },
    }

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(
            hook,
            [],
            [
                ResultMessage(
                    subtype="result",
                    duration_ms=1,
                    duration_api_ms=1,
                    is_error=False,
                    num_turns=1,
                    session_id="S1",
                    total_cost_usd=1.0,
                    usage={"input_tokens": 1, "output_tokens": 1},
                    model_usage=ledger,
                )
            ],
        )

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(
                skill_runner_mode="api_key", api_key="x", detail="stub"
            ),
        )
    )

    # The subagent's 8,000 output tokens are the ones that used to vanish.
    assert _skill_tokens(result.usage) == (150, 1_900, 900, 10_000, ledger)


def test_read_skill_tool_input_reads_the_documented_key():
    """"skill" is the claude-agent-sdk 0.1.81 contract."""
    from harness.skill_runner import read_skill_tool_input

    assert read_skill_tool_input({"skill": "timeline"}) == ("timeline", [])


def test_read_skill_tool_input_falls_back_to_name():
    from harness.skill_runner import read_skill_tool_input

    assert read_skill_tool_input({"name": "timeline"}) == ("timeline", [])


def test_read_skill_tool_input_prefers_skill_over_name():
    from harness.skill_runner import read_skill_tool_input

    got, unread = read_skill_tool_input({"name": "wrong", "skill": "timeline"})
    assert (got, unread) == ("timeline", [])


def test_read_skill_tool_input_reports_keys_it_cannot_read():
    """The SDK-drift signal. If the Skill tool moves the name to a key we
    don't read, the name must come back None WITH the keys that were there —
    otherwise skills_invoked silently undercounts and every routing verdict
    reads as "never activated" with nothing anywhere saying why."""
    from harness.skill_runner import read_skill_tool_input

    got, unread = read_skill_tool_input({"skill_name": "timeline", "args": {}})
    assert got is None
    assert unread == ["args", "skill_name"]


def test_read_skill_tool_input_treats_an_empty_name_as_unread():
    """A present-but-empty key is drift too, not an invocation."""
    from harness.skill_runner import read_skill_tool_input

    got, unread = read_skill_tool_input({"skill": ""})
    assert got is None
    assert unread == ["skill"]


# --- wall-clock timeout records the turns actually streamed (#1626 review) ---


def _fake_assistant_message(text):
    """Minimal stand-in for the SDK's AssistantMessage with one TextBlock."""
    from claude_agent_sdk import AssistantMessage, TextBlock
    return AssistantMessage(content=[TextBlock(text=text)], model="stub")


def _run_until_timeout(monkeypatch, tmp_path, *, turns):
    """Drive the REAL run_skill timeout path: stream `turns` assistant
    messages, then hang until the wall clock fires.

    Deliberately not a hand-built SkillRunResult. `usage` is populated only in
    the ResultMessage branch, so a fabricated result can carry field
    combinations this code path can never emit — which is exactly how the
    first version of the zero-progress retry guard passed its tests while
    being blind in production.
    """
    import asyncio
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    async def fake_query(*, prompt, options):
        for i in range(turns):
            yield _fake_assistant_message(f"turn {i}")
        await asyncio.sleep(3600)  # hang until the wall clock fires

    monkeypatch.setattr(sr, "query", fake_query)
    monkeypatch.setattr(
        sr, "create_mock_server", lambda *a, **kw: (None, [], {})
    )

    return asyncio.run(
        sr.run_skill(
            user_message="x",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            max_wall_clock_seconds=1,
        )
    )


def test_timeout_records_zero_turns_when_the_run_never_started(monkeypatch, tmp_path):
    """The 2026-08-15 stall: the budget elapses without a single assistant
    message. This is what the orchestrator retries."""
    result = _run_until_timeout(monkeypatch, tmp_path, turns=0)
    assert result.aborted_reason == "max_wall_clock_seconds"
    assert result.usage.get("num_turns") == 0


def test_timeout_records_the_turns_a_slow_run_did_produce(monkeypatch, tmp_path):
    """A run that worked and then ran out of clock must report its turns —
    otherwise it is indistinguishable from a startup stall and gets retried,
    burning the full cap once per attempt at 3x the tokens."""
    result = _run_until_timeout(monkeypatch, tmp_path, turns=4)
    assert result.aborted_reason == "max_wall_clock_seconds"
    assert result.usage.get("num_turns") == 4


# --- the ownership deny, driven through the real hook (issue #2022) ----------
#
# These replace a source-grep guard that was green under two mutations its own
# message named: `body.index()` searched to EOF, so deleting the arm and leaving
# a comment that mentioned both calls satisfied it, and so did keeping the call
# while dropping the `return`. The guard's stated reason was also false --
# `_HookDrivingStream` above drives this exact closure, and has since it was
# written (@chesworthrm).


def _ownership_payload(section):
    """A `research_append` op from the proof-conclusion agent. `conflicts` is
    outside its lane ({proof_summaries, questions, project})."""
    return {
        "tool_name": "mcp__genealogy__research_append",
        "tool_input": {"ops": [{"op": "append", "section": section, "entry": {"x": 1}}]},
        "agent_id": "agent-proof-conclusion",
        "agent_type": "proof-conclusion",
    }


def _drive_hook(tmp_path, monkeypatch, hook_inputs, max_tool_calls=None):
    """Run run_skill with the given PreToolUse inputs; return (result, returns)."""
    import asyncio

    from claude_agent_sdk import ResultMessage

    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    returns = []

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(
            hook,
            hook_inputs,
            [
                ResultMessage(
                    subtype="result",
                    duration_ms=1,
                    duration_api_ms=1,
                    is_error=False,
                    num_turns=1,
                    session_id="S1",
                )
            ],
            returns=returns,
        )

    monkeypatch.setattr(sr, "query", fake_query)
    kwargs = dict(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    if max_tool_calls is not None:
        kwargs["max_tool_calls"] = max_tool_calls
    return asyncio.run(sr.run_skill(**kwargs)), returns


def test_an_out_of_lane_append_is_denied_and_recorded(tmp_path, monkeypatch):
    """The deny must both RETURN a deny payload and land on the result.

    Deleting the arm, or keeping the call and dropping the `return`, fails this
    -- neither of which the source-grep guard caught.
    """
    result, returns = _drive_hook(tmp_path, monkeypatch, [_ownership_payload("conflicts")])

    assert returns and returns[0] is not None, "the hook allowed an out-of-lane append"
    decision = returns[0]["hookSpecificOutput"]["permissionDecision"]
    assert decision == "deny", f"expected a deny, got {decision!r}"

    assert len(result.blocked_owned_section_writes) == 1, (
        "the denied attempt was not recorded on SkillRunResult, so the gating "
        "validator sees nothing and the run grades clean"
    )
    recorded = result.blocked_owned_section_writes[0]
    assert recorded["section"] == "conflicts"
    assert recorded["caller"] == "proof-conclusion"


def test_an_in_lane_append_is_not_denied(tmp_path, monkeypatch):
    """The polarity control. proof_summaries is the agent's OWN section, and a
    deny there would fail every test in that skill's suite."""
    result, returns = _drive_hook(
        tmp_path, monkeypatch, [_ownership_payload("proof_summaries")]
    )
    assert returns[0] is None or returns[0].get("hookSpecificOutput", {}).get(
        "permissionDecision"
    ) != "deny", "the owner's own section was denied"
    assert result.blocked_owned_section_writes == []


def test_a_denied_call_does_not_consume_the_max_tool_calls_budget(
    tmp_path, monkeypatch
):
    """Pins the ORDERING behaviourally rather than by source position.

    A denied call never executes, so it must not spend budget. With
    max_tool_calls=1, a denied append followed by one real call must not abort:
    if the ownership deny sits after the counter, the denied call consumes the
    single slot and the second call trips the cap.
    """
    result, _ = _drive_hook(
        tmp_path,
        monkeypatch,
        [
            _ownership_payload("conflicts"),
            {
                "tool_name": "mcp__genealogy__research_query",
                "tool_input": {"section": "questions"},
            },
        ],
        max_tool_calls=1,
    )
    assert result.aborted_reason is None, (
        "a denied call consumed the max_tool_calls budget: the ownership deny "
        f"is being checked after the counter (aborted_reason={result.aborted_reason!r})"
    )
