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
# CALIBRATED AGAINST THE INCIDENT, not guessed — and re-measured across the
# whole committed e2e corpus (142 run logs) when review found the starvation
# hole that `tool_search_miss_streak` now closes. Replaying the three lost runs
# (eval/runlogs/e2e/william-ferber-origins/run-2026-07-29_{02-09-46,12-16-49,
# 17-05-11}.json) the streak reaches 3 at tool call 12 / 11 / 13 of 89 / 112 /
# 74 and peaks at 15 / 8 / 17. Against the other 138 runs — every committed run
# that made at least one `mcp__` call — it peaks at **1**, so 3 keeps a margin
# of 2 over the worst healthy run in the corpus and cannot false-abort one of
# them. 5 would also detect all three, but buys nothing for the extra wall
# clock. (The fourth zero-`mcp__` run, run-2026-07-29_02-31-20, recorded no
# tool calls at all — it died during init, which preflight and the init check
# own, not this backstop.) Regression-tested by the corpus replay in
# test_e2e_mcp_health.py.
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
# died at startup has already settled to "failed" by the time its init
# arrives (~0.3-1.0s, re-measured 2026-08-27 on CLI 2.1.248; was ~25s on 2026-08-04). So a `status != "connected"` abort would have killed EVERY healthy
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
        # A list of server dicts that simply does not name us IS the observed
        # failure: the tools were absent from the session. But a list with no
        # dict members at all — or an empty one — is not evidence of absence,
        # it is evidence we are reading a shape we do not understand. This is
        # the one arm that aborts a run leaving NO artifact to diagnose from,
        # so an unreadable payload must not reach it. (The CLI seeds every
        # configured client as `pending` before connecting, so a genuinely
        # configured server is present from the first init; an empty list means
        # not-yet-populated, which the backstop covers.) Same reasoning as
        # find_server_entry's tolerance of malformed members.
        if not any(isinstance(e, dict) for e in entries):
            return "inconclusive"
        return "unavailable"
    status = entry.get("status")
    if status == "connected":
        return "connected"
    if status in _UNAVAILABLE_STATUSES:
        return "unavailable"
    return "inconclusive"


