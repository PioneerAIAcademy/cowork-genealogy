#!/usr/bin/env python3
"""Deny raw Write/Edit/NotebookEdit on research.json and tree.gedcomx.json.

Every write to those two files must go through the MCP writer tools, which
validate before persisting. A direct file write never validates. `project_create`
brings a project into being (both files, one validated call); `research_append`,
`research_log_append`, `tree_edit` and `tree_correct` add to one that exists.

**The deny message names `project_create` deliberately.** Naming only the
add-to-an-existing-project tools is what produced the bypass this guard exists to
prevent: in an empty folder every one of them refuses with "not found in
projectPath", so an agent told to use them had nowhere to go and reached for the
shell instead. A deny has to leave a working alternative, and in an empty folder
`project_create` is the only one.
`research/SKILL.md` has forbidden it in prose since the beginning and no
skill's `allowed-tools` lists bare Write/Edit; this is the same rule as a
denial. See `docs/specs/guardrail-enforcement-spec.md` §6, issue #940.

**Why this ships in the plugin rather than only in the host.** A `PreToolUse`
hook is the only instrument that can restrain the MAIN THREAD — a per-agent
`tools:` allow-list is subtractive and can only narrow what a subagent
inherits. But `hooks=` is an SDK argument, and Cowork's session options are not
ours to set, so a host-side hook can never reach Cowork. A plugin-shipped
`hooks/hooks.json` does: verified live in Cowork (a canary write was
hard-denied and the agent surfaced this script's own reason text), after the
upstream reports that plugin PreToolUse command hooks are dropped
(anthropics/claude-code#34573) were found not to reproduce on the current
build. Cowork runs `permission_mode: "default"`; the hosted path runs
`bypassPermissions`, and a hook binds under both.

Contract, from the hook protocol: read the payload as JSON on stdin, print a
decision to stdout, exit 0. Printing `{}` means "no opinion" — the normal
permission flow applies.

Stdlib only (it runs in the VM, which has no third-party packages) and it must
never raise: an exception here would be an error on a tool call the user was
entitled to make. Every failure path falls through to allowing the call, which
is the same posture the prose rule had.
"""
import json
import sys

# Matched on the basename, so an absolute or relative path is caught alike.
PROTECTED_PROJECT_FILES = ("research.json", "tree.gedcomx.json")

# The raw file-write tools. Their `file_path` is unambiguously a destination —
# there is no reading of `Write(file_path=...)` where that file is an input.
FILE_WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")

# The device-bridge writer, matched on the BARE TAIL because Cowork namespaces
# it (`mcp__remote-devices__device_commit_files`) and the plugin cannot control
# the prefix — the same reason agent frontmatter carries every spelling.
#
# This is the route that actually mattered. Measured live 2026-08-15: with a
# connected folder the agent runs in a cloud sandbox and reaches the user's disk
# over this bridge, and `init-project` created both protected files through it
# across a run in which Write/Edit/NotebookEdit appear nowhere. `Write` cannot
# reach the user's files at all there — it writes a container-local copy and
# reports success. So the guard denied the operation that cannot do harm and
# permitted the one that can.
#
# `device_bash` is deliberately NOT here. Its input is a command string, where
# `cat research.json` and `cat > research.json` are indistinguishable without
# parsing a shell, and 37 of the 40 shell touches of a protected file in the
# committed corpus are reads the system depends on. Denying on a mention would
# refuse them; the false deny is the worse failure. See the guardrail spec.
DEVICE_WRITE_TOOLS = ("device_commit_files",)

# A path never contains a newline, and is never longer than the platform allows.
# Both bounds exist to keep the scan below off file CONTENT travelling in the
# same payload — but only the newline bound does real work there, since content
# with a newline anywhere in it is rejected whole. The length bound catches only
# long SINGLE-LINE content, which has to end in "/research.json" to matter.
#
# 4096 = Linux PATH_MAX, the longest a real path can be on any plane we run on
# (macOS 1024; Windows extended-length 32767 but its APIs cap far lower). It was
# 400, which is under every one of those and so produced a genuine MISS: a
# 401-char path to research.json was allowed through. Pinned in both directions
# by vectors in test_write_lockdown_parity.py — deleting either bound, or
# restoring 400, now fails.
_MAX_PATH_LEN = 4096

