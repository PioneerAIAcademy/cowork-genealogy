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


def test_builtin_call_record_does_not_truncate_the_agent_prompt():
    """Issue #2189/#2020: the Agent tool's `prompt` is the delegation contract
    between a routing skill and its agent, not a Read/Grep/Write argument —
    200 chars keeps a greeting and drops the contract. Measured at 4a6cfad44
    over the five committed record-extraction run logs
    (`git ls-files eval/runlogs/unit/record-extraction`, no `.ann.json`): 143
    of 145 Agent prompts were exactly 200 characters long."""
    from harness.skill_runner import builtin_call_record, BUILTIN_ARG_TRUNCATE

    record = builtin_call_record(
        "Agent", {"tool_input": {"prompt": "x" * 5000}}
    )
    assert len(record["args"]["prompt"]) == 5000

    # The exemption is scoped to (Agent, prompt), not to the whole tool: a
    # sibling key on the same call still gets the cap that protects the
    # committed corpus from whole-argument bodies.
    record = builtin_call_record(
        "Agent", {"tool_input": {"description": "x" * 5000}}
    )
    assert len(record["args"]["description"]) == BUILTIN_ARG_TRUNCATE


class _HookDrivingStream:
    """An async message stream that first drives the registered PreToolUse hook
    with scripted inputs, then yields its messages so run_skill completes."""

    def __init__(self, hook, hook_inputs, messages, returns=None, hook_tool_use_id="tool-use-id"):
        self._hook = hook
        self._hook_inputs = hook_inputs
        self._messages = messages
        self._started = False
        self._i = 0
        # Optional sink for what the hook RETURNED per input. A deny is only
        # visible in the return value, so a test asserting on the deny needs
        # this; widened rather than copied (issue #2022 review).
        self._returns = returns
        # The SDK's own hook request type carries `tool_use_id: str | None` —
        # defaults to the fixed id every other test in this file keys its
        # ToolUseBlock on, but a test proving the tool_use_id-absent fallback
        # needs to drive the hook with None instead (review of #2189, round 4).
        self._hook_tool_use_id = hook_tool_use_id

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._started:
            self._started = True
            for inp in self._hook_inputs:
                out = await self._hook(inp, self._hook_tool_use_id, None)
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


def _rule_payload(section, caller, entry=None, op="append"):
    """A `research_append` op parameterised by SECTION and CALLER.

    `_ownership_payload` above hardcodes `proof-conclusion` and varies only the
    section, so all three tests before this one drive the `out_of_lane` rule.
    Narrowing the recorded arm to `denied[1] == "out_of_lane"` left the whole
    suite at baseline, so `routed` and `declaration` passed through the hook with
    nothing watching (@clack391) — while guardrail-enforcement-spec.md names this
    validator as what gates the first and claims the second binds here too.

    What was unguarded is the hook PASS-THROUGH on this plane, not the
    predicate's decision: both rules are covered by direct `owner_denied` calls
    in test_universal_owned_sections.py, and the e2e closure is hook-driven in
    test_e2e_context_block.py.
    """
    o = {"op": op, "section": section, "entry": entry or {"x": 1}}
    return {
        "tool_name": "mcp__genealogy__research_append",
        "tool_input": {"ops": [o]},
        "agent_id": "agent-abc123",
        "agent_type": caller,
    }


def test_the_routed_arm_is_driven_through_the_real_hook(tmp_path, monkeypatch):
    """`proof_summaries` reached by an agent that does not own it: 47 of 133
    committed e2e runs wrote one without launching the owning skill."""
    result, returns = _drive_hook(
        tmp_path, monkeypatch, [_rule_payload("proof_summaries", "record-extractor")]
    )
    assert returns[0] is not None, "the routed arm allowed the write"
    assert returns[0]["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert [
        (c["section"], c["rule"]) for c in result.blocked_owned_section_writes
    ] == [("proof_summaries", "routed")]


