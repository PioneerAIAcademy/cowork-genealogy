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


def decision(payload: dict) -> dict:
    """The hook's stdout payload: a deny, or `{}` for no opinion."""
    tool_input = payload.get("tool_input")
    name = protected_target(
        str(payload.get("tool_name") or ""),
        tool_input if isinstance(tool_input, dict) else {},
    )
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
