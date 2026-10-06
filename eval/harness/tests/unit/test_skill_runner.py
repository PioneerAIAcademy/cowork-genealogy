"""Smoke tests for harness.skill_runner. The real-API integration is in e2e."""

import pytest

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


def _drive_hook(tmp_path, monkeypatch, hook_inputs, max_tool_calls=None, **run_kwargs):
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
    kwargs.update(run_kwargs)
    return asyncio.run(sr.run_skill(**kwargs)), returns


def _spawn_input(name, **extra):
    return {"tool_name": "Agent", "tool_input": {"subagent_type": name, "prompt": "p"}, **extra}


def test_the_hook_denies_a_spawn_of_a_stubbed_agent(tmp_path, monkeypatch):
    """The wiring, not just `spawn_stub_denial`: `run_skill` must hand
    `stub_agents` to its real hook closure (issue #2825)."""
    _, returns = _drive_hook(
        tmp_path, monkeypatch, [_spawn_input("locality-guide")],
        stub_agents={"locality-guide": None},
    )
    assert returns[0]["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "continue_" not in returns[0]


@pytest.mark.parametrize(
    "hook_input",
    [_spawn_input("research-plan"), _spawn_input("locality-guide", agent_id="a1")],
    ids=["unstubbed_agent", "nested_spawn"],
)
def test_the_hook_leaves_other_spawns_alone(tmp_path, monkeypatch, hook_input):
    _, returns = _drive_hook(
        tmp_path, monkeypatch, [hook_input], stub_agents={"locality-guide": None},
    )
    assert "hookSpecificOutput" not in (returns[0] or {})


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
# that deterministically reproduces one of the two orderings: routing_resolved
# is already True before the very message that caused it is ever delivered to
# the consumer loop.
#
# It is only one of the two. The SDK also delivers the message first and runs
# PreToolUse for it afterwards, and this double cannot produce that — see
# _MessageFirstHookStream at the end of this file, which does. Re-measured
# over the committed corpus: across the 150 negative-test runs logged since
# `no_result_message` was added, it is True on zero of them, so the stop was
# firing in production under neither ordering.


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


# --- routing short-circuit: the hook can fire AFTER its own message (#2189) ---
#
# _HookDrivingStream drives every hook input before message one, which is only
# one of the two orderings the SDK produces. The other — the AssistantMessage
# carrying the Skill ToolUseBlock is delivered to the consumer BEFORE the
# PreToolUse hook runs for it — is what the committed corpus shows in
# production: across the 150 negative-test runs logged since the id-keyed stop
# point landed, `no_result_message` is True on exactly zero of them, i.e. the
# stop never fired once. Under that ordering `routing_resolved` is still empty
# while the hand-off message is being scanned, so an id match cannot be made
# and the run reads to completion.


class _MessageFirstHookStream:
    """Yields messages, running the PreToolUse hook AFTER a chosen message.

    The mirror image of `_HookDrivingStream`: there the hook is driven to
    completion before message one, here it fires only once the message that
    would have triggered it has already reached the consumer loop.
    """

    def __init__(self, hook, hook_inputs, messages, hook_after_index=0,
                 hook_tool_use_id="tool-use-id"):
        self._hook = hook
        self._hook_inputs = hook_inputs
        self._messages = messages
        self._hook_after_index = hook_after_index
        self._hook_tool_use_id = hook_tool_use_id
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i > self._hook_after_index and self._hook_inputs:
            for inp in self._hook_inputs:
                await self._hook(inp, self._hook_tool_use_id, None)
            self._hook_inputs = []
        if self._i >= len(self._messages):
            raise StopAsyncIteration
        msg = self._messages[self._i]
        self._i += 1
        return msg

    async def aclose(self):
        return None


async def _run_short_circuit_hook_after_message(
    monkeypatch, tmp_path, messages, **run_kwargs
):
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    hook_inputs, handoff_message = _routing_short_circuit_stream()

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _MessageFirstHookStream(
            hook, hook_inputs, [handoff_message, *messages]
        )

    monkeypatch.setattr(sr, "query", fake_query)
    return await sr.run_skill(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        routing_short_circuit_skills={"record-extraction"},
        **run_kwargs,
    )


def test_short_circuit_stops_when_the_hook_fires_after_its_own_message(
    tmp_path, monkeypatch
):
    """The stop must not depend on the flag being up before the message.

    Keyed on `block.id == routing_resolved["tool_use_id"]` alone, the hand-off
    message is scanned while `routing_resolved` is still empty, no later
    message carries that id, and the run reads on past the deny — which is
    what every committed negative run since 2026-09-14 did.
    """
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock, ToolUseBlock

    reaction = AssistantMessage(
        content=[
            TextBlock(text="The skill was denied, so I will do it myself."),
            ToolUseBlock(
                id="reaction-call",
                name="mcp__genealogy__research_append",
                input={"section": "person_evidence"},
            ),
        ],
        model="stub",
    )

    result = asyncio.run(
        _run_short_circuit_hook_after_message(monkeypatch, tmp_path, [reaction])
    )

    assert result.no_result_message is True, (
        "the short-circuit never fired: the run read past the denied hand-off "
        "to the end of the stream"
    )
    assert "do it myself" not in result.text_response, (
        "the model's reaction to the deny was recorded as the skill's own turn"
    )
    assert not [
        c for c in result.attempted_mcp_calls
        if c["tool"] == "mcp__genealogy__research_append"
    ], "a post-deny tool call was recorded as the skill's own work"
    assert result.usage.get("num_turns") == 1, (
        f"the reaction turn was counted; num_turns={result.usage.get('num_turns')}"
    )


def test_the_handoff_message_survives_the_hook_firing_after_it(
    tmp_path, monkeypatch
):
    """The other direction: stopping late must not cost the hand-off text.

    The guard fails two ways — reading on past the deny, and dropping the
    narration the deny was supposed to preserve (the original #2189 defect).
    This pins the second under the ordering the first test introduces.

    A trailing message is required, not decoration: with the stream ending at
    the hand-off, `_MessageFirstHookStream` raises StopAsyncIteration on the
    same __anext__ that runs the hook, the stop is never reached, and both
    assertions below pass with this PR reverted — the test would pin nothing
    (review of #2739). The trailing message makes the stop fire, and
    `no_result_message` is what proves it did.
    """
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock

    reaction = AssistantMessage(
        content=[TextBlock(text="The skill was denied, so I will do it myself.")],
        model="stub",
    )

    result = asyncio.run(
        _run_short_circuit_hook_after_message(monkeypatch, tmp_path, [reaction])
    )

    assert result.no_result_message is True, (
        "the stop never fired, so this test is not exercising the path it "
        "claims to guard"
    )
    assert "Routing this to record-extraction." in result.text_response
    assert result.skills_invoked == ["record-extraction"], (
        "the routing verdict must still be recorded — the hook has to have run"
    )


def test_the_token_cap_is_not_applied_to_the_suppressed_reaction_turn(
    tmp_path, monkeypatch
):
    """The reaction turn carries the run's largest context and is discarded.

    It is the likeliest turn of any to breach max_input_tokens_per_turn — the
    hand-off context plus the deny — and the loop has already declared it is
    not the skill's work. Aborting on it fails a run whose routing verdict was
    captured, on the content of a turn thrown away two lines later; and because
    `_LimitExceeded` abandons the stream, `usage` would carry no num_turns at
    all (review of #2739).
    """
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock

    reaction = AssistantMessage(
        content=[TextBlock(text="The skill was denied, so I will do it myself.")],
        model="stub",
        usage={"input_tokens": 500_000},
    )

    result = asyncio.run(
        _run_short_circuit_hook_after_message(
            monkeypatch, tmp_path, [reaction], max_input_tokens_per_turn=1_000
        )
    )

    assert result.aborted_reason is None, (
        f"the discarded reaction turn aborted the run: {result.aborted_reason}"
    )
    assert result.no_result_message is True, "the short-circuit stop never fired"
    assert result.usage.get("num_turns") == 1, (
        f"num_turns={result.usage.get('num_turns')} — the hand-off turn is the "
        "run's one real turn"
    )
    assert "Routing this to record-extraction." in result.text_response


def test_a_real_over_cap_turn_still_aborts(tmp_path, monkeypatch):
    """The other direction: the skip must be scoped to the suppressed turn.

    A hand-off turn that is itself over the cap is the skill's own work and
    must still abort — otherwise the exemption above has quietly disabled the
    cap for every short-circuited run.
    """
    import asyncio

    hook_inputs, handoff_message = _routing_short_circuit_stream()
    handoff_message.usage = {"input_tokens": 500_000}

    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _MessageFirstHookStream(hook, hook_inputs, [handoff_message])

    monkeypatch.setattr(sr, "query", fake_query)
    result = asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            routing_short_circuit_skills={"record-extraction"},
            max_input_tokens_per_turn=1_000,
        )
    )

    assert result.aborted_reason == "max_input_tokens_per_turn"
    assert result.usage.get("num_turns") == 1, (
        "the _LimitExceeded path must report the turns it streamed, like the "
        "wall-clock path — otherwise the orchestrator reads a zero-progress run"
    )