def test_the_declaration_arm_is_driven_through_the_real_hook(tmp_path, monkeypatch):
    """A routed CLAIM, field-scoped, whose section is the dotted form that keys
    neither owner map — the arm where branching on the section's shape rather
    than on `rule` raises KeyError."""
    result, returns = _drive_hook(
        tmp_path,
        monkeypatch,
        [
            _rule_payload(
                "questions",
                "proof-conclusion",
                entry={"exhaustive_declaration": {"declared": True}},
            )
        ],
    )
    assert returns[0] is not None, "the declaration arm allowed the claim"
    assert returns[0]["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert [
        (c["section"], c["rule"]) for c in result.blocked_owned_section_writes
    ] == [("questions.exhaustive_declaration", "declaration")]


# --- routing short-circuit: the hand-off message must not be dropped (#2189) ---
#
# _HookDrivingStream drives every scripted hook input to completion BEFORE
# yielding any message (see its __anext__ above). For a short-circuit skill
# that deterministically reproduces the race's worst case: routing_resolved
# is already True before the very message that caused it is ever delivered to
# the consumer loop — the same ordering the real SDK produces in the majority
# of negative runs, per the corpus measurement in issue #2189.


def _routing_short_circuit_stream(tool_use_id="tool-use-id"):
    """A Skill hook-input for `record-extraction`, and the AssistantMessage
    that (in the real SDK) carries both the hand-off narration and the tool
    use in the same turn.

    `tool_use_id` defaults to "tool-use-id" to match _HookDrivingStream's own
    hardcoded id (see its __anext__ above) — the source's short-circuit now
    keys the stop point on this id actually appearing in the ToolUseBlock, so
    the two must agree or the hook's deny is never recognized as belonging to
    this message.
    """
    from claude_agent_sdk import AssistantMessage, TextBlock, ToolUseBlock

    hook_inputs = [{"tool_name": "Skill", "tool_input": {"skill": "record-extraction"}}]
    handoff_message = AssistantMessage(
        content=[
            TextBlock(text="Routing this to record-extraction."),
            ToolUseBlock(
                id=tool_use_id,
                name="Skill",
                input={"skill": "record-extraction"},
            ),
        ],
        model="stub",
    )
    return hook_inputs, handoff_message


async def _run_short_circuit_with_prefix(monkeypatch, tmp_path, prefix):
    """Like `_run_short_circuit`, but yields `prefix` BEFORE the hand-off.

    `_HookDrivingStream` drives every hook input before message one, so the
    plain helper can only ever produce the ordering where the flag is already
    up and the very first message carries the routed call. Both new guards —
    the `if not usage:` check and the `tool_use_id` match — are no-ops under
    that ordering, so a test built on it cannot tell whether either is there
    (review of #2189, round 2: both mutations left all 46 tests green).
    """
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    hook_inputs, handoff_message = _routing_short_circuit_stream()

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(hook, hook_inputs, [*prefix, handoff_message])

    monkeypatch.setattr(sr, "query", fake_query)
    return await sr.run_skill(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        routing_short_circuit_skills={"record-extraction"},
    )


def test_a_result_message_already_seen_keeps_its_real_telemetry(tmp_path, monkeypatch):
    """The `if not usage:` guard, isolated.

    A ResultMessage consumed before the hand-off populates `usage` with the
    SDK's own count. The short-circuit must not overwrite it, and must not
    claim no ResultMessage arrived. Without the guard `num_turns` becomes the
    manufactured `turns_seen` and `no_result_message` lies — the same
    self-contradicting telemetry this PR exists to remove, pointing the other
    way.
    """
    import asyncio
    from claude_agent_sdk import ResultMessage

    early = ResultMessage(
        subtype="result", duration_ms=1, duration_api_ms=1,
        is_error=False, num_turns=7, session_id="S1",
    )
    result = asyncio.run(_run_short_circuit_with_prefix(monkeypatch, tmp_path, [early]))

    assert result.no_result_message is False, (
        "a ResultMessage did arrive, so the field must not say otherwise"
    )
    assert result.usage.get("num_turns") == 7, (
        "the SDK's own num_turns must survive the short-circuit, not be "
        "replaced by the manufactured turns_seen count"
    )


