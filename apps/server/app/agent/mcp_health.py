"""Is the genealogy MCP tool surface actually present in this hosted session?

**Source of truth: `eval/harness/e2e/mcp_health.py`.** The classification below
is a deliberate copy of that module's init-time half, not a second derivation —
if the three-way split changes, change it there first and mirror it here.

*Why a copy and not an import.* The E2B agent image bakes
`COPY apps/server/app ${AGENT_HOME}/server/app` (`apps/server/sandbox/e2b.Dockerfile`)
and nothing else; `eval/harness/` is not in the sandbox, so the harness copy is
unreachable from the process that needs it. Same no-runtime-sharing shape as the
engine/plugin split in CLAUDE.md.

*What the harness proved, and what production must do differently.* Issue #941
lost three e2e runs (60-90 min each, live FamilySearch) to a genealogy MCP
server that never connected. The runs did not crash — the agent improvised with
Glob/Read/WebSearch for 35 minutes and two of the three declared success.
Production is worse off than the harness here: the harness aborts such a run
before spending anything, while a hosted session just *runs*, the model simply
having no genealogy tools, and the user pays a full session for research that
could not have happened.

But production cannot abort — there is no run to end, there is a person
mid-conversation. So this module classifies exactly as the harness does and then
**warns once**, leaving the turn to proceed. `unavailable_message` is therefore
the one piece NOT copied: the harness's words are "RE-RUN the test" and "run
`make e2e-preflight`", addressed to a genealogist running a fixture and nonsense
to a web user who has neither.

Deliberately pure — no SDK import, no I/O — so every arm is unit-testable
without driving an async message loop.
"""

from __future__ import annotations

from typing import Any, Literal

# The key the hosted control plane registers the server under, and therefore the
# name the CLI reports back (`real_agent.py`'s `mcp_servers={"genealogy": …}`).
# Not the Cowork spelling — see CLAUDE.md § "Dual-spelled tool names" for why
# the product has three.
GENEALOGY_SERVER_NAME = "genealogy"

# The prefix every genealogy tool call carries under that registration. Used to
# tell "no genealogy work has happened yet" from "the surface died mid-session".
GENEALOGY_TOOL_PREFIX = "mcp__genealogy__"

_UNAVAILABLE_STATUSES = frozenset({"failed", "needs-auth", "disabled"})

# `connected` is the only status that proves the surface is there. `pending` is
# a real transient state — the CLI seeds every client `{name, type: "pending"}`
# and rewrites it as each connect settles — so it is classified INCONCLUSIVE,
# never as failure.
#
# That is not a precaution; it is measured (harness, 2026-08-04). The init
# message for a HEALTHY genealogy server arrives at ~11s carrying "pending" (it
# settles to "connected" at ~25s), while a server that died at startup has
# already settled to "failed" by the time its init arrives. So a
# `status != "connected"` warning would fire on EVERY healthy session, and the
# three-way split is what makes the init check safe to ship.
McpHealth = Literal["connected", "unavailable", "inconclusive"]


def find_server_entry(
    entries: Any, name: str = GENEALOGY_SERVER_NAME
) -> dict[str, Any] | None:
    """The `{name, status, …}` entry for `name`, or None if it isn't listed.

    Tolerates None and malformed members: this reads a payload from another
    process, and a detector that raises on odd input would break the very
    sessions it was meant to protect.

    Scoping by name is load-bearing, not tidiness: the list carries every server
    the session knows about, including the operator's own claude.ai connectors
    (observed live: "claude.ai Google Drive" and "claude.ai Slack", both
    `needs-auth`). Judging health from "any unhealthy server" would warn on
    every session on such a machine.
    """
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, dict) and entry.get("name") == name:
            return entry
    return None


def classify_server_status(
    entries: Any, name: str = GENEALOGY_SERVER_NAME
) -> McpHealth:
    """Three-way health of the named server, from a CLI-reported server list.

    - `"connected"`     — the surface is present; nothing to do.
    - `"unavailable"`   — `failed` / `needs-auth` / `disabled`, or the server is
      **not listed at all** (the observed mode: the tools were simply absent).
    - `"inconclusive"`  — `pending`, an unrecognized status, or a payload with no
      server list at all (an older CLI, or a non-init system message). Never
      warns.
    """
    if not isinstance(entries, list):
        # No list to read: say nothing rather than accuse the environment.
        return "inconclusive"
    entry = find_server_entry(entries, name)
    if entry is None:
        # A list of server dicts that simply does not name us IS the observed
        # failure: the tools were absent from the session. But a list with no
        # dict members at all — or an empty one — is not evidence of absence, it
        # is evidence we are reading a shape we do not understand. (The CLI
        # seeds every configured client as `pending` before connecting, so a
        # genuinely configured server is present from the first init; an empty
        # list means not-yet-populated.)
        if not any(isinstance(e, dict) for e in entries):
            return "inconclusive"
        return "unavailable"
    status = entry.get("status")
    if status == "connected":
        return "connected"
    if status in _UNAVAILABLE_STATUSES:
        return "unavailable"
    return "inconclusive"


def should_warn_at_init(health: McpHealth, *, mcp_call_count: int) -> bool:
    """Whether an `init` reading should warn the user.

    `unavailable` alone is not enough, for the harness's reason
    (`should_abort_at_init`) transposed: the init branch is reachable more than
    once, because a resumed or re-spawned CLI emits a fresh `init`. If that
    second spawn reads unhealthy in a session that has *already* made genealogy
    calls, telling the user "no research is possible here" would be false —
    research demonstrably happened. Only a session that has attempted nothing
    can be told nothing was possible.
    """
    return health == "unavailable" and mcp_call_count == 0


def unavailable_message(entry: dict[str, Any] | None) -> str:
    """What a hosted user reads when the genealogy tools are absent.

    NOT the harness's wording — see the module docstring. Its job is the same
    (stop someone treating a session that could not research as a research
    result) but the audience has no test to re-run and no Makefile, and the
    session is still live, so it is phrased as a warning rather than a verdict.

    The server's own `error` text is deliberately not quoted: it is upstream
    process output, which is exactly the raw-text leak #1126 exists to close.
    It goes to the operator log instead.
    """
    if entry is None:
        cause = "never started"
    else:
        cause = f"reported {(entry.get('status') or 'an unknown state')!r}"
    return (
        f"The genealogy research tools are unavailable in this session — they "
        f"{cause}. Anything the assistant says now is written without access to "
        "FamilySearch records, so please do not treat it as research. Nothing "
        "you did caused this — start a new session, and report it if it "
        "happens again."
    )