def test_a_quota_in_the_suppressed_reaction_turn_still_aborts(tmp_path, monkeypatch):
    """The reaction turn is not the skill's text, but it is still evidence.

    #2192's suite breaker reads prose, and a subscription rejection arrives
    as prose as often as as a RateLimitEvent. The turn right after the deny
    is exactly where it lands when the model is cut off mid-hand-off. Withheld
    from `text_chunks` and NOT handed to the classifier, the quota goes
    unseen, `aborted_reason` stays None, and the suite keeps submitting —
    which is the one failure #2192 exists to prevent.
    """
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock
    from harness.skill_runner import QUOTA_ABORT_REASON

    cut_off = AssistantMessage(
        content=[
            TextBlock(
                text="Claude AI usage limit reached. Your limit will reset at 5pm."
            )
        ],
        model="stub",
    )

    result = asyncio.run(
        _run_short_circuit_hook_after_message(monkeypatch, tmp_path, [cut_off])
    )

    assert result.aborted_reason == QUOTA_ABORT_REASON, (
        "a quota rejection arriving in the suppressed reaction turn was not "
        f"classified; aborted_reason={result.aborted_reason!r}"
    )
    assert "usage limit reached" not in result.text_response, (
        "the reaction turn must still be withheld from the skill's own text"
    )
    assert "usage limit reached" in (result.error or ""), (
        "the quota was classified from prose that then appears in NO field of "
        "the run log — withheld from text_response and absent from error, so "
        "the operator has nothing to read and the next occurrence cannot be "
        f"settled without another paid suite; error={result.error!r}"
    )


# --- stop_at_stub: a test that ends at its first stubbed hand-off (#3119) -----
#
# A `no-shortcut` router test's verdict is the router's FIRST routing decision. Its
# own doctrine then tells it to walk on down the table, and a stub cannot stop that
# walk: the stub's text comes back as a tool result, and stubs write nothing. So
# `execution.stop_at_stub` ends the run at the first hand-off to a stubbed name, by
# `Skill` call or agent spawn, reusing the negative-test stop path above.