def test_the_stop_point_keys_on_the_routed_tool_use_id(tmp_path, monkeypatch):
    """The `block.id == routing_resolved["tool_use_id"]` match, isolated.

    An earlier turn carrying a DIFFERENT tool use must not be mistaken for the
    routed hand-off. Stopping on "any tool use once the flag is up" drops the
    hand-off turn entirely — the narration the routing test's judge_context
    asks for, which is the defect this PR fixes.
    """
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock, ToolUseBlock

    earlier = AssistantMessage(
        content=[
            TextBlock(text="Reading the plan first."),
            ToolUseBlock(id="some-other-id", name="Read", input={"file_path": "p.md"}),
        ],
        model="stub",
    )
    result = asyncio.run(_run_short_circuit_with_prefix(monkeypatch, tmp_path, [earlier]))

    assert "Routing this to record-extraction." in result.text_response, (
        "stopped on a non-routed ToolUseBlock; the hand-off turn was dropped"
    )


async def _run_short_circuit(monkeypatch, tmp_path, messages):
    import asyncio
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    hook_inputs, handoff_message = _routing_short_circuit_stream()

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(hook, hook_inputs, [handoff_message, *messages])

    monkeypatch.setattr(sr, "query", fake_query)
    return await sr.run_skill(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        routing_short_circuit_skills={"record-extraction"},
    )


def test_the_handoff_message_is_not_dropped_by_the_short_circuit(tmp_path, monkeypatch):
    """Before the fix, the loop checked routing_resolved["v"] before
    processing the message — so the very message that set the flag (the one
    carrying the routing narration) was never read. Reproduces
    ut_search_records_003's committed shape: a routing test whose
    judge_context asks for "a one-line acknowledgment like 'Routing this to
    record-extraction'" that the transcript never carried."""
    import asyncio

    result = asyncio.run(_run_short_circuit(monkeypatch, tmp_path, []))

    assert "Routing this to record-extraction." in result.text_response


def test_a_message_after_the_denied_handoff_is_not_counted(tmp_path, monkeypatch):
    """The hook's deny does not end the SDK's turn — `_run_short_circuit`'s
    docstring notes the SDK does not honor `continue_: False`, it just
    retries other tools. If the model reacts to the denial with a further
    turn before the run_skill loop actually stops, that reaction is
    harness-manufactured narration, not the skill's own behaviour, and must
    not be counted (review of #2189, round 2). The stop point is keyed on the
    routed ToolUseBlock's own id appearing in the CURRENT message, not on
    "whatever arrives next" once the flag is visible."""
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock

    reaction = AssistantMessage(
        content=[TextBlock(text="Let me try a different approach.")], model="stub"
    )
    result = asyncio.run(_run_short_circuit(monkeypatch, tmp_path, [reaction]))

    assert "Let me try a different approach." not in result.text_response
    assert result.usage.get("num_turns") == 1


def test_a_message_after_the_denied_handoff_is_not_counted_when_the_hook_gets_no_id(
    tmp_path, monkeypatch
):
    """The exact stop point (`block.id == routing_resolved["tool_use_id"]`)
    cannot fire when the SDK gives the hook `tool_use_id=None` — the SDK's own
    hook request type is `str | None`, so there is no id to match against.
    Without a fallback for this case the model's reaction to the denial keeps
    being consumed and counted, exactly the defect
    `test_a_message_after_the_denied_handoff_is_not_counted` proves is fixed
    for the has-an-id case (review of #2189, round 4). The fallback is gated
    on the id being absent, so it cannot reintroduce the flag-only misfire a
    plain `routing_resolved["v"]` check had — that check fired before the
    hand-off message itself was processed, dropping it entirely."""
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    hook_inputs, handoff_message = _routing_short_circuit_stream()
    reaction = AssistantMessage(
        content=[TextBlock(text="Let me try a different approach.")], model="stub"
    )

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(
            hook, hook_inputs, [handoff_message, reaction], hook_tool_use_id=None
        )

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            routing_short_circuit_skills={"record-extraction"},
        )
    )

    assert "Routing this to record-extraction." in result.text_response
    assert "Let me try a different approach." not in result.text_response
    assert result.usage.get("num_turns") == 1


