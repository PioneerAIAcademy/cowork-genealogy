"""Per-context tool policy: tools only a delegated subagent may call.

Some tools are safe in an isolated subagent and unsafe on the main thread.
`image_read` is the motivating case: it returns a page scan as inline base64,
and if that lands in the router's context the bytes accumulate and overflow the
transport's ~1 MiB per-turn buffer, crashing the whole run. Every page is
therefore read with `image_transcribe`, which OCRs it host-side and stages the
text (#2490); the caller reads it with `sidecar_read` and hands the staged ref
to `record-structurer` for extraction.

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

One scope limit (plan §4.1):

- **Per-skill, not global.** The discriminator is the skill's own declaration —
  *you may call what you declared; you may not call what was granted only to
  your subagent*. A skill that claims a guarded tool for itself may call it
  directly; a global guard would deny those calls and break the skill. Callers
  pass the pre-union set from `allowed_tools.declared_skill_tools`.

  **The exemption is now REACHED.** It was unreachable while the set had two
  members that no skill declared; issue #2937 changed that. `research` and
  `search-records` declare `extraction_append` in their own `allowed-tools` and
  call it from the main thread as their ordinary route, and `extraction_append` accordingly left
  `SUBAGENT_ONLY_TOOLS` (see the set's own comment for what that retires).
  Neither current member is declared by a SKILL, so for both `agent_id`
  presence alone decides: `image_read` is declared by no skill and no agent —
  pages are read with `image_transcribe`, and the image-reader agents are retired
  (issue #2013, #2490) — and `evaluation_append` (issue #1491) is declared by the
  gps-mentor AGENT, whose own call is a subagent call the `agent_id` check
  exempts; a skill-level declaration is what the exemption reads, and there is
  none. Pinned by `tests/unit/test_context_policy.py`.

e2e enforcement covers **every member of `SUBAGENT_ONLY_TOOLS`** — `image_read`
(#1273) and `evaluation_append` (#1491), since `extraction_append` (#942) left
the set in issue #2937. Because no skill declares either member, `agent_id`
presence alone discriminates a legitimate subagent call from a router
substitution, which is all e2e can see — its sub-skills run in the same session
via the `Skill` tool with no `agent_id` to attribute them. The e2e block is
therefore tool-set-specific (`is_main_thread_subagent_only_tool` in
`e2e/orchestrator.py`, keyed on `SUBAGENT_ONLY_TOOLS` membership) rather than a
call to `subagent_only_violation`, which takes a `declared_tools` argument e2e
cannot supply. e2e imports
`bare_tool_name`, `is_subagent_call`, and `subagent_only_denial` from here.

(e2e imports from `harness.*`, never the reverse.)
"""

import importlib.util
from pathlib import Path
from typing import Any

