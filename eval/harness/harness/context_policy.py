"""Per-context tool policy: tools only a delegated subagent may call.

Some tools are safe in an isolated subagent and unsafe on the main thread.
`image_read` is the motivating case: it returns a page scan as inline base64,
and if that lands in the router's context the bytes accumulate and overflow the
transport's ~1 MiB per-turn buffer, crashing the whole run. The
record-extraction skill therefore delegates every image read to the
`image-reader` subagent, which absorbs the base64 in a throwaway context and
returns text only (`record-extraction/SKILL.md` §4, `agents/image-reader.md`).

Until now that rule was prose, and prose did not hold — the router was observed
calling `image_read` directly (runlog v1_2026-07-16_20-23-34). It cannot be
enforced by the allowlist: per-agent `tools:` is *subtractive* (an agent narrows
a set it inherits from the session), so the session list is necessarily a
superset of every agent's list and can never express "the agent may, the router
may not". `compute_allowed_tools` must therefore union the delegated agent's
tools into the session list, which hands the router the very tool it must not
call.

The PreToolUse hook can express it, because `PreToolUseHookInput` carries
`agent_id`: present only when the hook fires inside a Task-spawned subagent,
**absent on the main thread** (claude_agent_sdk types.py, `_SubagentContextMixin`).
Probe-verified against the pinned CLI + SDK 0.1.81 — see
`docs/plan/image-read-context-policy.md` §3.1.

Two scope limits, both forced by `search-images` (plan §4.1):

- **Per-skill, not global.** `search-images` declares `image_read` in its own
  `allowed-tools` and browses volumes page-by-page itself; a global guard would
  deny every one of those calls and break the skill. The discriminator is the
  skill's own declaration — *you may call what you declared; you may not call
  what was granted only to your subagent*. Callers pass the pre-union set from
  `allowed_tools.declared_skill_tools`.
- **Unit harness only.** The e2e orchestrator cannot use this: its sub-skills
  run in the same session via the `Skill` tool with no `agent_id` to attribute
  them, so a legitimate `search-images` browse is indistinguishable from a
  record-extraction router violation. e2e imports `bare_tool_name` from here
  and nothing else.

(e2e imports from `harness.*`, never the reverse.)
"""

from typing import Any

# Tools that are unsafe on the main thread *when the skill did not claim them*.
#
# Membership here is necessary but NOT sufficient for a violation — see
# subagent_only_violation. `search-images` declares `image_read` in its own
# `allowed-tools` and browses pages itself, which is legitimate and must keep
# working; `record-extraction` does not declare it and holds it only via
# `@plugin:image-reader`, so its router must delegate. The declaration is the
# discriminator.
#
# Keep this a plain set, not a policy engine — one entry does not justify
# machinery. Matched on the bare name, so it is transport-agnostic.
SUBAGENT_ONLY_TOOLS = frozenset({"image_read"})


def bare_tool_name(tool_name: str) -> str:
    """Strip the `mcp__<server>__` prefix to get the advertised tool name.

    Lifted verbatim from `e2e/orchestrator.py`, which now imports it from here
    — there were already two copies (orchestrator + subagent_capture) before
    this module needed a third. Semantics preserved exactly, including the
    split on *any* `__` rather than only an `mcp__` prefix, so existing callers
    and `tests/unit/test_e2e_tree_block.py` are unaffected.
    """
    return tool_name.rsplit("__", 1)[-1] if "__" in tool_name else tool_name


def is_subagent_call(input_data: dict[str, Any]) -> bool:
    """Whether this PreToolUse firing came from inside a delegated subagent.

    Keys on the **presence** of `agent_id`, not on `agent_type` and not on a
    truthiness check. Two reasons, both load-bearing:

    - On the main thread the SDK omits `agent_id` from the payload entirely
      rather than setting it to None, so `in` is the honest test.
    - `agent_type` is *also* present on the main thread of a session started
      with `--agent` (without `agent_id`), so an `agent_type`-keyed predicate
      would misread such a session as a subagent.
    """
    return "agent_id" in input_data


def subagent_only_violation(
    input_data: dict[str, Any],
    declared_tools: set[str] | None = None,
) -> str | None:
    """Return the bare tool name if this call breaks the policy, else None.

    A violation requires all three:

    1. The tool is guarded (`SUBAGENT_ONLY_TOOLS`).
    2. The call is on the main thread (no `agent_id`). The delegation itself —
       the `Agent`/`Task` call — is a main-thread call but is not the guarded
       tool, so it is never a violation; denying it would break the very path
       we want the router to take.
    3. The skill did **not** declare the tool in its own `allowed-tools`
       (`declared_tools`, from `allowed_tools.declared_skill_tools`). A skill
       that claimed the tool for itself may call it: `search-images` browses
       volumes page-by-page via `image_read` and must keep working. A skill
       that holds it only through the agent-union may not.

    `declared_tools=None` means "unknown", and is treated as **declaring
    nothing** — i.e. the guard applies. Callers that cannot attribute a call to
    one skill should not use this function at all rather than pass None; see
    the e2e note in the module docstring.
    """
    bare = bare_tool_name(input_data.get("tool_name", ""))
    if bare not in SUBAGENT_ONLY_TOOLS:
        return None
    if is_subagent_call(input_data):
        return None
    if bare in (declared_tools or set()):
        return None
    return bare


def subagent_only_denial(bare: str) -> dict[str, Any]:
    """A PreToolUse deny payload for a subagent-only tool called on main.

    Deliberately returns no `stopReason`: a denied call is a recoverable
    mistake, not a fatal one. The run continues so the router can pivot to
    delegating — matching how the e2e tree-read block behaves. The reason text
    is the model's only feedback here, so it names the fix.
    """
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"{bare} may not be called from the main session — it returns "
                "inline base64 that overflows the transport buffer and crashes "
                "the run. Delegate to the image-reader subagent "
                "(@plugin:image-reader), which returns a text transcription."
            ),
        },
    }