def test_a_rate_limit_event_before_the_handoff_does_not_drop_it_when_the_hook_gets_no_id(
    tmp_path, monkeypatch
):
    """Combines the two id-absent risks the previous fallback conflated
    (review of #2189, round 3). With `tool_use_id=None`, the deleted fallback
    fired on whichever message arrived first once the flag was up — for a
    RateLimitEvent arriving before the hand-off, that was the RateLimitEvent
    itself, returning with `text_response=""` and `num_turns=0` before the
    hand-off message was ever processed. The fix matches the hand-off's own
    Skill ToolUseBlock against `_short_circuit` by name (not by id, which is
    None), inside the AssistantMessage branch — a RateLimitEvent has no such
    branch to fire from, so it cannot short-circuit the loop on its own."""
    import asyncio
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    hook_inputs, handoff_message = _routing_short_circuit_stream()
    early = _rate_limit_event("allowed")

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(
            hook, hook_inputs, [early, handoff_message], hook_tool_use_id=None
        )

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            routing_short_circuit_skills={"record-extraction"},
        )
    )

    assert "Routing this to record-extraction." in result.text_response, (
        "the hand-off was dropped — the RateLimitEvent-first ordering "
        "reintroduced the bug this PR fixes"
    )
    assert result.usage.get("num_turns") == 1


def test_a_turn_boundary_separates_two_assistant_messages(tmp_path, monkeypatch):
    """A closing turn's text must not run together with an earlier turn's
    text — the run-together-boundary half of #2189 (measured at 4a6cfad44
    over every committed run log under eval/runlogs/unit/, no `.ann.json`:
    1,385 of 1,755 texted runs in the corpus carried one), measured across
    ordinary runs generally, not specific to the routing short-circuit
    (which stops consuming after
    its one hand-off message and never reaches a second turn at all)."""
    import asyncio
    from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    first_turn = AssistantMessage(
        content=[TextBlock(text="Checking the census index.")], model="stub"
    )
    second_turn = AssistantMessage(
        content=[TextBlock(text="Found the record.")], model="stub"
    )

    async def fake_query(*, prompt, options):
        yield first_turn
        yield second_turn
        yield ResultMessage(
            subtype="result",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=2,
            session_id="S1",
        )

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        )
    )

    naive = "Checking the census index." + "Found the record."
    assert result.text_response != naive
    assert "census index.\n\nFound the record." in result.text_response


def test_two_text_blocks_in_one_turn_are_not_split(tmp_path, monkeypatch):
    """One utterance delivered as two TextBlocks is one turn — no `\n\n`
    between them. Reverting the per-turn grouping to
    `text_chunks.extend(turn_text_parts)` leaves every other test green."""
    import asyncio
    from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    one_turn = AssistantMessage(
        content=[TextBlock(text="Found the record"), TextBlock(text=" in the index.")],
        model="stub",
    )

    async def fake_query(*, prompt, options):
        yield one_turn
        yield ResultMessage(subtype="result", duration_ms=1, duration_api_ms=1,
                            is_error=False, num_turns=1, session_id="S1")

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(sr.run_skill(
        user_message="go", workspace=tmp_path, fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    ))

    assert result.text_response == "Found the record in the index."


