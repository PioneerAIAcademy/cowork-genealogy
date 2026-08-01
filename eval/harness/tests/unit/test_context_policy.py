"""Unit tests for the per-context tool policy (harness/context_policy.py).

Contract under test, per docs/plan/image-read-context-policy.md: a subagent-only
tool (image_read) is denied on the main thread and allowed inside a delegated
subagent, discriminated by the PRESENCE of `agent_id` in the PreToolUse payload.

The payload shapes here mirror the ones the probe observed against the pinned
CLI + SDK 0.1.81 (plan §3.1): main-thread firings omit `agent_id` entirely
rather than setting it to None.
"""

from harness.context_policy import (
    _DENIAL_REASONS,
    SUBAGENT_ONLY_TOOLS,
    bare_tool_name,
    is_subagent_call,
    subagent_only_denial,
    subagent_only_violation,
)

# A main-thread firing: no agent_id key at all (not agent_id=None).
MAIN_KEYS = {
    "cwd": "/tmp/x",
    "hook_event_name": "PreToolUse",
    "session_id": "s1",
    "tool_use_id": "t1",
}
# A subagent firing: agent_id + agent_type present.
SUB_KEYS = {**MAIN_KEYS, "agent_id": "a0307acf2508a8c2d", "agent_type": "image-reader"}


def _main(tool_name, **tool_input):
    return {**MAIN_KEYS, "tool_name": tool_name, "tool_input": tool_input}


def _sub(tool_name, **tool_input):
    return {**SUB_KEYS, "tool_name": tool_name, "tool_input": tool_input}


# --- bare_tool_name: semantics preserved from e2e/orchestrator.py ---


def test_bare_tool_name_strips_mcp_prefix():
    assert bare_tool_name("mcp__genealogy__image_read") == "image_read"
    assert bare_tool_name("image_read") == "image_read"
    assert bare_tool_name("Read") == "Read"


# --- is_subagent_call: keys on PRESENCE, not truthiness or agent_type ---


def test_is_subagent_call_true_inside_subagent():
    assert is_subagent_call(_sub("mcp__genealogy__image_read")) is True


def test_is_subagent_call_false_on_main_thread():
    assert is_subagent_call(_main("mcp__genealogy__image_read")) is False


def test_is_subagent_call_keys_on_presence_not_truthiness():
    """An empty-string agent_id is still a subagent firing.

    Presence is the contract; a falsy-but-present value must not read as main.
    """
    payload = {**MAIN_KEYS, "tool_name": "mcp__genealogy__image_read", "agent_id": ""}
    assert is_subagent_call(payload) is True


def test_agent_type_alone_is_not_a_subagent():
    """A session started with --agent carries agent_type WITHOUT agent_id.

    Keying on agent_type would misread that main thread as a subagent and let
    the violation through. See context_policy.is_subagent_call.
    """
    payload = {
        **MAIN_KEYS,
        "tool_name": "mcp__genealogy__image_read",
        "agent_type": "some-agent",
    }
    assert is_subagent_call(payload) is False
    assert subagent_only_violation(payload) == "image_read"


# --- subagent_only_violation ---


def test_violation_on_main_thread():
    assert subagent_only_violation(_main("mcp__genealogy__image_read")) == "image_read"


def test_no_violation_inside_subagent():
    assert subagent_only_violation(_sub("mcp__genealogy__image_read")) is None


def test_no_violation_for_unguarded_tool_on_main():
    assert subagent_only_violation(_main("mcp__genealogy__record_read")) is None
    assert subagent_only_violation(_main("Read")) is None


# --- the declared-tools exemption (the search-images case) ---


def test_declaring_the_tool_exempts_the_skill():
    """search-images declares image_read and browses volumes page-by-page.

    Regression guard: an unscoped policy would deny every one of those calls
    and break the skill outright. The declaration is what separates a
    legitimate direct call from a boundary violation.
    """
    assert (
        subagent_only_violation(
            _main("mcp__genealogy__image_read"), {"volume_search", "image_search", "image_read"}
        )
        is None
    )


def test_undeclared_tool_is_still_a_violation():
    """record-extraction declares record_read/volume_search/research_log_append.

    It holds image_read only through the @plugin:image-reader union, so its
    router must delegate.
    """
    assert (
        subagent_only_violation(
            _main("mcp__genealogy__image_read"),
            {"record_read", "volume_search", "research_log_append"},
        )
        == "image_read"
    )


def test_unknown_declaration_applies_the_guard():
    """None means 'declared nothing' — fail closed, not open."""
    assert subagent_only_violation(_main("mcp__genealogy__image_read"), None) == "image_read"
    assert subagent_only_violation(_main("mcp__genealogy__image_read"), set()) == "image_read"