# Tools that are unsafe on the main thread *when the skill did not claim them*.
#
# Membership here is necessary but NOT sufficient for a violation — see
# subagent_only_violation. The declaration in a skill's own `allowed-tools` is
# the discriminator: a skill may call what it declared; it may not call what was
# granted only to its subagent.
#
# - `image_read` — declared by NO agent since `image-reader-opus` was retired
#   (issue #2013). It STAYS in this set deliberately: the deny exists because the
#   tool returns a page scan as inline base64 that accumulates in the router's
#   context and overflows the transport buffer, and retiring the agent changed
#   nothing about that. The recovery target is `image_transcribe` (#2490, which
#   also retired the `image-reader` agent that wrapped it), so the denial reason
#   below names that. Dropping the entry would silently reopen the
#   main thread to inline scans — the opposite of issue #1874's direction.
#
# `extraction_append` was the second member and LEFT this set in issue #2937.
# That card routes extraction of a FamilySearch-indexed record through code
# rather than a `record-extractor` spawn (that agent is since retired), so
# `research` and `search-records` call `extraction_append` from the main thread
# as their ordinary path and declare it in their own `allowed-tools`. A deny here would refuse the shipped
# route on every eval run.
#
# WHAT THAT RETIRES, stated because nothing else records it: the #942 guard
# existed to catch the router substituting for a FAILED `record-extractor`
# spawn. The unindexed path (images, full text, external sites, prose) now
# delegates to `record-structurer` (issue #2939), so the router substituting for
# a failed `record-structurer` spawn is possible and is unchecked. `subagent_only_violation`'s declared-tools
# exemption is the mechanism that would distinguish the two, but
# `e2e/orchestrator.py`'s arm cannot supply `declared_tools`, so it does not
# reach e2e. Filed on the `nothing-checks` register (docs/architecture.md §9.4
# keeps that register as a LABEL, not a table, so this gap is a labelled issue).
#
# The declared-tools exemption below is NO LONGER unreachable: `research` and
# `search-records` declare `extraction_append`, which is exactly the case condition 3 describes.
#
# `evaluation_append` — the gps-mentor agent's verdict writer (issue #1491), a
# `research_append` scoped to `evaluations` by tool identity. gps-mentor is the
# only writer of that section and it always runs as a subagent, so a main-thread
# call is the router grading the work itself. Unlike `image_read` this member IS
# declared by an agent (gps-mentor's `tools:`), which is an AGENT declaration,
# not a skill `allowed-tools` one, so the declared-tools exemption (condition 3,
# skill-level) does not reach it and `agent_id` presence is what exempts the
# agent's own call. The hook plane denies the same write by caller identity
# (`guard_project_files.py` `OWNED_SECTIONS`/`owner_denied`); this is the harness
# e2e plane's half of the same deny.
#
# Keep this a plain set, not a policy engine. Matched on the bare name, so it is
# transport-agnostic.
SUBAGENT_ONLY_TOOLS = frozenset({"image_read", "evaluation_append"})


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
       that claimed the tool for itself may call it directly; a skill that
       holds it only through the agent-union may not. No skill declares either
       guarded tool today — pages are read with `image_transcribe` — so this
       exemption is currently unreachable, and `agent_id` presence alone decides (see
       `e2e/orchestrator.py` and e2e-test-spec §6.1.1).

    `declared_tools=None` means "unknown", and is treated as **declaring
    nothing** — i.e. the guard applies. Callers that cannot attribute a call to
    one skill should not use this function at all rather than pass None; see
    the e2e note in the module docstring.
    """
    # `or ""` rather than a get() default: a present-but-None `tool_name` would
    # make `bare_tool_name(None)` raise TypeError, and a raising PreToolUse hook
    # fails a call the agent was entitled to make (CLAUDE.md, "Plugin hooks").
    # Mirrors the fail-closed guard in e2e's `is_main_thread_subagent_only_tool`.
    bare = bare_tool_name(input_data.get("tool_name") or "")
    if bare not in SUBAGENT_ONLY_TOOLS:
        return None
    if is_subagent_call(input_data):
        return None
    if bare in (declared_tools or set()):
        return None
    return bare


# Per-tool denial reasons. The reason text is the model's ONLY feedback on a
# deny, so each guarded tool must name its own fix — a generic "not allowed here"
# just relocates the substitution. `image_read` has somewhere legitimate to go:
# `image_transcribe`, which reads the page host-side and stages it (#2490). (The `extraction_append`
# reason lived here until issue #2937 removed that tool from the set; it told the
# router to re-delegate a failed `record-extractor` spawn, since retired, rather
# than extract the record itself, issue #942.)
_DENIAL_REASONS = {
    "image_read": (
        "image_read may not be called from the main session — it returns "
        "inline base64 that overflows the transport buffer and crashes the "
        "run. Call image_transcribe with projectPath instead: triage on its "
        "`found` and `digest`, and read the page with "
        "sidecar_read({ projectPath, ref: staged.resultsRef }) when you need it."
    ),
    "evaluation_append": (
        "evaluation_append may not be called from the main session — the "
        "`evaluations` section is the gps-mentor agent's, which applies the "
        "mandatory proof critique. Writing it here would grade the work itself. "
        "Delegate: invoke `@plugin:gps-mentor` and let it append the evaluation."
    ),
}

# A fallback that still refuses, for a guarded tool added to SUBAGENT_ONLY_TOOLS
# without a bespoke reason. Never expected to fire (a test pins parity), but a
# deny with a vague reason beats a KeyError that crashes the hook.
_DENIAL_REASON_FALLBACK = (
    "{bare} may not be called from the main session — it is reserved for a "
    "delegated subagent. Delegate the work rather than doing it here."
)


def subagent_only_denial(bare: str) -> dict[str, Any]:
    """A PreToolUse deny payload for a subagent-only tool called on main.

    Deliberately returns no `stopReason`: a denied call is a recoverable
    mistake, not a fatal one. The run continues so the router can pivot —
    matching how the e2e tree-read block behaves. The reason text is the
    model's only feedback here, so it names the fix per tool (`_DENIAL_REASONS`).
    """
    reason = _DENIAL_REASONS.get(bare, _DENIAL_REASON_FALLBACK.format(bare=bare))
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


# ---------------------------------------------------------------------------
# Protected-file lockdown, imported (NOT copied) from the shipped plugin hook.
#
# The raw-write lockdown — deny Write/Edit/NotebookEdit on research.json and
# tree.gedcomx.json — ships in three copies (plugin hook, hosted SDK hook, e2e
# harness). The unit harness was the one tier missing it (issue #1493). Rather
# than add a fourth textual copy that could drift, we bind the *live* predicate
# object from the plugin hook. It is the only one of the three that is
# stdlib-only (`json`/`sys`), so importing it here pulls in no `claude_agent_sdk`
# — unlike `real_agent`/`orchestrator`, whose predicates the parity test must
# `ast`-extract because importing them would run a foreign venv's imports.
#
# An imported predicate cannot diverge from what the plugin ships, which is
# strictly stronger than a vector-checked copy; that is why #1493 mandates
# "import, do not copy" and why IMPLEMENTATIONS in test_write_lockdown_parity.py
# stays at three. Do NOT rebind `_guard.PROTECTED_PROJECT_FILES` to a
# module-level name here: `test_no_unregistered_copy_of_the_lockdown_exists`
# greps for `PROTECTED_PROJECT_FILES[[:space:]]*[:=]` and would flag this module
# as a fourth copy. Reach it as `_guard.PROTECTED_PROJECT_FILES` only.
# ---------------------------------------------------------------------------

_GUARD_HOOK_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "engine"
    / "plugin"
    / "hooks"
    / "guard_project_files.py"
)


def _load_guard():
    """Import the shipped plugin hook module by file path.

    Fail-closed on purpose: if the plugin hook cannot be loaded, raise here
    rather than degrade to allowing every write — a silent None would recreate
    exactly the "nothing checks" gap #1493 closes. The plugin file is always
    present in a checkout, so this only fires on a genuinely broken tree.
    """
    spec = importlib.util.spec_from_file_location(
        "_genealogy_guard_project_files", _GUARD_HOOK_PATH
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load guard hook at {_GUARD_HOOK_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_guard = _load_guard()


#: research.json sections the shipped hook routes to a named agent, mapped to
#: that agent's bare name. Reached through `_guard` so there is exactly ONE
#: definition — the plugin hook's — rather than a harness copy that drifts.
#: Same discipline as PROTECTED_PROJECT_FILES above: do not rebind this to a
#: module-level literal, or the copy is back.
OWNED_SECTIONS = _guard.OWNED_SECTIONS

#: The field-scoped half of the same map: `(section, field) -> owning agent`.
#: Same import-don't-copy discipline as `OWNED_SECTIONS` above.
OWNED_DECLARATIONS = _guard.OWNED_DECLARATIONS

#: The presence-keyed field map: `(section, field) -> owning agent`, routed on
#: the field being written at all rather than on a claim value. Same
#: import-don't-copy discipline as the two maps above.
OWNED_FIELDS = _guard.OWNED_FIELDS

#: The multi-field claim map: `section -> (owning agent, claim fields, claim
#: status)`, routed on a conflict's analytical product. Same discipline.
OWNED_CLAIMS = _guard.OWNED_CLAIMS

#: The op-scoped map: `section -> owning agent`, routed on `op: "append"` only.
#: Same discipline.
OWNED_APPENDS = _guard.OWNED_APPENDS

#: The shipped hook's own ownership predicate, re-exported rather than
#: reimplemented. `e2e/orchestrator.py` carried a second copy of the rule until
#: 2026-08-23 — it imported the map above and the reason text below, so the two
#: planes looked single-sourced while the RULE was written twice. It had no
#: out-of-lane arm at all, so a dedicated agent writing outside its section set
#: was denied in Cowork and allowed in e2e.
owner_denied = _guard.owner_denied


def owned_section_denial(denied: tuple[str, str, str]) -> dict[str, Any]:
    """A PreToolUse deny for a `research_append` op the ownership rule refuses.

    Takes `owner_denied`'s `(section, rule, caller)` triple directly, so there is
    no second shape to keep in step.

    The text is the SHIPPED hook's own `deny_reason`, not a copy of its
    rule-to-reason switch, so the harness denies with the text the agent meets
    in Cowork and a new rule tag is added in one place.

    It cannot reuse `subagent_only_denial`: that one says the TOOL is reserved
    for a subagent, which is true of `image_read` and flatly false of
    `research_append` — the general writer, called from the main thread
    constantly for plans, conflicts and the log. An agent told
    otherwise stops writing all of them. Only the section is routed.
    """
    reason = _guard.deny_reason(denied)

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


def protected_file_denial(tool_name: str, tool_input: Any) -> dict[str, Any] | None:
    """A PreToolUse deny payload for a raw write to a protected project file.

    Returns None when the call is not a protected-file write (the hook should
    then fall through to the normal permission flow). Reuses the plugin hook's
    own `protected_target` predicate and `REASON` text, so the unit harness
    denies exactly what ships in Cowork, with identical feedback. No
    `stopReason` — a denied write is recoverable, matching `subagent_only_denial`
    and the e2e tree-read block.
    """
    name = _guard.protected_target(
        tool_name, tool_input if isinstance(tool_input, dict) else {}
    )
    if name is None:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": _guard.REASON.format(
                tool=tool_name or "This tool", name=name
            ),
        },
    }