def test_num_turns_is_real_not_a_manufactured_zero_on_short_circuit(tmp_path, monkeypatch):
    """Mirrors the existing wall-clock-timeout precedent (turns_seen survives
    regardless of exit path) — before the fix this read 0 because `usage` is
    only ever populated in the ResultMessage branch, which a short-circuited
    run never reaches."""
    import asyncio

    result = asyncio.run(_run_short_circuit(monkeypatch, tmp_path, []))

    assert result.usage.get("num_turns") == 1


def test_no_result_message_is_true_only_on_the_short_circuit(tmp_path, monkeypatch):
    """Discriminates rather than always firing: true on the short-circuit
    path (no ResultMessage ever arrives), false on an ordinary run that ends
    in one."""
    import asyncio
    from claude_agent_sdk import ResultMessage
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    result = asyncio.run(_run_short_circuit(monkeypatch, tmp_path, []))
    assert result.no_result_message is True

    def fake_query_normal(**kw):
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
                )
            ],
        )

    monkeypatch.setattr(sr, "query", fake_query_normal)
    normal_result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        )
    )
    assert normal_result.no_result_message is False


# ─── Quota aborts are not transient (#2192) ────────────────────────────────
#
# Driven through the REAL run_skill with fabricated SDK messages, for the
# reason `_run_until_timeout` states above: a hand-built SkillRunResult can
# carry field combinations this path never emits. A subscription quota cannot
# be forced on demand, so fabricating the messages is the only instrument —
# and it proves the classifier's branch, NOT that the predicate matches a live
# quota. That gap is real and is stated in the PR body.


def _run_with_messages(monkeypatch, tmp_path, messages):
    """Stream `messages` through the real run_skill and return its result."""
    import asyncio
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    async def fake_query(*, prompt, options):
        for m in messages:
            yield m

    monkeypatch.setattr(sr, "query", fake_query)
    monkeypatch.setattr(sr, "create_mock_server", lambda *a, **kw: (None, [], {}))

    return asyncio.run(
        sr.run_skill(
            user_message="x",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        )
    )


def _result_message(**kw):
    from claude_agent_sdk import ResultMessage

    base = dict(
        subtype="result",
        duration_ms=1,
        duration_api_ms=1,
        is_error=True,
        num_turns=1,
        session_id="S1",
    )
    base.update(kw)
    return ResultMessage(**base)


def _rate_limit_event(status):
    from claude_agent_sdk import RateLimitEvent
    from claude_agent_sdk.types import RateLimitInfo

    return RateLimitEvent(
        rate_limit_info=RateLimitInfo(
            status=status, resets_at=1757260800, rate_limit_type="five_hour"
        ),
        uuid="u1",
        session_id="S1",
    )


def test_a_bare_429_stays_transient_and_is_only_evidence(monkeypatch, tmp_path):
    """A 429 on its own is NOT a subscription quota.

    In `api_key` mode it is a per-minute org limit that clears in under a
    minute, which this repo twice calls transient (`harness/auth.py:151`).
    Classifying it as a quota would stop the suite and discard a whole paid
    `make eval-skill` slot over a limit that had already cleared — strictly
    worse than the three retries this change removes. It is still captured as
    evidence, so a future occurrence can be diagnosed from the run log.
    """
    result = _run_with_messages(
        monkeypatch, tmp_path, [_result_message(api_error_status=429, result="nope")]
    )
    assert result.aborted_reason == "error"
    assert "api_error_status=429" in (result.error or "")


def test_a_bare_assistant_rate_limit_error_stays_transient(monkeypatch, tmp_path):
    """Same reasoning: `AssistantMessage.error == "rate_limit"` is emitted for
    a per-minute API limit too, so it is evidence rather than a verdict."""
    from claude_agent_sdk import AssistantMessage, TextBlock

    msg = AssistantMessage(content=[TextBlock(text="x")], model="stub")
    object.__setattr__(msg, "error", "rate_limit")
    result = _run_with_messages(
        monkeypatch, tmp_path, [msg, _result_message(result="nope")]
    )
    assert result.aborted_reason == "error"
    assert "assistant_error=rate_limit" in (result.error or "")