# research.json sections whose owner is enforced by caller identity, mapped to
# the BARE agent name that owns each. Rows come from
# `docs/specs/schemas/ownership.json`; a row reaches this map only when its
# `enforceableAt` names the `hook` plane, it declares a `hookCallers` agent, AND
# the whole section is routed. A row that satisfies the first two but routes only
# one FIELD lands in OWNED_DECLARATIONS below instead — `questions` is that
# shape, and adding it here would deny `question-selection` its own 197 corpus
# question creations.
#
# The section name is hardcoded rather than read from the manifest because a
# hook runs in the VM with no access to the repo — `cwd` is the sandbox and the
# connected folder is not mounted there. Keeping the two in step is the
# manifest's `hookCallers` field plus this comment, not a loader.
OWNED_SECTIONS = {"proof_summaries": "proof-conclusion"}

# Field-scoped routing: (section, field) -> the BARE agent name that may set it
# truthy. Same plane and same manifest as OWNED_SECTIONS, different granularity.
#
# `proof_summaries` is a whole section with one owner, so a section rule fits it.
# `exhaustive_declaration` is not: it is a REQUIRED property of every question
# (`research.schema.json`, `$defs.question.required`), so `question-selection`
# writes it on every question it creates, from the main thread, with no
# `agent_id`. Measured over 159 committed e2e runs, 197 of the 392 ops carrying
# the field are exactly those creations — a presence-keyed rule denies every one.
#
# So the rule keys on the CLAIM, not the field: an op setting
# `exhaustive_declaration.declared` to true. A question being created carries
# `declared: false` and passes; so does an honest early termination, which is the
# same skill's own `declared: false` path and claims nothing. What is routed is
# the assertion that GPS Component 1 is satisfied, which is the artifact 47 of
# 131 corpus runs wrote without ever invoking the skill that owns it.
OWNED_DECLARATIONS = {("questions", "exhaustive_declaration"): "research-exhaustiveness"}

# The reverse direction: the sections each named agent MAY write. Rows come from
# the same manifest -- every section whose `callers` names that agent's skill.
#
# This is a SECOND rule, not a restatement of the one above, and it catches a
# different failure. OWNED_SECTIONS stops everyone else reaching a section; this
# stops the owner reaching everything else. Measured 2026-08-19: blocked from
# concluding by an unresolved conflict, the proof-conclusion agent wrote
# `status: "resolved"` onto that conflict itself -- with weighing and
# independence analysis -- and then concluded. It needed no tool it lacked; it
# used the broad writer it legitimately holds, on a section it does not own.
# `disallowedTools:` cannot express that: the granularity there is the tool, and
# the tool was the right one. Only a section-level check reaches it.
#
# A section owned by a SKILL cannot be enforced through OWNED_SECTIONS -- there
# is no agent to permit, so a permit-the-owner rule would deny the owning
# skill's own write. `conflicts` is that shape, which is why it is covered here.
AGENT_WRITABLE_SECTIONS = {
    "proof-conclusion": frozenset({"proof_summaries", "questions", "project"}),
    # research-exhaustiveness writes one field on one question and nothing else.
    # Narrower than proof-conclusion's set deliberately: the refusal it meets
    # when a plan item is still in flight is satisfied by the SEARCH skill that
    # owns `plan_items`, not by this agent, so leaving `plans`/`plan_items` out
    # is what stops it clearing its own blocker (issue #1821).
    "research-exhaustiveness": frozenset({"questions"}),
}

# The deny NAMES THE ROUTE OUT, and that is load-bearing rather than polite.
# A refusal with no working alternative is what produced the bypass this whole
# guardrail exists to stop: agents told to use a door that was locked went
# through the wall instead. If a bare-name delegation ever fails and the model
# retries as a general-purpose stand-in, this message is what turns the refusal
# into a recoverable in-turn pivot rather than an unwritable artifact.
OWNER_REASON = (
    "Writing research.json's `{section}` from here is disabled — that section is "
    "owned by the {agent} agent, which applies the tier and citation rules the "
    "section depends on. Delegate the write: invoke `@plugin:{agent}` and let it "
    "make the research_append call. Everything else in research_append is "
    "unaffected; only this section is routed."
)