def should_abort_at_init(health: McpHealth, *, mcp_call_count: int) -> bool:
    """Whether an `init` reading should end the run outright.

    `unavailable` alone is not enough. The init branch is reachable more than
    once: a resume after a no-progress stall re-spawns the CLI — and with it the
    MCP server — and emits a fresh `init`. If that second spawn fails 40 minutes
    into a run that already made genealogy calls, aborting would discard every
    artifact of real research and print "no research was possible", which would
    be false. Only a run that has attempted NOTHING can be declared never to
    have happened; past that, losing the surface is a run that ends on its own
    terms and keeps what it found.
    """
    return health == "unavailable" and mcp_call_count == 0


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

    Consecutive *no-match ToolSearch results*, not consecutive tool calls: in
    all three lost runs the agent interleaved Glob / Read / WebSearch between
    its searches, so a counter that reset on any other tool would never have
    reached the threshold. Unrelated tools therefore carry the streak unchanged.

    **A ToolSearch that matched carries it too — only an `mcp__` call resets
    it.** `ENABLE_TOOL_SEARCH` defers the built-ins as well, so a match proves
    only that *some* deferred tool exists, which says nothing about ours;
    treating it as exculpatory let a dead server starve this counter forever
    (genealogy miss → `select:WebFetch` match → repeat, never reaching the
    threshold, run flails to the wall-clock cap). That is measured, not
    hypothetical: replaying the incident, matched lookups reset a live streak
    5 / 3 / 8 times, and the recorded queries are exactly that shape
    (`select:TodoWrite,WebFetch,WebSearch`, `select:WebFetch`,
    `select:PushNotification`). Detection survived only because enough misses
    happened to fall consecutively anyway — peaks of 4 / 4 / 5 against a
    threshold of 3. Genealogy-*intent* queries reset it too:
    `'record search familysearch'` and `'genealogy record search'` both matched
    something irrelevant, because ToolSearch ranks keywords and returns its best
    hit rather than nothing. Carrying instead of resetting raises those peaks to
    15 / 8 / 17 while leaving all 138 healthy runs at 1 (see the threshold
    comment above), so it costs no false-abort margin at all.

    Keying exculpation on the `mcp__` counter rather than on the reply text is
    also what keeps this independent of the response summarizer, which was
    rewritten mid-review: a dispatched genealogy call is proof the CLI
    advertised the tool, and reading it needs no payload parsing.

    `mcp_call_count` is the run's `mcp__`-only counter, incremented in
    `pretool_hook` — so it counts genealogy calls **attempted**, not ones that
    returned successfully. An attempt is still proof of presence (the CLI only
    dispatches a tool it advertised), which is what this gate needs.

    KNOWN COVERAGE LIMIT, and it follows from the gate #941 specified ("while
    the `mcp__` call count is still zero"): once one genealogy call has been
    attempted this arm is dead for the rest of the run. So the backstop covers
    a surface that NEVER worked, not one that died after working — despite
    mid-run death being the case it was added for. Widening it (a windowed
    "no successful genealogy call in the last N tool calls") is a spec change,
    not a tidy-up, so it is not done here — issue #1300.
    """
    if tool != TOOL_SEARCH_NAME:
        return streak
    if mcp_call_count > 0:
        # A genealogy call was dispatched, so the surface demonstrably exists.
        return 0
    if is_no_match_tool_search(tool, response_summary):
        return streak + 1
    return streak


def backstop_fired(streak: int) -> bool:
    """Whether a miss streak has reached the abort threshold."""
    return streak >= CONSECUTIVE_TOOL_SEARCH_MISSES


def unavailable_cause(
    entry: dict[str, Any] | None,
    *,
    backstop: bool = False,
    queries: list[str] | None = None,
    server_stderr: list[str] | None = None,
) -> str:
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

    `server_stderr` (issue #1301) is the bounded list of `Server stderr: `
    lines a caller read from the CLI's own per-server JSONL log — the SDK's
    `stderr` callback never receives the MCP child's output, so this is the
    only route to the server's own diagnostic text. Optional and additive:
    `None`/empty leaves this function's output identical to before #1301.
    """
    if backstop:
        cause = (
            f"{CONSECUTIVE_TOOL_SEARCH_MISSES} consecutive ToolSearch lookups "
            "found no matching tool and not one genealogy tool call has been "
            f"attempted, so the {GENEALOGY_SERVER_NAME!r} MCP server is gone"
        )
        # Name the queries. This arm writes no run log, so the console is the
        # ONLY artifact — without them a false positive (a real streak of
        # searches for tools that genuinely do not exist) is indistinguishable
        # from a dead server, and being undiagnosable, it would repeat.
        if queries:
            shown = ", ".join(repr(q) for q in queries)
            cause += f" (searched: {shown})"
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
    if server_stderr:
        shown = "\n".join(server_stderr)
        cause += f"\nCaptured server stderr:\n{shown}"
    return cause


def unavailable_message(
    entry: dict[str, Any] | None,
    *,
    backstop: bool = False,
    queries: list[str] | None = None,
    server_stderr: list[str] | None = None,
) -> str:
    """What a genealogist reads when a RUN is aborted. Criterion 4 is these words.

    Used by the orchestrator's abort (a `narration` entry + the run's `error`
    field) and printed verbatim by run_e2e. On the abort path only the printed
    copy is ever seen — that run writes no files — so these words are the whole
    artifact. Their job is to stop someone re-researching a case that was never
    actually attempted.

    `server_stderr` (issue #1301): when present, the closing line pointing the
    reader at `make e2e-preflight` for "the server's own error text" is dropped
    — that text is already printed above, in `unavailable_cause`'s own output,
    so repeating the pointer would send the reader to re-run something for
    information they already have in front of them.
    """
    closing = (
        "" if server_stderr
        else "\nTo see the server's own error text, run `make e2e-preflight`."
    )
    return (
        "MCP UNAVAILABLE — "
        f"{unavailable_cause(entry, backstop=backstop, queries=queries, server_stderr=server_stderr)}.\n"
        "The genealogy tools were absent from this session, so no research was "
        "possible and nothing about this run reflects the fixture or the "
        "records.\n"
        "This is an ENVIRONMENT failure: RE-RUN the test. Do NOT re-research "
        "the case, and do not read this as a research result."
        f"{closing}"
    )
