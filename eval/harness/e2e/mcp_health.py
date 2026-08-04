"""Is the genealogy MCP tool surface actually present in this session?

Issue #941: genealogists lost three e2e runs (60-90 min each, live
FamilySearch) to a genealogy MCP server that never connected. The runs did not
crash — the agent improvised with Glob/Read/WebSearch/raw Edit for 35 minutes
and two of the three declared success. Nothing distinguished that from a
genuine research failure, so the reported symptom was "the fixture failed"
rather than "the environment was broken".

**Detect absence, not an error reply.** Across the three lost runs the agent
made zero `mcp__` calls out of 275 total. No call was made, so no "tool not
found" error was ever returned — the tools were simply not in the session. With
`ENABLE_TOOL_SEARCH=true` (the harness default) the genealogy schemas are
deferred rather than loaded up front, so absence surfaces only as `ToolSearch`
answering "No matching deferred tools found".

Two detectors, one vocabulary:

1. **At session start** — the CLI's `system`/`init` message carries
   `mcp_servers: [{name, status}]` (a *required* field of its own init schema,
   emitted from `H.mcpClients.map(A => ({name: A.name, status: A.type}))`).
   `classify_server_status` reads it. This is the cheap, decisive check.
2. **Mid-run backstop** — for a server that dies after init:
   `tool_search_miss_streak` counts consecutive no-match `ToolSearch` results
   while zero `mcp__` calls have ever succeeded.

Preflight asks the CLI the same question a different way
(`ClaudeSDKClient.get_mcp_status()`), whose `mcpServers` entries have the same
`{name, status}` shape — so it shares this module's classifier *and*
`genealogy_mcp_config`. That sharing is the point: a preflight that proves a
*different* config than the run uses is the bug class #941 exists to close.

Deliberately pure — no SDK import, no I/O, no logging — because the async
message loop that consumes it cannot be unit-tested (see
`tests/unit/test_e2e_orchestrator.py`'s module docstring), so every arm of the
decision has to be testable here instead.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

# The key the orchestrator registers the server under, and therefore the name
# the CLI reports back. Not the Cowork spelling — a headless harness run
# chooses its own dict key (see CLAUDE.md § "Dual-spelled tool names" for why
# the product has two).
GENEALOGY_SERVER_NAME = "genealogy"

# The built-in tool the CLI answers deferred-schema lookups with.
TOOL_SEARCH_NAME = "ToolSearch"

# What ToolSearch says when it can find no tool matching the query. Matched
# case-insensitively against `response_summary`
# (orchestrator._summarize_tool_response).
#
# That summarizer was rewritten by #1241 while this was in review, and the
# marker survives both of its shapes — checked against the merged
# implementation, not the PR: a result that fits under the verbatim threshold is
# passed through untouched, and a larger one is summarized BY KEY rather than
# head-truncated. This marker is a 32-char whole payload, so it takes the
# verbatim path. Confirmed against the incident artifact, where the recorded
# value is exactly `"No matching deferred tools found"`
# (run-2026-07-29_12-16-49.json:1674).
#
# Considered and not used: the CLI's ToolSearch reply schema also carries
# `pending_mcp_servers` ({matches, query, total_deferred_tools,
# pending_mcp_servers?}), which would name the unready server directly and could
# fire on the FIRST miss instead of the third. It is unreachable, and NOT for the
# truncation reason an earlier draft of this comment gave: the tool result
# carries the CLI's *rendered text*, not its structured reply — that is why the
# recorded value is a bare string rather than a JSON envelope — so those fields
# never reach this code under any summarizer. Widening the bound would not
# expose them; only the CLI emitting the structured reply would.
NO_MATCH_MARKER = "no matching deferred tools"

# Consecutive no-match ToolSearch results (with zero successful `mcp__` calls)
# before the backstop aborts the run.
#
# CALIBRATED AGAINST THE INCIDENT, not guessed. Replaying the three lost runs
# (eval/runlogs/e2e/william-ferber-origins/run-2026-07-29_{02-09-46,12-16-49,
# 17-05-11}.json) the streak reaches 3 at tool call 14 / 12 / 19 of 89 / 112 /
# 74, and peaks at 4 / 4 / 5 — so 3 fires early with a margin of 1-2, while 5
# would MISS two of the three. The healthy control run from the same night
# (run-2026-07-29_18-46-15, verdict `pass`, 81 `mcp__` calls) never reaches a
# streak of 1, so this cannot false-abort a working run. Both numbers are
# regression-tested by the corpus replay in test_e2e_mcp_health.py.
CONSECUTIVE_TOOL_SEARCH_MISSES = 3

# CLI statuses that mean "this server will not serve tools in this session".
# `needs-auth` and `disabled` are as fatal to a run as `failed`: the tools are
# absent either way, which is the only thing the agent experiences.
_UNAVAILABLE_STATUSES = frozenset({"failed", "needs-auth", "disabled"})

# `connected` is the only status that proves the surface is there. `pending` is
# a real transient state — the CLI seeds every client `{name, type: "pending"}`
# and rewrites it as each connect settles — so it is classified INCONCLUSIVE,
# never as failure.
#
# That is not a precaution; it is measured. Against this CLI (2026-08-04) the
# init message for a HEALTHY genealogy server arrives at ~11s carrying
# "pending" (it settles to "connected"/47 tools at ~25s), while a server that
# died at startup has already settled to "failed" by the time its init arrives
# at ~25s. So a `status != "connected"` abort would have killed EVERY healthy
# e2e run, and the three-way split is what makes the init check safe. A
# `pending` that never resolves — or a dead server that settles late — produces
# exactly the zero-`mcp__`-calls signature the backstop watches for.
McpHealth = Literal["connected", "unavailable", "inconclusive"]


def genealogy_mcp_config(entry: Path | str) -> dict[str, dict[str, Any]]:
    """The `mcp_servers` block for a run — the one definition, shared.

    Both `ClaudeAgentOptions` in the orchestrator and preflight's own
    short-lived client build their config from here. Preflight proving a
    config the run does not use is the failure this issue was filed about.
    """
    return {
        GENEALOGY_SERVER_NAME: {
            "type": "stdio",
            "command": "node",
            "args": [str(entry)],
        },
    }


def find_server_entry(
    entries: Any, name: str = GENEALOGY_SERVER_NAME
) -> dict[str, Any] | None:
    """The `{name, status, …}` entry for `name`, or None if it isn't listed.

    Accepts the init message's `mcp_servers` or `get_mcp_status()`'s
    `mcpServers` — identical entry shape. Tolerates None and malformed
    members: this reads a payload from another process, and a detector that
    raises on odd input would abort runs it was meant to protect.

    Scoping by name is load-bearing, not tidiness: the list carries every
    server the session knows about, including the operator's own claude.ai
    connectors (observed live: "claude.ai Google Drive" and "claude.ai Slack",
    both `needs-auth`). Judging health from "any unhealthy server" would abort
    every run on a machine that has them.
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
    - `"unavailable"`   — abort: `failed` / `needs-auth` / `disabled`, or the
      server is **not listed at all** (the observed mode: the tools were simply
      absent from the session).
    - `"inconclusive"`  — `pending`, an unrecognized status, or a payload with
      no server list at all (an older CLI, or a non-init system message). Never
      an abort; the backstop covers a `pending` that never resolves.
    """
    if not isinstance(entries, list):
        # No list to read: say nothing rather than accuse the environment.
        return "inconclusive"
    entry = find_server_entry(entries, name)
    if entry is None:
        return "unavailable"
    status = entry.get("status")
    if status == "connected":
        return "connected"
    if status in _UNAVAILABLE_STATUSES:
        return "unavailable"
    return "inconclusive"


def is_no_match_tool_search(tool: str, response_summary: str | None) -> bool:
    """Whether this tool result is a ToolSearch that matched nothing.

    Keyed on the *result*, not the query text. Keying on an
    `mcp__genealogy__`-shaped query — as issue #941's text suggests — would
    miss the compliant case: CLAUDE.md requires plugin bodies to search by
    BARE name (`query: "+research_append"`), so a correct agent's query
    contains no qualified prefix at all. The incident transcript shows the
    qualified form only because the agent had already started improvising.
    """
    if tool != TOOL_SEARCH_NAME:
        return False
    return NO_MATCH_MARKER in (response_summary or "").lower()


def tool_search_miss_streak(
    streak: int,
    *,
    tool: str,
    response_summary: str | None,
    mcp_call_count: int,
) -> int:
    """The consecutive-miss streak after folding in one tool result.

    Consecutive *ToolSearch results*, not consecutive tool calls: in all three
    lost runs the agent interleaved Glob / Read / WebSearch between its
    searches, so a counter that reset on any other tool would never have
    reached the threshold. Unrelated tools therefore carry the streak
    unchanged; a ToolSearch that *matched* resets it.

    `mcp_call_count` is the run's `mcp__`-only counter: once any genealogy call
    has succeeded the surface demonstrably exists, so this arm is dead for the
    rest of the run and every result resets the streak.
    """
    if tool != TOOL_SEARCH_NAME:
        return streak
    if mcp_call_count == 0 and is_no_match_tool_search(tool, response_summary):
        return streak + 1
    return 0


def backstop_fired(streak: int) -> bool:
    """Whether a miss streak has reached the abort threshold."""
    return streak >= CONSECUTIVE_TOOL_SEARCH_MISSES


def unavailable_cause(entry: dict[str, Any] | None, *, backstop: bool = False) -> str:
    """Why the surface is judged absent — the half both callers share.

    Kept separate from the guidance below because the two contexts need
    *different* guidance: preflight runs before any test exists, so telling its
    reader to "re-run the test" and to "run make e2e-preflight" would be
    nonsense (observed live, 2026-08-04). What must not diverge is this clause,
    since it is what quotes the server's own error text.

    `entry` is the server's own status entry when there is one. Its `error` is
    `NotRequired` on the SDK type and documented as present only when the
    status is `failed` — and in the entry-absent arm there is no entry at all —
    so the text degrades to naming the absence rather than rendering `None`.
    """
    if backstop:
        cause = (
            f"{CONSECUTIVE_TOOL_SEARCH_MISSES} consecutive ToolSearch lookups "
            "found no matching tool and not one genealogy tool call has "
            f"succeeded, so the {GENEALOGY_SERVER_NAME!r} MCP server is gone"
        )
    elif entry is None:
        cause = (
            f"the {GENEALOGY_SERVER_NAME!r} MCP server never registered with "
            "the CLI — no server by that name was in the session"
        )
    else:
        status = entry.get("status") or "unknown"
        cause = f"the {GENEALOGY_SERVER_NAME!r} MCP server reported {status!r}"
        detail = entry.get("error")
        if detail:
            cause += f": {detail}"
    return cause


def unavailable_message(entry: dict[str, Any] | None, *, backstop: bool = False) -> str:
    """What a genealogist reads when a RUN is aborted. Criterion 4 is these words.

    Used by the orchestrator's abort (transcript + the run's `error` field) and
    printed verbatim by run_e2e. The job of this text is to stop someone
    re-researching a case that was never actually attempted.
    """
    return (
        f"MCP UNAVAILABLE — {unavailable_cause(entry, backstop=backstop)}.\n"
        "The genealogy tools were absent from this session, so no research was "
        "possible and nothing about this run reflects the fixture or the "
        "records.\n"
        "This is an ENVIRONMENT failure: RE-RUN the test. Do NOT re-research "
        "the case, and do not read this as a research result.\n"
        "To see the server's own error text, run `make e2e-preflight`."
    )