DECLARATION_REASON = (
    "Declaring a question exhaustive from here is disabled — `{field}` with "
    "`declared: true` is owned by the {agent} agent, which applies the five "
    "threshold questions and the 7-point stop criteria this claim rests on. "
    "Delegate it: invoke `@plugin:{agent}` and let it make the research_append "
    "call. Only the claim is routed — creating a question with "
    "`declared: false`, and recording an honest `declared: false` termination, "
    "are both unaffected, as is everything else in `{section}`."
)

OUT_OF_LANE_REASON = (
    "Writing research.json's `{section}` is outside your lane — you may write "
    "{allowed} and nothing else. The skill that owns `{section}` applies rules "
    "you are not running. Report what you found and hand off to it; do not "
    "resolve it yourself so that your own work can proceed."
)

REASON = (
    "{tool} on {name} is disabled — all writes to research.json/tree.gedcomx.json "
    "must go through the writer tools. To CREATE a new project use project_create, "
    "which writes both files together; to add to an existing one use "
    "research_append, research_log_append, tree_edit or tree_correct. These "
    "validate before persisting. Direct file writes never validate."
)


def _basename(value: str) -> str:
    """The trailing segment, under either separator. Splitting on "/" alone made
    the e2e copy of this rule a silent no-op on Windows, where the model composes
    `C:\\...\\research.json`."""
    return value.replace("\\", "/").rsplit("/", 1)[-1]


def _path_like_strings(value, depth: int = 0):
    """Every string in `value` that could be a path, walked structurally.

    The device bridge's payload shape is not ours and is not recorded anywhere
    in this repo — we know the tool's NAME and that a deny binds, not its
    argument schema. So this does not guess a key; it walks whatever arrives and
    considers every string.

    Two filters keep it off file CONTENT travelling in the same payload: a path
    has no newline, and is not long. A content string that merely MENTIONS a
    protected file is still safe, because the caller compares whole basenames —
    "see research.json" has basename "see research.json", which matches nothing.
    """
    if depth > 6:
        return
    if isinstance(value, str):
        if value and "\n" not in value and len(value) <= _MAX_PATH_LEN:
            yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _path_like_strings(v, depth + 1)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _path_like_strings(v, depth + 1)


def protected_target(tool_name: str, tool_input: dict) -> str | None:
    """The protected filename this call targets, or None.

    Two routes, because they carry their destination differently:

    - The raw file-write tools name it in `file_path`, unambiguously.
    - The device-bridge writer carries a file list whose shape we do not
      control, so every string in the payload is considered.

    The MCP writer tools are neither — they are the sanctioned route and a
    different code path.

    **Fails open on an unrecognised device payload, deliberately.** If the bridge
    changes shape and no path-like string is found, this returns None and the
    call proceeds. The alternative — denying whenever we cannot parse it — would
    block a user asking Cowork to write any of their OWN files into a connected
    folder, which is not this guard's business and is a far worse failure than
    the hole. The hole is real and is why the spec requires a live Cowork check
    rather than treating this function's tests as proof.
    """
    if tool_name in FILE_WRITE_TOOLS:
        file_path = str((tool_input or {}).get("file_path") or "")
        name = _basename(file_path)
        return name if name in PROTECTED_PROJECT_FILES else None

    if _basename(tool_name.replace("__", "/")) in DEVICE_WRITE_TOOLS:
        for candidate in _path_like_strings(tool_input or {}):
            name = _basename(candidate)
            if name in PROTECTED_PROJECT_FILES:
                return name
        return None

    return None


def _ops(tool_input: dict):
    """Every op in a `research_append` call, batch or single.

    A batch puts them in `ops`; a single call carries `section` at the top
    level. Both shapes reach the same sections, so both are walked.
    """
    ops = (tool_input or {}).get("ops")
    if isinstance(ops, list):
        for op in ops:
            if isinstance(op, dict):
                yield op
    elif tool_input:
        yield tool_input