def test_declaration_does_not_matter_inside_a_subagent():
    """A subagent call is fine either way — the guard is about the main thread."""
    assert subagent_only_violation(_sub("mcp__genealogy__image_read"), set()) is None


def test_delegation_itself_is_not_a_violation():
    """The Agent/Task call is a main-thread call, but it is not the guarded tool.

    The probe (plan §3.1) confirmed the delegation surfaces as `Agent` with no
    agent_id; denying it would break the very path we want the router to take.
    """
    assert subagent_only_violation(_main("Agent", subagent_type="image-reader")) is None
    assert subagent_only_violation(_main("Task", subagent_type="image-reader")) is None


def test_violation_matches_bare_name_without_prefix():
    assert subagent_only_violation(_main("image_read")) == "image_read"


def test_missing_tool_name_is_not_a_violation():
    assert subagent_only_violation({**MAIN_KEYS}) is None


# --- subagent_only_denial: shape the SDK requires ---


def test_denial_shape_is_a_deny_without_stop_reason():
    payload = subagent_only_denial("image_read")
    hook_out = payload["hookSpecificOutput"]
    assert hook_out["hookEventName"] == "PreToolUse"
    assert hook_out["permissionDecision"] == "deny"
    # No stopReason / continue_: a denied call is recoverable — the run must
    # continue so the router can pivot to delegating.
    assert "stopReason" not in payload
    assert "continue_" not in payload


def test_denial_reason_names_the_fix():
    reason = subagent_only_denial("image_read")["hookSpecificOutput"][
        "permissionDecisionReason"
    ]
    # The reason text is the model's only feedback, so it must point at the
    # subagent rather than merely refusing.
    assert "image-reader" in reason
    assert "image_read" in reason


# --- extraction_append: the record-extractor spawn-failure guard (#942) -----
#
# Same shape as image_read, but UNCONDITIONAL: no skill declares
# extraction_append (it lives only in agents/record-extractor.md), so the
# declared-tools exemption can never fire for it. These mirror the image_read
# cases above and add the "declaring nothing still denies" edge that matters
# most here, since that is the state every real caller is in.


def test_extraction_append_violation_on_main_thread():
    assert (
        subagent_only_violation(_main("mcp__genealogy__extraction_append"))
        == "extraction_append"
    )


def test_extraction_append_no_violation_inside_subagent():
    assert subagent_only_violation(_sub("mcp__genealogy__extraction_append")) is None


def test_extraction_append_denied_even_with_declared_tools():
    """No skill declares extraction_append, so the exemption never applies.

    Even passing record-extraction's real declared set must not exempt the
    router — the tool is held only through @plugin:record-extractor.
    """
    declared = {"record_read", "volume_search", "research_log_append"}
    assert (
        subagent_only_violation(
            _main("mcp__genealogy__extraction_append"), declared
        )
        == "extraction_append"
    )


def test_extraction_append_denial_tells_the_router_to_stop():
    reason = subagent_only_denial("extraction_append")["hookSpecificOutput"][
        "permissionDecisionReason"
    ]
    # The fix for a spawn failure is to surface it and stop — NOT to delegate
    # differently or retry. The reason text is the model's only feedback.
    assert "record-extractor" in reason
    assert "stop" in reason.lower()
    assert "extraction_append" in reason
    # Must tell it NOT to keep trying — an inverted reason that encouraged a
    # retry ("retry another way") would relocate the substitution. Assert the
    # negation, not the bare phrase, so such an inversion fails here.
    assert "do not retry another way" in reason.lower()
    assert "retry another way" not in reason.lower().replace(
        "do not retry another way", ""
    ), "the only 'retry another way' mention must be the negated one"


def test_extraction_append_delegation_itself_is_not_a_violation():
    """The Task call that spawns record-extractor is main-thread but not guarded."""
    assert (
        subagent_only_violation(_main("Task", subagent_type="record-extractor"))
        is None
    )


# --- the policy set itself ---


def test_image_read_is_the_guarded_tool():
    assert "image_read" in SUBAGENT_ONLY_TOOLS
    # Guard against over-reach: record_read etc. must stay callable on main.
    assert "record_read" not in SUBAGENT_ONLY_TOOLS


def test_extraction_append_is_the_guarded_tool():
    assert "extraction_append" in SUBAGENT_ONLY_TOOLS
    # research_append is the broad writer the record-extractor is denied; it must
    # NOT get swept into the subagent-only guard, which is about a different axis.
    assert "research_append" not in SUBAGENT_ONLY_TOOLS