def _skill_block(skill, block_id):
    from claude_agent_sdk import ToolUseBlock

    return ToolUseBlock(id=block_id, name="Skill", input={"skill": skill})


def _spawn_block(agent, block_id):
    from claude_agent_sdk import ToolUseBlock

    return ToolUseBlock(
        id=block_id, name="Agent", input={"subagent_type": agent, "prompt": "go"}
    )


def _turn(text, *blocks, message_id=None):
    """One AssistantMessage. `message_id` is the API response's id, which the CLI
    sends on every message and which a `stop_at_stub` stop reads to tell the
    hand-off's own turn from the model's next one."""
    from claude_agent_sdk import AssistantMessage, TextBlock

    content = [TextBlock(text=text)] if text else []
    return AssistantMessage(
        content=[*content, *blocks], model="stub", message_id=message_id
    )


def _results(*tool_use_ids, parent_tool_use_id=None):
    """The UserMessage carrying a turn's tool results, as the CLI streams it."""
    from claude_agent_sdk import ToolResultBlock, UserMessage

    return UserMessage(
        content=[
            ToolResultBlock(tool_use_id=i, content="denied", is_error=True)
            for i in tool_use_ids
        ],
        parent_tool_use_id=parent_tool_use_id,
    )


def _done():
    from claude_agent_sdk import ResultMessage

    return ResultMessage(
        subtype="result", duration_ms=1, duration_api_ms=1,
        is_error=False, num_turns=3, session_id="S1",
    )


_ACTIVATE = {"tool_name": "Skill", "tool_input": {"skill": "research"}}
_SPAWN_QS = {
    "tool_name": "Agent",
    "tool_input": {"subagent_type": "question-selection", "prompt": "go"},
}
# The orchestrator passes every stubbed name as `stub_skills` and the agent-only
# ones as `stub_agents` too.
_ROWS = {"question-selection": None, "locality-guide": None}


async def _run_stop_at_stub(
    monkeypatch, tmp_path, hook_inputs, messages, *, message_first=False,
    returns=None, **run_kwargs
):
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        if message_first:
            return _MessageFirstHookStream(hook, hook_inputs, messages)
        return _HookDrivingStream(hook, hook_inputs, messages, returns=returns)

    monkeypatch.setattr(sr, "query", fake_query)
    return await sr.run_skill(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        **run_kwargs,
    )


def _router_messages(handoff_block):
    return [
        _turn("Reading the project.", _skill_block("research", "activation-id"),
              message_id="turn-1"),
        _turn("No questions yet, routing to the first row.", handoff_block,
              message_id="turn-2"),
        _turn("Next, the locality survey.", _spawn_block("locality-guide", "walk-id"),
              message_id="turn-3"),
        _done(),
    ]


def test_stop_at_stub_ends_the_run_at_a_stubbed_spawn(tmp_path, monkeypatch):
    import asyncio

    returns = []
    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path, [_ACTIVATE, _SPAWN_QS],
        _router_messages(_spawn_block("question-selection", "tool-use-id")),
        returns=returns,
        stop_at_stub=True, stub_skills=_ROWS, stub_agents=_ROWS,
    ))

    assert "routing to the first row" in result.text_response, (
        "the hand-off turn itself was dropped"
    )
    assert "locality survey" not in result.text_response, (
        "the run read on past the first stubbed hand-off"
    )
    assert result.aborted_reason is None, "a stop_at_stub stop is a clean end"
    assert "hookSpecificOutput" not in returns[0] and "continue_" not in returns[0], (
        "the router's own entry was denied or stopped"
    )
    assert returns[1]["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert returns[1]["continue_"] is False


def test_stop_at_stub_ends_the_run_at_a_stubbed_skill_call(tmp_path, monkeypatch):
    import asyncio

    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path,
        [_ACTIVATE, {"tool_name": "Skill", "tool_input": {"skill": "research-plan"}}],
        _router_messages(_skill_block("research-plan", "tool-use-id")),
        stop_at_stub=True, stub_skills={"research-plan": None},
    ))

    assert result.skills_invoked == ["research", "research-plan"]
    assert "locality survey" not in result.text_response
    assert result.aborted_reason is None


def test_stop_at_stub_lets_an_unstubbed_call_through(tmp_path, monkeypatch):
    """Only a stubbed name stops the run. The skill's own entry is never stubbed,
    and a call to an unstubbed skill runs as it would in any test."""
    import asyncio

    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path,
        [_ACTIVATE, {"tool_name": "Skill", "tool_input": {"skill": "search-external-sites"}}],
        [
            _turn("Reading the project.", _skill_block("research", "tool-use-id")),
            _turn("Checking outside sites.", _skill_block("search-external-sites", "x-id")),
            _turn("Here is what the project needs next."),
            _done(),
        ],
        stop_at_stub=True, stub_skills=_ROWS,
    ))

    assert "Here is what the project needs next." in result.text_response, (
        "the run stopped at a hand-off to an unstubbed name"
    )


def test_stop_at_stub_holds_when_the_hook_fires_after_its_message(tmp_path, monkeypatch):
    """Under the message-first ordering the flag is not up while the hand-off
    message is scanned, so the stop needs a match by name, not by id alone."""
    import asyncio

    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path, [_SPAWN_QS],
        [
            _turn("No questions yet, routing to the first row.",
                  _spawn_block("question-selection", "tool-use-id"), message_id="turn-1"),
            _turn("Next, the locality survey.",
                  _spawn_block("locality-guide", "walk-id"), message_id="turn-2"),
            _done(),
        ],
        message_first=True,
        stop_at_stub=True, stub_skills=_ROWS, stub_agents=_ROWS,
    ))

    assert "routing to the first row" in result.text_response
    assert "locality survey" not in result.text_response, (
        "the late-hook ordering read on past the first stubbed hand-off"
    )
    assert result.no_result_message is True, "the stop path never fired"