def test_a_rejected_rate_limit_event_is_a_quota(monkeypatch, tmp_path):
    from harness.skill_runner import QUOTA_ABORT_REASON

    result = _run_with_messages(
        monkeypatch,
        tmp_path,
        [_rate_limit_event("rejected"), _result_message(result="nope")],
    )
    assert result.aborted_reason == QUOTA_ABORT_REASON


def test_the_observed_quota_prose_is_caught_by_the_fallback(monkeypatch, tmp_path):
    """The one occurrence in the corpus emitted no structured signal we can
    replay — only this string, in convert-dates/v1_2026-09-01_14-32-09.json."""
    from harness.skill_runner import QUOTA_ABORT_REASON

    result = _run_with_messages(
        monkeypatch,
        tmp_path,
        [_result_message(result="You've hit your limit · resets 4pm (Africa/Lagos)")],
    )
    assert result.aborted_reason == QUOTA_ABORT_REASON


def _assistant_text(text):
    from claude_agent_sdk import AssistantMessage, TextBlock

    return AssistantMessage(content=[TextBlock(text=text)], model="claude-opus-4")


def test_the_observed_quota_prose_is_caught_in_its_real_shape(monkeypatch, tmp_path):
    """The shape the corpus actually recorded, which the test above does not.

    In convert-dates/v1_2026-09-01_14-32-09.json, ut_convert_dates_012 has
    `error: null` — `message.result` and `stop_reason` were both empty — and
    the prose arrives as assistant text, landing in `output.text_response`.
    Feeding the same string through `result=` exercises a channel that
    occurrence never populated, so the fallback has to read the response text
    too or it misses the one case it exists for.
    """
    from harness.skill_runner import QUOTA_ABORT_REASON

    result = _run_with_messages(
        monkeypatch,
        tmp_path,
        [
            _assistant_text("You've hit your limit \u00b7 resets 4pm (Africa/Lagos)"),
            _result_message(result=None, stop_reason=None),
        ],
    )
    assert result.aborted_reason == QUOTA_ABORT_REASON


def test_an_ordinary_sdk_error_is_still_transient(monkeypatch, tmp_path):
    """The discriminator. Without this the classifier could call everything a
    quota and every test above would still pass."""
    result = _run_with_messages(
        monkeypatch, tmp_path, [_result_message(result="internal server error")]
    )
    assert result.aborted_reason == "error"


def test_approaching_the_limit_is_not_hitting_it(monkeypatch, tmp_path):
    """`allowed_warning` is the CLI warning you are close; only `rejected` is
    the limit actually refusing work."""
    result = _run_with_messages(
        monkeypatch,
        tmp_path,
        [_rate_limit_event("allowed_warning"), _result_message(result="boom")],
    )
    assert result.aborted_reason == "error"


def test_the_rate_limit_evidence_reaches_the_error_string(monkeypatch, tmp_path):
    """Before this, the only trace of a quota was output.text_response."""
    result = _run_with_messages(
        monkeypatch,
        tmp_path,
        [_rate_limit_event("rejected"), _result_message(api_error_status=429)],
    )
    assert "rate-limit signals" in (result.error or "")
    assert "api_error_status=429" in result.error
    assert "rate_limit_status=rejected" in result.error
    assert "resets_at=1757260800" in result.error


def test_a_quota_is_not_retried(monkeypatch, tmp_path):
    """Membership in _ALWAYS_RETRYABLE_ABORTS would restore the three-attempt
    retry against a limit that clears in hours."""
    from harness.orchestrator import _ALWAYS_RETRYABLE_ABORTS
    from harness.skill_runner import QUOTA_ABORT_REASON

    assert QUOTA_ABORT_REASON not in _ALWAYS_RETRYABLE_ABORTS