def test_every_guarded_tool_has_a_bespoke_denial_reason():
    """Parity guard: the fallback in subagent_only_denial must stay unreachable.

    A tool added to SUBAGENT_ONLY_TOOLS without its own reason would silently
    fall back to a vague refusal — this fails loudly instead.
    """
    for tool in SUBAGENT_ONLY_TOOLS:
        assert tool in _DENIAL_REASONS, f"{tool} has no bespoke denial reason"
        # The reason should reference the tool it denies.
        assert tool in _DENIAL_REASONS[tool]


# --- grounding against the REAL skill files -------------------------------
#
# The two tests above encode the intent; these pin it to what the repo
# actually declares, so a future edit to either SKILL.md fails loudly here
# instead of silently breaking browsing or silently un-guarding the router.


def _skills_dir():
    # .../eval/harness/tests/unit/this.py -> parents[4] is the repo root.
    from pathlib import Path

    return Path(__file__).resolve().parents[4] / "packages/engine/plugin/skills"


def test_real_search_images_does_not_declare_image_read():
    from harness.allowed_tools import declared_skill_tools

    declared = declared_skill_tools("search-images", _skills_dir())
    assert "image_read" not in declared, (
        "search-images must NOT declare image_read — it browses volumes page-by-page "
        "by delegating each page to @plugin:image-reader, so the base64 never enters "
        "the skill's context. Declaring it here would exempt the browse loop from the "
        "guard and reopen the accumulation crash."
    )
    assert (
        subagent_only_violation(_main("mcp__genealogy__image_read"), declared)
        == "image_read"
    )


def test_real_record_extraction_does_not_declare_image_read():
    from harness.allowed_tools import declared_skill_tools

    declared = declared_skill_tools("record-extraction", _skills_dir())
    assert "image_read" not in declared, (
        "record-extraction must NOT declare image_read — it delegates to "
        "@plugin:image-reader so the base64 never enters the router's context. "
        "Declaring it here would exempt the router from the guard."
    )
    assert (
        subagent_only_violation(_main("mcp__genealogy__image_read"), declared)
        == "image_read"
    )


def test_no_skill_declares_extraction_append():
    """The #942 guard rests on extraction_append having no legitimate main-thread
    caller. Pin that to the real skill frontmatter so a future skill that
    declares it — reopening the router-substitution path — fails loudly here.
    """
    from harness.allowed_tools import declared_skill_tools

    for skill_dir in sorted(_skills_dir().iterdir()):
        if not (skill_dir / "SKILL.md").exists():
            continue
        declared = declared_skill_tools(skill_dir.name, _skills_dir())
        assert "extraction_append" not in declared, (
            f"{skill_dir.name} declares extraction_append in its allowed-tools — "
            "no skill may. The tool belongs only to @plugin:record-extractor; a "
            "skill declaring it would exempt its router from the #942 guard. If "
            "this is intentional, the guard needs the per-skill declared-tools "
            "scoping that image_read uses."
        )
    # And the record-extraction router in particular is guarded on the main thread.
    declared = declared_skill_tools("record-extraction", _skills_dir())
    assert (
        subagent_only_violation(
            _main("mcp__genealogy__extraction_append"), declared
        )
        == "extraction_append"
    )


def test_record_extractor_agent_declares_extraction_append():
    """The other half of the invariant: the tool must live on the record-extractor
    agent's `tools:` frontmatter, under BOTH server spellings (CLAUDE.md
    "Dual-spelled tool names"), or the guard would deny a call nobody can
    legitimately make.

    Checks the qualified `mcp__…` spellings inside the YAML frontmatter — NOT the
    bare `extraction_append`, which appears throughout the prose body (Step 4).
    A bare-substring check would still pass if someone deleted the tools: entries
    (leaving the subagent unable to call it) or dropped one of the two required
    spellings, so it must key on what actually grants the tool.
    """
    from pathlib import Path

    agent = (
        Path(__file__).resolve().parents[4]
        / "packages/engine/plugin/agents/record-extractor.md"
    )
    text = agent.read_text(encoding="utf-8")
    # Isolate the YAML frontmatter (between the first two `---` fences). maxsplit=2
    # keeps any `---` thematic break in the body out of parts[1].
    parts = text.split("---", 2)
    assert len(parts) >= 3, "record-extractor.md must open with YAML frontmatter"
    frontmatter = parts[1]
    for spelling in (
        "mcp__genealogy__extraction_append",
        "mcp__remote-devices__Genealogy_Research__extraction_append",
    ):
        assert spelling in frontmatter, (
            f"record-extractor.md frontmatter must declare {spelling} — the tool "
            "is held only by this agent, and CLAUDE.md requires both server "
            "spellings; a prose mention of the bare name does not grant it."
        )