def test_stop_at_stub_holds_for_a_skill_call_when_the_hook_fires_after_it(
    tmp_path, monkeypatch
):
    """The message-first ordering again, for a `Skill` hand-off: the match by
    name has to cover a `Skill` block as well as a spawn."""
    import asyncio

    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path,
        [{"tool_name": "Skill", "tool_input": {"skill": "research-plan"}}],
        [
            _turn("Routing to the plan.", _skill_block("research-plan", "tool-use-id"),
                  message_id="turn-1"),
            _turn("Next, the searches.", _skill_block("search-records", "walk-id"),
                  message_id="turn-2"),
            _done(),
        ],
        message_first=True,
        stop_at_stub=True, stub_skills={"research-plan": None, "search-records": None},
    ))

    assert "Routing to the plan." in result.text_response
    assert "Next, the searches." not in result.text_response
    assert result.no_result_message is True


def test_a_second_hand_off_in_the_same_turn_is_denied_and_recorded(tmp_path, monkeypatch):
    """What keeps `test_no_paired_skill_shortcut` worth running: a router that
    spawns question-selection and a downstream row in one turn gets both denied,
    the unstubbed one included, and both recorded for the validator to read."""
    import asyncio

    returns = []
    downstream = {
        "tool_name": "Agent",
        "tool_input": {"subagent_type": "person-evidence", "prompt": "go"},
    }
    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path, [_ACTIVATE, _SPAWN_QS, downstream],
        [
            _turn("Reading the project.", _skill_block("research", "activation-id")),
            _turn("Routing.", _spawn_block("question-selection", "tool-use-id"),
                  _spawn_block("person-evidence", "second-id")),
            _done(),
        ],
        returns=returns,
        stop_at_stub=True,
        stub_skills={"question-selection": None},
        stub_agents={"question-selection": None},
    ))

    for denied in returns[1:]:
        assert denied["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert denied["continue_"] is False
    spawned = [
        c["args"].get("subagent_type") for c in result.builtin_tool_calls
        if c["tool"] == "Agent"
    ]
    assert spawned == ["question-selection", "person-evidence"]


def test_a_skill_call_after_the_stop_is_armed_is_denied_too(tmp_path, monkeypatch):
    """The same-turn rule for a `Skill` call: once a stubbed spawn arms the stop,
    a call to an unstubbed skill in that turn is denied and recorded, not run."""
    import asyncio

    returns = []
    plan = {"tool_name": "Skill", "tool_input": {"skill": "research-plan"}}
    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path, [_ACTIVATE, _SPAWN_QS, plan],
        [
            _turn("Reading the project.", _skill_block("research", "activation-id")),
            _turn("Routing.", _spawn_block("question-selection", "tool-use-id"),
                  _skill_block("research-plan", "second-id")),
            _done(),
        ],
        returns=returns,
        stop_at_stub=True,
        stub_skills={"question-selection": None},
        stub_agents={"question-selection": None},
    ))

    assert returns[2]["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert returns[2]["continue_"] is False
    assert result.skills_invoked == ["research", "research-plan"]


def test_a_spawn_of_an_unstubbed_agent_does_not_stop_the_run(tmp_path, monkeypatch):
    import asyncio

    returns = []
    mentor = {"tool_name": "Agent", "tool_input": {"subagent_type": "gps-mentor", "prompt": "go"}}
    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path, [_ACTIVATE, mentor],
        [
            _turn("Reading the project.", _skill_block("research", "activation-id")),
            _turn("Asking the mentor.", _spawn_block("gps-mentor", "x-id")),
            _turn("Here is what the project needs next."),
            _done(),
        ],
        returns=returns,
        stop_at_stub=True, stub_skills=_ROWS, stub_agents=_ROWS,
    ))

    assert "continue_" not in returns[1], "an unstubbed spawn armed the stop"
    assert "Here is what the project needs next." in result.text_response


def test_a_skill_call_inside_a_subagent_does_not_stop_the_run(tmp_path, monkeypatch):
    import asyncio

    returns = []
    asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path,
        [{"tool_name": "Skill", "tool_input": {"skill": "research-plan"},
          "agent_id": "agent-sub-1"}],
        [_turn("Working."), _done()],
        returns=returns,
        stop_at_stub=True, stub_skills={"research-plan": None},
    ))

    assert len(returns) == 1
    assert "continue_" not in returns[0], "a subagent's Skill call stopped the run"


def test_a_spawn_inside_a_subagent_does_not_stop_the_run(tmp_path, monkeypatch):
    """Hand-offs are the main thread's, the rule `spawned_agents` uses."""
    import asyncio

    returns = []
    asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path,
        [{**_SPAWN_QS, "agent_id": "agent-sub-1"}],
        [_turn("Working."), _done()],
        returns=returns,
        stop_at_stub=True, stub_skills=_ROWS, stub_agents=_ROWS,
    ))

    assert len(returns) == 1
    assert "hookSpecificOutput" not in returns[0] and "continue_" not in returns[0], (
        "a subagent's spawn was treated as the router's hand-off"
    )


def test_without_stop_at_stub_a_stubbed_spawn_still_continues(tmp_path, monkeypatch):
    """The default is unchanged: a positive test's stub denies and continues."""
    import asyncio

    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path, [_ACTIVATE, _SPAWN_QS],
        _router_messages(_spawn_block("question-selection", "tool-use-id")),
        stub_skills=_ROWS, stub_agents=_ROWS,
    ))

    assert "locality survey" in result.text_response