def owner_denied(tool_name: str, tool_input: dict, payload: dict) -> tuple | None:
    """`(section, rule, caller)` for a denied write, or None to allow.

    Two rules, both keyed on the caller and both returning the offending
    section: `routed` — a section reserved to an owning agent, reached by
    someone else; `out_of_lane` — a known agent reaching outside the sections
    its own skill is a declared caller for.

    `proof_summaries` is owned by `proof-conclusion`
    (`docs/specs/schemas/ownership.json`). Measured over the committed corpus,
    52 of the 142 runs that wrote a proof summary never launched the skill that
    owns it. Prose did not hold it — see ADR-0011 — so the caller is checked
    here, which is the only plane that can see who is calling.

    **Both caller keys are required.** `agent_id` is absent as a KEY on the main
    thread (test membership, never truthiness), and `agent_type` alone is not
    sufficient because it is also present on the main thread of a session
    started with `--agent`, which an `agent_type`-only rule would misread as a
    subagent (`eval/harness/harness/context_policy.py`). The tail comparison
    accepts both `proof-conclusion` and the namespaced
    `genealogy-research:proof-conclusion`, which is what production actually
    reports — a bare equality never fires there, and under `deny unless ==` that
    denies every caller including the owner.

    Covers `op: "update"` as well as `"append"`: the skill updates an existing
    `ps_NNN` in place on every re-conclusion, and a rule that saw only appends
    would leave that path denied in production with its fixture still green.
    """
    if _basename(tool_name.replace("__", "/")) != "research_append":
        return None
    caller = ""
    if "agent_id" in payload:
        caller = str(payload.get("agent_type") or "").rsplit(":", 1)[-1]
    writable = AGENT_WRITABLE_SECTIONS.get(caller)
    for op in _ops(tool_input):
        section = op.get("section")
        if not isinstance(section, str):
            continue
        # A routed section, reached by anyone but its owning agent.
        if section in OWNED_SECTIONS and caller != OWNED_SECTIONS[section]:
            return (section, "routed", caller)
        # A routed CLAIM, reached by anyone but its owning agent. Read from the
        # op's own payload — `fields` on an update, `entry` on an append — and
        # only when the op sets the claim TRUE. A `declared: false` write claims
        # nothing: it is either a question being created (197 of 392 corpus ops)
        # or an honest early termination, and both are the owning skill's own
        # sanctioned path.
        for (owned_section, field), owner in OWNED_DECLARATIONS.items():
            if section != owned_section or caller == owner:
                continue
            payload_obj = op.get("fields")
            if not isinstance(payload_obj, dict):
                payload_obj = op.get("entry")
            if not isinstance(payload_obj, dict):
                continue
            value = payload_obj.get(field)
            if isinstance(value, dict) and value.get("declared") is True:
                return (f"{section}.{field}", "declaration", caller)
        # A known agent reaching outside its own set.
        if writable is not None and section not in writable:
            return (section, "out_of_lane", caller)
    return None


def decision(payload: dict) -> dict:
    """The hook's stdout payload: a deny, or `{}` for no opinion."""
    tool_input = payload.get("tool_input")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    tool_name = str(payload.get("tool_name") or "")

    denied = owner_denied(tool_name, tool_input, payload)
    if denied is not None:
        section, rule, caller = denied
        # Branch on `rule`, never on the shape of `section` — a "declaration"
        # return carries a dotted `section.field`, which is a key in neither
        # OWNED_SECTIONS nor AGENT_WRITABLE_SECTIONS.
        if rule == "routed":
            reason = OWNER_REASON.format(section=section, agent=OWNED_SECTIONS[section])
        elif rule == "declaration":
            owned_section, _, field = section.partition(".")
            reason = DECLARATION_REASON.format(
                section=owned_section,
                field=field,
                agent=OWNED_DECLARATIONS[(owned_section, field)],
            )
        else:
            allowed = ", ".join(f"`{s}`" for s in sorted(AGENT_WRITABLE_SECTIONS[caller]))
            reason = OUT_OF_LANE_REASON.format(section=section, allowed=allowed)
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            },
        }

    name = protected_target(tool_name, tool_input)
    if name is None:
        return {}
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            # The model's only feedback, so it names the way out rather than
            # just refusing. No stopReason: a denied write is a recoverable
            # mistake and the turn should continue so it can pivot to the
            # writer tool.
            "permissionDecisionReason": REASON.format(
                tool=payload.get("tool_name") or "This tool", name=name
            ),
        },
    }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, OSError, ValueError):
        payload = {}
    print(json.dumps(decision(payload if isinstance(payload, dict) else {})))
    sys.exit(0)


if __name__ == "__main__":
    main()
