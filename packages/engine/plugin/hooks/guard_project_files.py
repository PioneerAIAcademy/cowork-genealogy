#!/usr/bin/env python3
"""Deny raw Write/Edit/NotebookEdit on research.json and tree.gedcomx.json.

Every write to those two files must go through the MCP writer tools
(`research_append`, `research_log_append`, `tree_edit`, `tree_correct`), which
validate before persisting. A direct file write never validates.
`research/SKILL.md` has forbidden it in prose since the beginning and no
skill's `allowed-tools` lists bare Write/Edit; this is the same rule as a
denial. See `docs/plan/research-guardrail-bypass-plan.md` §4.3, issue #940.

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

REASON = (
    "{tool} on {name} is disabled — all writes to research.json/tree.gedcomx.json "
    "must go through the writer tools (research_append, research_log_append, "
    "tree_edit, tree_correct), which validate before persisting. Direct file "
    "writes never validate."
)


def protected_target(tool_name: str, tool_input: dict) -> str | None:
    """The protected filename this call targets, or None.

    Only the file-write tools are candidates — the MCP writer tools are a
    different code path and are the sanctioned route. Both path separators are
    handled: splitting on "/" alone made the e2e copy of this rule a silent
    no-op on Windows, where the model composes `C:\\...\\research.json`.
    """
    if tool_name not in ("Write", "Edit", "NotebookEdit"):
        return None
    file_path = str((tool_input or {}).get("file_path") or "")
    name = file_path.replace("\\", "/").rsplit("/", 1)[-1]
    return name if name in PROTECTED_PROJECT_FILES else None


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