def test_an_unreadable_skill_call_after_the_stop_is_armed_is_denied(tmp_path, monkeypatch):
    """Before the stop is armed an unreadable call is left alone, as in any test;
    once it is armed, no later main-thread hand-off runs, whatever its name."""
    import asyncio

    returns = []
    unread = {"tool_name": "Skill", "tool_input": {"unexpected": "x"}}
    result = asyncio.run(_run_stop_at_stub(
        monkeypatch, tmp_path,
        [_ACTIVATE, unread, _SPAWN_QS, unread, {**unread, "agent_id": "agent-sub-1"}],
        _router_messages(_spawn_block("question-selection", "tool-use-id")),
        returns=returns,
        stop_at_stub=True, stub_skills=_ROWS, stub_agents=_ROWS,
    ))

    assert "continue_" not in returns[1], "an unreadable call before the stop was denied"
    assert returns[3]["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert returns[3]["continue_"] is False
    assert "continue_" not in returns[4], "a subagent's unreadable call was denied"
    assert len(result.unread_skill_calls) == 3


# The CLI streams one block per AssistantMessage, every block of one model turn
# carrying that turn's `message_id`, and each hook runs where it runs relative to
# the messages. `_InterleavedStream` scripts that: a hook entry runs only when the
# consumer asks for the next message, so a hook scripted after the point where the
# run stopped never runs, as a closed stream never runs it.


class _InterleavedStream:
    """Yields scripted messages, running each ("hook", input, tool_use_id) entry
    when the consumer reaches it, and keeping what the hook returned by id."""

    def __init__(self, hook, events, returns):
        self._hook = hook
        self._events = list(events)
        self._returns = returns

    def __aiter__(self):
        return self

    async def __anext__(self):
        while self._events:
            event = self._events.pop(0)
            if isinstance(event, tuple):
                _, hook_input, tool_use_id = event
                self._returns[tool_use_id] = await self._hook(hook_input, tool_use_id, None)
                continue
            return event
        raise StopAsyncIteration

    async def aclose(self):
        return None


async def _run_interleaved(monkeypatch, tmp_path, events, returns, **run_kwargs):
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _InterleavedStream(hook, events, returns)

    monkeypatch.setattr(sr, "query", fake_query)
    return await sr.run_skill(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        **run_kwargs,
    )


def _hook_runs(hook_input, tool_use_id):
    return ("hook", hook_input, tool_use_id)


_SPAWN_PE = {
    "tool_name": "Agent",
    "tool_input": {"subagent_type": "person-evidence", "prompt": "go"},
}
_QS_ONLY = {"question-selection": None}


def _spawned(result):
    return [
        c["args"].get("subagent_type") for c in result.builtin_tool_calls
        if c["tool"] == "Agent"
    ]


def test_a_same_turn_hand_off_in_its_own_message_is_recorded_when_hooks_run_first(
    tmp_path, monkeypatch
):
    """Each hook runs before its own block's message. A stop at the hand-off
    message closed the stream before the second spawn's hook ran, so the second
    spawn was never recorded and the validators could not see it."""
    import asyncio

    returns = {}
    result = asyncio.run(_run_interleaved(
        monkeypatch, tmp_path,
        [
            _hook_runs(_ACTIVATE, "activation-id"),
            _turn("Reading the project.", _skill_block("research", "activation-id"),
                  message_id="turn-1"),
            _turn("Routing to the first row.", message_id="turn-2"),
            _hook_runs(_SPAWN_QS, "qs-id"),
            _turn("", _spawn_block("question-selection", "qs-id"), message_id="turn-2"),
            _hook_runs(_SPAWN_PE, "pe-id"),
            _turn("", _spawn_block("person-evidence", "pe-id"), message_id="turn-2"),
            _results("qs-id", "pe-id"),
            _turn("Reacting to the denial.", message_id="turn-3"),
            _done(),
        ],
        returns,
        stop_at_stub=True, stub_skills=_QS_ONLY, stub_agents=_QS_ONLY,
    ))

    assert _spawned(result) == ["question-selection", "person-evidence"]
    assert returns["pe-id"]["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "Routing to the first row." in result.text_response
    assert "Reacting to the denial." not in result.text_response
    assert result.aborted_reason is None
    assert result.no_result_message is True, "the stop path never fired"


def test_a_same_turn_hand_off_after_the_stop_is_armed_is_not_read_as_the_reaction(
    tmp_path, monkeypatch
):
    """The first spawn's hook runs after its message and before the second
    spawn's message. That message then arrives with the stop armed; read as the
    model's reaction, it ended the run before its own hook ran."""
    import asyncio

    returns = {}
    result = asyncio.run(_run_interleaved(
        monkeypatch, tmp_path,
        [
            _turn("Routing to the first row.",
                  _spawn_block("question-selection", "qs-id"), message_id="turn-1"),
            _hook_runs(_SPAWN_QS, "qs-id"),
            _turn("", _spawn_block("person-evidence", "pe-id"), message_id="turn-1"),
            _hook_runs(_SPAWN_PE, "pe-id"),
            _results("qs-id", "pe-id"),
            _turn("Reacting to the denial.", message_id="turn-2"),
            _done(),
        ],
        returns,
        stop_at_stub=True, stub_skills=_QS_ONLY, stub_agents=_QS_ONLY,
    ))

    assert _spawned(result) == ["question-selection", "person-evidence"]
    assert returns["pe-id"]["continue_"] is False
    assert "Reacting to the denial." not in result.text_response


def test_without_message_ids_the_stop_waits_for_the_turns_tool_results(
    tmp_path, monkeypatch
):
    """The fallback end of the hand-off turn is its first main-thread tool result.
    An earlier turn's results and a subagent's do not end it."""
    import asyncio

    returns = {}
    result = asyncio.run(_run_interleaved(
        monkeypatch, tmp_path,
        [
            _turn("Reading the project.", _skill_block("research", "activation-id")),
            _hook_runs(_ACTIVATE, "activation-id"),
            _results("activation-id"),
            _turn("Routing to the first row.",
                  _spawn_block("question-selection", "qs-id")),
            _hook_runs(_SPAWN_QS, "qs-id"),
            _results("mentor-call-id", parent_tool_use_id="mentor-id"),
            _turn("", _spawn_block("person-evidence", "pe-id")),
            _hook_runs(_SPAWN_PE, "pe-id"),
            _results("qs-id", "pe-id"),
            _turn("Reacting to the denial."),
            _done(),
        ],
        returns,
        stop_at_stub=True, stub_skills=_QS_ONLY, stub_agents=_QS_ONLY,
    ))

    assert _spawned(result) == ["question-selection", "person-evidence"]
    assert "Reacting to the denial." not in result.text_response
    assert result.no_result_message is True


def test_a_reaction_whose_hook_ran_first_is_still_the_reaction(tmp_path, monkeypatch):
    """The reaction's own call can reach the hook before its message reaches the
    loop. An id match on that call read the reaction as the hand-off turn and
    recorded its text as the router's."""
    import asyncio

    returns = {}
    walk = {
        "tool_name": "Agent",
        "tool_input": {"subagent_type": "locality-guide", "prompt": "go"},
    }
    result = asyncio.run(_run_interleaved(
        monkeypatch, tmp_path,
        [
            _turn("Routing to the first row.",
                  _spawn_block("question-selection", "qs-id"), message_id="turn-1"),
            _hook_runs(_SPAWN_QS, "qs-id"),
            _results("qs-id"),
            _hook_runs(walk, "walk-id"),
            _turn("Next, the locality survey.",
                  _spawn_block("locality-guide", "walk-id"), message_id="turn-2"),
            _done(),
        ],
        returns,
        stop_at_stub=True, stub_skills=_ROWS, stub_agents=_ROWS,
    ))

    assert "Next, the locality survey." not in result.text_response
    assert result.no_result_message is True


def test_a_subagents_messages_neither_start_nor_end_the_hand_off_turn(
    tmp_path, monkeypatch
):
    """A subagent's own messages carry the spawn's id as their parent. Its call to
    a stubbed name is not the router's hand-off, and its message after the
    hand-off is not the router's next turn."""
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock

    def subagent_turn(text, *blocks, message_id):
        return AssistantMessage(
            content=[TextBlock(text=text), *blocks], model="stub",
            parent_tool_use_id="mentor-id", message_id=message_id,
        )

    returns = {}
    mentor = {
        "tool_name": "Agent",
        "tool_input": {"subagent_type": "gps-mentor", "prompt": "go"},
    }
    result = asyncio.run(_run_interleaved(
        monkeypatch, tmp_path,
        [
            _hook_runs(mentor, "mentor-id"),
            _hook_runs(_SPAWN_QS, "qs-id"),
            _turn("", _spawn_block("gps-mentor", "mentor-id"), message_id="turn-1"),
            subagent_turn("Mentor notes.", _skill_block("research-plan", "sub-id"),
                          message_id="sub-turn-1"),
            _turn("Routing to the first row.",
                  _spawn_block("question-selection", "qs-id"), message_id="turn-1"),
            subagent_turn("More mentor notes.", message_id="sub-turn-2"),
            _hook_runs(_SPAWN_PE, "pe-id"),
            _turn("", _spawn_block("person-evidence", "pe-id"), message_id="turn-1"),
            _results("mentor-id", "qs-id", "pe-id"),
            _turn("Reacting to the denial.", message_id="turn-2"),
            _done(),
        ],
        returns,
        stop_at_stub=True,
        stub_skills={"question-selection": None, "research-plan": None},
        stub_agents=_QS_ONLY,
    ))

    assert "Routing to the first row." in result.text_response, (
        "the run stopped on the subagent's message, before the router's hand-off"
    )
    assert _spawned(result) == ["gps-mentor", "question-selection", "person-evidence"]
    assert "Reacting to the denial." not in result.text_response


# --- the short-circuit's abort clearing is scoped, and nothing pinned it ------
#
# `if routing_resolved["v"] and aborted_reason != QUOTA_ABORT_REASON: clear`
# cleared EVERY reason but the quota one, including harness-imposed caps the
# hook's stop cannot fabricate. With the stop broken from 2026-09-14, negative
# runs that then blew a cap were logged clean: ut_citation_003
# (citation/v1_2026-09-18_21-06-39) ran 305.1s over 38 turns against a 300s
# default and carries `aborted_reason: null, outcome: "pass"`, and none of the
# 168 committed post-cut negative runs carries an abort reason at all. The
# clause was pinned in NEITHER direction, so both go in here.


async def _run_short_circuit_with_cap(monkeypatch, tmp_path):
    """Trip `max_tool_calls` and THEN resolve routing, in one run."""
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    _, handoff_message = _routing_short_circuit_stream()
    hook_inputs = [
        {"tool_name": "mcp__genealogy__research_query", "tool_input": {}},
        {"tool_name": "Skill", "tool_input": {"skill": "record-extraction"}},
    ]

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(hook, hook_inputs, [handoff_message])

    monkeypatch.setattr(sr, "query", fake_query)
    return await sr.run_skill(
        user_message="go",
        workspace=tmp_path,
        fixture_names=[],
        fixtures_dir=tmp_path,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        routing_short_circuit_skills={"record-extraction"},
        max_tool_calls=0,
    )


def test_a_harness_cap_survives_the_routing_short_circuit(tmp_path, monkeypatch):
    """A cap the hook's stop cannot have fabricated must not be cleared.

    This is the alarm that would have caught the 2026-09-14 break in its first
    week and did not, because the clause keyed on the same flag the broken stop
    keyed on.
    """
    import asyncio

    result = asyncio.run(_run_short_circuit_with_cap(monkeypatch, tmp_path))

    assert result.aborted_reason == "max_tool_calls", (
        "a deterministic harness cap was cleared as short-circuit noise; "
        f"aborted_reason={result.aborted_reason!r}"
    )
    assert "max_tool_calls" in (result.error or "")


def test_an_sdk_error_is_still_cleared_by_the_routing_short_circuit(
    tmp_path, monkeypatch
):
    """The other direction: the clearing this clause exists for still happens.

    The SDK may surface the hook-initiated stop as an error on a trailing
    ResultMessage. That is noise from a deliberate, successful early stop and
    must still be cleared — narrowing the clause to caps-only would make every
    short-circuited run look aborted, which is worse than the bug above.
    """
    import asyncio

    result = asyncio.run(
        _run_short_circuit_with_prefix(
            monkeypatch, tmp_path, [_result_message(api_error_status=500)]
        )
    )

    assert result.aborted_reason is None, (
        "the SDK's own error on a deliberate stop should still be cleared; "
        f"aborted_reason={result.aborted_reason!r}"
    )
    assert result.error is None


def test_the_suppressed_reaction_calls_are_recorded_not_dropped(tmp_path, monkeypatch):
    """Withheld from the skill's own record, but kept on the result.

    Dropping them left two things unanswerable from any run log — whether a
    reaction call ever executes, and whether one ever names an unregistered
    tool — which is what made the earlier "measured" claim about this
    unfalsifiable (issue #2740).
    """
    import asyncio
    from claude_agent_sdk import AssistantMessage, TextBlock, ToolUseBlock

    reaction = AssistantMessage(
        content=[
            TextBlock(text="Denied, so I will do it myself."),
            ToolUseBlock(
                id="reaction-call",
                name="mcp__genealogy__research_append",
                input={"section": "person_evidence"},
            ),
        ],
        model="stub",
    )

    result = asyncio.run(
        _run_short_circuit_hook_after_message(monkeypatch, tmp_path, [reaction])
    )

    assert [c["tool"] for c in result.suppressed_post_deny_calls] == [
        "mcp__genealogy__research_append"
    ], f"the discarded attempt was not recorded: {result.suppressed_post_deny_calls}"
    assert not result.attempted_mcp_calls, (
        "a post-deny call must still stay OUT of attempted_mcp_calls, or the "
        "uncovered_tool_call advisory fires on a deliberately stopped run"
    )


# --- #3116: a slash-command entry records the skill it loaded -----------------
#
# `skills_invoked` is filled by the PreToolUse hook on a `Skill` call. A slash
# command is expanded by the CLI, so the hook never fires and `/research …` --
# the entry point production uses -- was ungradable.
#
# Step 0 measured what reaches the SDK stream: no `<command-name>`, no `Base
# directory for this skill`, no `isMeta`, no `sourceToolUseID`. So the rule is
# "registered and staged", not "expanded" (ruling: chesworthrm, 2026-10-05).


def _staged(tmp_path, *names):
    root = tmp_path / ".claude" / "skills"
    for n in names:
        (root / n).mkdir(parents=True)
    return root


def test_slash_entry_records_a_registered_and_staged_skill(tmp_path):
    from harness.skill_runner import slash_skill_from_entry

    root = _staged(tmp_path, "research")
    assert slash_skill_from_entry("/research --autonomous Who…", ["research"], root) == "research"


def test_slash_entry_to_an_unknown_skill_records_nothing(tmp_path):
    from harness.skill_runner import slash_skill_from_entry

    root = _staged(tmp_path, "research")
    assert slash_skill_from_entry("/no-such-skill go", ["research"], root) is None


def test_slash_prefix_without_registration_records_nothing(tmp_path):
    """The prefix-only guard.

    A rule keyed on the leading `/` alone would let every slash test pass
    activation by default. `slash_commands` comes from the init SystemMessage
    and is what distinguishes a command the CLI registered from a message that
    merely starts with a slash.
    """
    from harness.skill_runner import slash_skill_from_entry

    root = _staged(tmp_path, "research")
    assert slash_skill_from_entry("/research go", [], root) is None


def test_registered_but_unstaged_skill_records_nothing(tmp_path):
    from harness.skill_runner import slash_skill_from_entry

    root = _staged(tmp_path, "research")
    assert slash_skill_from_entry("/other go", ["other"], root) is None


def test_a_namespaced_spelling_records_nothing(tmp_path):
    """Staging is by bare name, so a namespaced command resolves to no dir."""
    from harness.skill_runner import slash_skill_from_entry

    root = _staged(tmp_path, "research")
    assert (
        slash_skill_from_entry("/genealogy-research:research go", ["research"], root)
        is None
    )


def test_an_ordinary_message_records_nothing(tmp_path):
    from harness.skill_runner import slash_skill_from_entry

    root = _staged(tmp_path, "research")
    assert slash_skill_from_entry("Research the parents of X", ["research"], root) is None


def test_a_bare_slash_records_nothing(tmp_path):
    from harness.skill_runner import slash_skill_from_entry

    root = _staged(tmp_path, "research")
    assert slash_skill_from_entry("/", ["research"], root) is None
    assert slash_skill_from_entry("/ research", ["research"], root) is None


# --- #3116: the stream capture and the insertion, end to end ------------------
#
# The pure helper above is tested with hand-built lists. These drive the real
# `run_skill` so the message TYPE, the `data` key spelling and the entry format
# are asserted against what the SDK actually emits -- a mismatch in any of them
# makes the whole feature a silent no-op indistinguishable from the pre-fix
# state, with every helper test still green.


def _run_with_init(monkeypatch, tmp_path, user_message, init_data, stage="research"):
    import asyncio
    from claude_agent_sdk import ResultMessage, SystemMessage
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    if stage:
        (tmp_path / ".claude" / "skills" / stage).mkdir(parents=True)

    async def fake_query(*, prompt, options):
        yield SystemMessage(subtype="init", data=init_data)
        yield ResultMessage(
            subtype="result",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="s",
            total_cost_usd=0.0,
            usage={},
            result="done",
        )

    monkeypatch.setattr(sr, "query", fake_query)
    monkeypatch.setattr(sr, "create_mock_server", lambda *a, **kw: (None, [], {}))
    return asyncio.run(
        sr.run_skill(
            user_message=user_message,
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            max_wall_clock_seconds=10,
        )
    )


def test_slash_entry_is_recorded_from_the_real_init_message(monkeypatch, tmp_path):
    """The shape here is what Step 0 measured off the live SDK: a bare name,
    no leading slash, under `data["slash_commands"]` on `subtype="init"`."""
    r = _run_with_init(
        monkeypatch,
        tmp_path,
        "/research --autonomous Who were the parents?",
        {"slash_commands": ["research", "search-full-text"]},
    )
    assert r.skills_invoked == ["research"]
    assert r.slash_entry_skill == "research"


def test_no_init_slash_commands_records_nothing(monkeypatch, tmp_path):
    """Guards the key spelling: if `slash_commands` ever moves or is renamed,
    this reds instead of the feature silently reverting."""
    r = _run_with_init(monkeypatch, tmp_path, "/research go", {})
    assert r.skills_invoked == []
    assert r.slash_entry_skill is None


def test_a_leading_slash_spelling_in_slash_commands_is_not_assumed(monkeypatch, tmp_path):
    """The SDK emits bare names. If it ever emitted `/research`, the feature
    would silently stop working -- this pins which spelling is relied on."""
    r = _run_with_init(
        monkeypatch, tmp_path, "/research go", {"slash_commands": ["/research"]}
    )
    assert r.skills_invoked == []


def test_a_non_slash_message_records_nothing_end_to_end(monkeypatch, tmp_path):
    r = _run_with_init(
        monkeypatch, tmp_path, "Research the parents", {"slash_commands": ["research"]}
    )
    assert r.skills_invoked == []
    assert r.slash_entry_skill is None


def test_a_non_init_system_message_is_ignored(monkeypatch, tmp_path):
    """SystemMessage covers several subtypes; only init carries the list."""
    import asyncio
    from claude_agent_sdk import ResultMessage, SystemMessage
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    (tmp_path / ".claude" / "skills" / "research").mkdir(parents=True)

    async def fake_query(*, prompt, options):
        yield SystemMessage(subtype="compact_boundary", data={"slash_commands": ["research"]})
        yield ResultMessage(
            subtype="result", duration_ms=1, duration_api_ms=1, is_error=False,
            num_turns=1, session_id="s", total_cost_usd=0.0, usage={}, result="d",
        )

    monkeypatch.setattr(sr, "query", fake_query)
    monkeypatch.setattr(sr, "create_mock_server", lambda *a, **kw: (None, [], {}))
    r = asyncio.run(
        sr.run_skill(
            user_message="/research go", workspace=tmp_path, fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            max_wall_clock_seconds=10,
        )
    )
    assert r.skills_invoked == []


def test_a_non_mapping_data_does_not_abort_the_run(monkeypatch, tmp_path):
    """A non-dict `data` on some other subtype must not raise inside the
    stream loop, which would abort a paid run on a message we otherwise skip."""
    r = _run_with_init(monkeypatch, tmp_path, "/research go", None)
    assert r.skills_invoked == []


def test_slash_entry_is_first_and_each_skill_call_recorded_once(monkeypatch, tmp_path):
    """A slash entry plus three `Skill` calls (#3116's fourth case). Pins index
    0 -- an append puts the entry point last -- and the unconditional insert --
    a `not in skills_invoked` guard drops it when the model also calls
    `Skill(research)`."""
    import asyncio
    from claude_agent_sdk import ResultMessage, SystemMessage
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    (tmp_path / ".claude" / "skills" / "research").mkdir(parents=True)

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        return _HookDrivingStream(
            hook,
            [
                {"tool_name": "Skill", "tool_input": {"skill": s}}
                for s in ("question-selection", "research", "research-plan")
            ],
            [
                SystemMessage(subtype="init", data={"slash_commands": ["research"]}),
                ResultMessage(
                    subtype="result", duration_ms=1, duration_api_ms=1,
                    is_error=False, num_turns=1, session_id="s",
                ),
            ],
        )

    monkeypatch.setattr(sr, "query", fake_query)
    monkeypatch.setattr(sr, "create_mock_server", lambda *a, **kw: (None, [], {}))
    r = asyncio.run(
        sr.run_skill(
            user_message="/research go", workspace=tmp_path, fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            max_wall_clock_seconds=10,
        )
    )
    assert r.skills_invoked == [
        "research", "question-selection", "research", "research-plan"
    ]