def test_a_quota_does_not_feed_the_abort_storm_breaker():
    """The breaker is a ratio over transient aborts; a quota is neither
    transient nor a storm, and counting it there would also skew the ratio."""
    import run_tests
    from harness.skill_runner import QUOTA_ABORT_REASON

    assert QUOTA_ABORT_REASON not in run_tests._TRANSIENT_ABORT_REASONS


def test_the_error_string_is_serialized_onto_the_run_entry():
    """The runs_block serializer is explicit, not asdict — adding the dataclass
    field alone would persist nothing and no other test would notice."""
    from harness.runlog import (
        JudgeResult,
        SingleRun,
        ValidatorResult,
        assemble_test_entry,
    )

    run = SingleRun(
        outcome="aborted",
        aborted_reason="quota_exhausted",
        error="hit your limit [rate-limit signals: api_error_status=429]",
        duration_ms=1.0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={},
        validators=ValidatorResult(passed=None, results=[]),
        judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0),
    )
    entry = assemble_test_entry(
        test_id="ut_x",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        runs=[run],
        timestamp_for_run_id="2026-09-07_00-00-00",
    )
    assert entry["runs"][0]["error"] == run.error


def test_the_quota_markers_are_matched_case_insensitively(monkeypatch, tmp_path):
    """`.lower()` in the fallback was unverified: the one corpus fixture is
    already lowercase, so deleting the call left the suite green."""
    from harness.skill_runner import QUOTA_ABORT_REASON

    result = _run_with_messages(
        monkeypatch,
        tmp_path,
        [_result_message(result="You've HIT YOUR LIMIT — resets 4pm")],
    )
    assert result.aborted_reason == QUOTA_ABORT_REASON


def test_the_usage_limit_marker_is_live_too(monkeypatch, tmp_path):
    """Both markers are load-bearing: cutting the tuple to just
    `("hit your limit",)` left the suite green."""
    from harness.skill_runner import QUOTA_ABORT_REASON

    result = _run_with_messages(
        monkeypatch, tmp_path, [_result_message(result="monthly usage limit reached")]
    )
    assert result.aborted_reason == QUOTA_ABORT_REASON


def test_an_anthropic_429_body_is_not_read_as_a_subscription_quota(
    monkeypatch, tmp_path
):
    """`"rate limit"` was removed from the markers because it matches
    Anthropic's own 429 body, which in api_key mode is a per-minute org limit.
    Re-adding it would make this red."""
    result = _run_with_messages(
        monkeypatch,
        tmp_path,
        [_result_message(result="429 rate limit exceeded, please retry")],
    )
    assert result.aborted_reason == "error"


def test_a_quota_during_a_routing_short_circuit_survives_the_clean_clear(
    tmp_path, monkeypatch
):
    """The classification in the ResultMessage branch never runs on this
    path — the loop stops on the routed AssistantMessage itself — so a quota
    signalled by an earlier RateLimitEvent has to be checked again at the
    short-circuit's own stop point, or it goes undetected rather than merely
    retried. And once classified, the routing short-circuit's own clean-up
    must not wipe it: #2192 depends on aborted_reason surviving so the
    suite-level breaker can see it and stop submitting, regardless of whether
    the same run also happened to resolve its routing verdict."""
    import asyncio
    from harness import skill_runner as sr
    from harness.auth import AuthConfig
    from harness.skill_runner import QUOTA_ABORT_REASON

    hook_inputs, handoff_message = _routing_short_circuit_stream()
    rate_limit_event = _rate_limit_event("rejected")

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(
            hook, hook_inputs, [rate_limit_event, handoff_message]
        )

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            routing_short_circuit_skills={"record-extraction"},
        )
    )

    assert result.aborted_reason == QUOTA_ABORT_REASON
    assert "rate_limit_status=rejected" in (result.error or "")
