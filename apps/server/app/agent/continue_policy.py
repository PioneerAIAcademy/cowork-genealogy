"""How a hosted turn ends, and what its ending is called.

ONE copy for two planes. The hosted alpha (``real_agent.build_options``) and the
prototype worker (``proto/worker/options.py``) both read the outcomes, the no-project
note and the foreground rewrite from here; the worker already imports from this package
-- ``options.py`` takes ``direct_project_file_write`` and ``worker.py`` takes
``map_message``, both from ``app.agent.real_agent`` -- so a module here serves both
without a second implementation.

Neither plane vetoes a stop. Step mode ends each turn at its boundary on purpose, and
"Keep going" is the host's reply rather than a veto (docs/specs/research-step-mode-spec.md,
section A2 and Phase 2).

Pure stdlib and no I/O beyond ``read_research_json``, so ``test_continue_policy_parity.py``
can lift the predicates into a clean namespace without importing ``claude_agent_sdk``.
"""

from __future__ import annotations

import json
import math
import os
import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

# turns.outcome, and what a reader is told for each (PR #2870 items 1b, 1c, 1e).
#
#   completed        the project reached project.status == "completed"
#   stopped          the patron pressed Stop
#   queued           the turn ended to pick up a message the patron typed mid-turn
#   budget           1e's per-session spend bound is spent
#   no_progress      a redelivered attempt did no work ZERO_PROGRESS_CAP times running
#   decision         the agent asked something only the patron can answer (phase 3)
#   delivered        (legacy) a bounded request met, before research_delivered was deleted
#   mcp_unavailable  the genealogy tool surface went away
#   ok               the session has no research.json; the browser shows nothing
#
# The point of having more than one: ``complete()`` used to hardcode 'ok', so EVERY way a
# run ended looked like success -- including the two ways an unattended run actually ends.
# To a genealogist a half-finished run then reads as "nothing more was found", which is a
# correctness bug in the product rather than a cosmetic one.
TERMINAL_COMPLETED = "completed"
TERMINAL_STOPPED = "stopped"
TERMINAL_QUEUED = "queued"
TERMINAL_BUDGET = "budget"
TERMINAL_NO_PROGRESS = "no_progress"
TERMINAL_DECISION = "decision"
TERMINAL_MCP_UNAVAILABLE = "mcp_unavailable"


# #3768: a first message that arrives before any project exists was answered from a
# lookup and ended, with no project and no research. Both hosted planes append this to
# their project note; Cowork's twin is the plugin's `no_project_route.py` hook. It lived
# in the deleted research_delivered guidance (step mode phase 2) and moved here rather
# than going with it.
NO_PROJECT_NOTE = (
    "While no project exists yet (`project_context` returns `no_project`), a call to any tool but "
    "project_create, project_context and project_list is refused. An activity with no person in it (a page read, a record set's names, "
    "a surname survey) starts a project first: project_create with the researcher's request as "
    "objective and no personId. A request about a named FamilySearch person starts one through the "
    "research skill, which needs the person's FamilySearch ID; with no ID, ask for it and create nothing."
)


# Issue #4011. Before any project existed, the Kenya alpha session listed "Kenya, Civil
# Registration, deaths 1904–1967" as searchable from memory; FamilySearch has no Kenya
# collections. Issue #4125 (via the lead on #4011, 2026-11-02) did the same with a book: the
# 1895 Ayling register, for the wrong war, and footnotes no tool read. So the rule covers any
# named source. The main thread cannot call `collections_search` itself (the plugin hook
# denies it), so the sentence names the agents that hold it. Both hosted planes append it,
# and the plugin's `no_project_route.py` carries the same text to Cowork as
# `SOURCES_NOTE`; `test_the_sources_sentence_is_the_one_the_plugin_hook_adds`
# fails if the two differ. Issue #4676 appended the last two sentences: the alpha offered
# to merge two persons on FamilySearch's Family Tree, which no tool here can write.
SOURCES_GUIDANCE = (
    "Name a source, collection, book or citation only if a tool result in this session "
    "returned it; otherwise say it is unconfirmed. FamilySearch collections come from "
    "a collections search, which the locality-guide and research-plan agents run. This rule is about "
    "what you name, not about which agent a question goes to. "
    "Nothing here can change FamilySearch's Family Tree: tree_edit, tree_correct and the "
    "merge tools change the project's own tree only. When a change belongs on FamilySearch, "
    "such as a merge or a wrong parent link, give the researcher the steps to make it on "
    "FamilySearch.org, and never offer to make it yourself."
)


# The main thread's one routing sentence, with or without a project. The plugin hook
# carries the same text as `no_project_route.ROUTING_NOTE`;
# `test_the_routing_sentence_is_the_one_the_plugin_hook_adds` fails if they differ.
ROUTING_GUIDANCE = (
    "Hand each genealogy request to the skill or plugin agent whose work it is, and relay "
    "what it returns. Researching, investigating or finding a person, a relative or a record, "
    "or carrying the research on, goes to the research skill, with or without a project; any "
    "other request, such as one about a place's history or a person's data problems, goes to "
    "the agent whose description covers it. Do not answer it yourself from your own knowledge "
    "or from the project's state. A question about where the project stands you answer from "
    "project_context."
)


# Set in the SDK env by both hosted planes (`real_agent._sdk_env`, the prototype worker's
# options). The plugin's `no_project_route.py` hook defines the same name and stays silent
# when it is set, so its routing text reaches Cowork only and the hosted planes keep the
# text-only fix ruled for them (issue #3768, 2026-10-27). Hook subprocesses inherit the
# CLI's env. `test_the_hosted_flag_is_the_one_the_plugin_hook_reads` fails if the two differ.
HOSTED_PLANE_ENV = "GENEALOGY_HOSTED_PLANE"


# Delegation tools whose `run_in_background` both planes override to False.
# Lead ruling 2026-09-23, reaffirmed as the design 2026-09-29. Forcing the
# foreground does NOT serialise the work: several Agent calls in one message
# still run concurrently, so a fan-out of four extractors stays a fan-out.
#
# The PROTOTYPE's original reason, kept because it is the measurement behind the
# ruling: the worker ends a turn at the main thread's ResultMessage and closes the
# CLI, so a background agent still running then dies with it -- measured 2026-09-23
# (plan D17: both background extractors lost, the patron told their summaries would
# follow; the two lost on 2026-09-21 were sess_25297de9b15b4ef5, and carried no flag
# at all, which is why every call not explicitly False is rewritten).
#
# Shared because the hosted alpha reproduced, twice, the failure the prototype
# already fixed. The Stop hook (since deleted) could not see that the turn was waiting
# on its own background subagent -- it read `project.status` and its own counters --
# so it nudged ("invoke the `research` skill"), and the model, told to get on with
# it, started a DUPLICATE of the agent still running. Measured on the alpha:
# duplicate `q_001`/`q_002` from two question-selection spawns (feedback issue
# #3156), and four record-extractors relaunched synchronously while the
# background copies kept going -- one orphaned source, one extractor hung 56
# minutes, ~20 minutes of re-extraction (feedback issue #3159).
#
# The Stop veto is gone (step mode phase 2), and the rewrite stays (decision 26): an
# `Agent` call with no `run_in_background` key still runs in the background, so the
# turn ends while its agent runs, and the prototype worker kills the CLI at the turn's
# first result, taking a still-running agent with it.
DELEGATION_TOOLS = frozenset({"Agent", "Task"})



PLUGIN_PREFIX = "plugin:"


def foreground_rewrite(tool_name: str, tool_input: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """An allow-with-rewrite forcing a delegation to the foreground, or None.

    One of the two hook arms that CHANGE a call rather than refusing it (the alpha's
    effort arm is the other). Returns None when the call is not a delegation, or when it
    already carries an explicit `run_in_background: False`. Every other shape is
    rewritten, because the CLI backgrounds an agent when the key is absent ("Agents run
    in the background by default", its own tool text from 2.1.215 through 2.1.308) and
    both measured incidents carried no key at all.

    It also drops a `plugin:` the router copied onto `subagent_type` from
    research/SKILL.md's `@plugin:<name>` notation: no agent is registered under that
    name, and a Haiku 5.5 router wrote it in spite of the skill saying not to
    (ut_research_b4p, cq7). A call carrying one is rewritten even when it is already
    in the foreground.

    It outlives the Stop veto, which never covered this: see `DELEGATION_TOOLS`. Without
    it a turn ends while its delegations still run. The prototype worker then kills the
    CLI (`_run_turn`), so the delegation dies mid-run; on the alpha its report arrives
    after the turn, where `_drain_background` discards it.
    """
    data = dict(tool_input or {})
    if tool_name not in DELEGATION_TOOLS:
        return None
    name = data.get("subagent_type")
    prefixed = isinstance(name, str) and name.startswith(PLUGIN_PREFIX) and len(name) > len(PLUGIN_PREFIX)
    if prefixed:
        data["subagent_type"] = name[len(PLUGIN_PREFIX):]
    elif data.get("run_in_background") is False:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {**data, "run_in_background": False},
        },
    }



def read_research_json(project_dir: Path | str) -> dict[str, Any] | None:
    """``<project_dir>/research.json`` parsed, or None if missing or unusable.

    ``UnicodeDecodeError`` is caught because it is a ``ValueError``, not an ``OSError`` --
    ``read_text`` decodes before ``json`` sees the bytes, so a file with invalid UTF-8
    would otherwise propagate out of every caller. The ``isinstance`` check is
    load-bearing for the same reason: a research.json parsing to a JSON *array* is not
    None, so without it the value passes every ``is None`` test and then raises
    ``AttributeError`` on ``.get(...)``. Both matter because a Stop hook that raises ends
    the turn in error rather than letting it stop.
    """
    path = Path(project_dir) / "research.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return parsed if isinstance(parsed, dict) else None


def project_completed(research: Mapping[str, Any] | None) -> bool:
    """Whether research.json says the project is done."""
    if not research:
        return False
    return (research.get("project") or {}).get("status") == "completed"


# ── The completion halt (issue #3542 lead 1) ──────────────────────────────────────────
#
# Only proof-conclusion may write `project.status` (the plugin hook's OWNED_FIELDS), so a
# project completes INSIDE a main-thread Agent call to it. When that call returns, the
# main thread's next model call only paraphrases the agent's `summary_for_user`; both
# planes end the turn there instead, from PostToolUse, and show the summary itself.
# Measured live: `apps/server/dev/probe_posttool_halt.py`.

PROOF_CONCLUSION_AGENT = "proof-conclusion"

# The closing sentences proof-conclusion's `summary_for_user` ends on exactly when the
# invocation set `project.status` to `completed` (proof-conclusion.md, `### summary_for_user`):
# "for now" when the question's stop record lists unsearched sources. The halt requires one,
# so a proof-conclusion call that did NOT complete the project, running beside the one that
# did, never ends the turn on its own summary. Pinned to the agent body, both ways, by
# `eval/harness/tests/unit/test_completion_halt_parity.py`.
PROOF_CONCLUSION_FINISHED = (
    "This research is finished. If you'd like a second opinion on it, just ask.",
    "This research is finished for now. If you'd like a second opinion on it, just ask.",
)

# The runtime's frame and trailer around a subagent's return as the MODEL sees it. The
# PostToolUse `tool_response` came without them in the probe; they are stripped anyway so
# a string-shaped return parses the same. Ported from `eval/harness/harness/skill_runner.py`
# (`_HAND_BACK_HEADER`, `_AGENT_RETURN_TRAILERS`, `strip_agent_return_frame`), which this
# package cannot import.
_HAND_BACK_HEADER = re.compile(r"^\[Subagent hand-back\][^\n]*\n", re.M)
_AGENT_RETURN_TRAILERS = (
    re.compile(r"(?m)^agentId:\s*\S+.*$"),
    re.compile(r"(?s)<usage>.*?</usage>"),
)


def _agent_return_text(tool_response: Any) -> str:
    """The text of an Agent result: a dict with `content` blocks (what PostToolUse
    carries), a bare list of blocks, or a string."""
    content = tool_response.get("content") if isinstance(tool_response, Mapping) else tool_response
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, Mapping) and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(parts)


def summary_for_user(tool_response: Any) -> str | None:
    """The `summary_for_user` an agent's return ends with: everything after its last line
    reading `---` (proof-conclusion.md, `### summary_for_user`). None when there is no
    such line or nothing follows it, which leaves the turn to end as it does today."""
    text = _agent_return_text(tool_response).replace("\r\n", "\n")
    m = _HAND_BACK_HEADER.search(text)
    if m:
        text = "\n".join(line[2:] if line.startswith("  ") else line for line in text[m.end():].split("\n"))
    for pattern in _AGENT_RETURN_TRAILERS:
        text = pattern.sub("", text)
    lines = text.split("\n")
    rules = [i for i, line in enumerate(lines) if line.strip() == "---"]
    if not rules:
        return None
    return "\n".join(lines[rules[-1] + 1:]).strip() or None


def is_proof_conclusion_call(tool_input: Any) -> bool:
    """Whether an Agent call went to proof-conclusion, by its `subagent_type` compared
    after the last `:`, as the step boundary's `bare_name` compares it: bare and
    `genealogy-research:`-prefixed were both seen in the probe."""
    name = tool_input.get("subagent_type") if isinstance(tool_input, Mapping) else None
    return isinstance(name, str) and name.rsplit(":", 1)[-1] == PROOF_CONCLUSION_AGENT


def status_before_call(research: Mapping[str, Any] | None) -> str:
    """The status a completion check compares against, read just before the call:
    `project.status`, or `"completed"` when there is no research.json to read, so the halt
    never fires on a guess."""
    if not research:
        return "completed"
    status = (research.get("project") or {}).get("status")
    return status if isinstance(status, str) else ""


def wants_status_before(data: Mapping[str, Any]) -> bool:
    """Whether a PreToolUse call is one the completion halt needs the status before: a
    main-thread (no `agent_id` key) delegation to proof-conclusion."""
    name = data.get("tool_name")
    return (
        "agent_id" not in data
        and isinstance(name, str)
        and name in DELEGATION_TOOLS
        and is_proof_conclusion_call(data.get("tool_input"))
    )


def completion_halt_summary(
    data: Mapping[str, Any],
    status_before: Any,
    research_now: Callable[[], Mapping[str, Any] | None],
) -> str | None:
    """The summary to end the turn on, or None to let it run on: the ONE predicate both
    planes' PostToolUse arms call. A main-thread proof-conclusion call that moved the
    project to `completed`, whose return carries a `summary_for_user` ending on one of
    ``PROOF_CONCLUSION_FINISHED``. The transition, not the state, so a follow-up question in
    a project already completed never ends a turn. ``research_now`` is read only once every
    cheaper test has passed."""
    if (
        not wants_status_before(data)
        or status_before == "completed"
        or not project_completed(research_now())
    ):
        return None
    summary = summary_for_user(data.get("tool_response"))
    if summary is None or not summary.endswith(PROOF_CONCLUSION_FINISHED):
        return None
    return summary


# ── The host posts each new search link (issue #4660, lead 2026-11-23) ───────────────
#
# An external-site search is a link the researcher has to open. It reaches the chat only if
# the main thread relays the agent's report, and `project_context`'s `awaitingUser` then
# treats it as handed over whether it was or not (spec project-context-tool-spec.md §2.3).
# In one alpha session 11 links were logged and none reached the chat. So both planes post
# each hand-off a turn opened, from the `research.json` they can read, as its own paragraph
# of the reply. The rows come from `step_boundary.awaiting_hand_offs`, the Python mirror of
# the engine's rule, never a second copy here.


# Only a web link is autolinked: the chat's markdown blanks any other scheme's href
# (react-markdown's urlTransform), and `ancestry.com:443/...` would read as scheme
# `ancestry.com:`. A bare host name, with an optional port, then a path or nothing, gets
# `https://`; text with a dot that is not one (`no results found.`) does not.
_WEB_URL = re.compile(r"https?://", re.I)
_BARE_HOST = re.compile(r"(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::\d+)?(?:[/?#]|$)")


def hand_off_link_text(url: str) -> str:
    """One link's paragraph: plain words, the site's host name, and the URL as a markdown
    autolink, so `_`, `*` or a trailing `)` in a search URL is not read as markup. Never
    raises: a URL that will not parse loses only its host name.

    An autolink holds no ASCII control character, space, `<` or `>`, and an agent-logged
    URL is not always encoded, so those are percent-encoded; the link opens the same page.
    Only an http(s) URL is a link: a logged `www.ancestry.com/...` gets `https://`, and
    anything else (no URL at all, `localhost:8080/x`, `javascript:...`) is shown as code
    rather than as a link that opens nothing."""
    url = url.strip()
    if not _WEB_URL.match(url) and _BARE_HOST.match(url.lstrip("/")):
        url = "https://" + url.lstrip("/")
    web = bool(_WEB_URL.match(url))
    try:
        host = (urlsplit(url).hostname or "").removeprefix("www.") if web else ""
    except ValueError:  # e.g. an unbalanced `[` in the netloc
        host = ""
    where = f" on {host}" if host else ""
    head = f"Search to run{where}: open this link, then send back what you find there."
    if not web:
        return f"{head}\n`{url.replace('`', '')}`"
    href = "".join(quote(c, safe="") if c <= " " or c in "<>\x7f" else c for c in url)
    return f"{head}\n<{href}>"


class HandOffLinks:
    """Which hand-offs one turn has posted. Per turn, never persisted (the ruling rejected
    a stored `shown` flag).

    ``seed`` records the hand-offs already open before the turn's first call that can open
    one (``seed_hand_offs``), which an earlier turn handed out; it reads only the first
    time, so a turn with no such call never reads research.json. ``new_texts`` returns a paragraph for each row opened since,
    once: a parallel second return that re-sees the first's rows posts only its own, and
    the turn-end sweep posts only what no return did. A link sent again is logged under a
    new id and so is posted again. Before ``seed`` it posts nothing; a seed whose read
    failed seeds empty (``seed_hand_offs``)."""

    def __init__(self) -> None:
        self.seen: set[str] | None = None

    @property
    def seeded(self) -> bool:
        return self.seen is not None

    def seed(self, rows: list[Mapping[str, Any]]) -> None:
        if self.seen is None:
            self.seen = {str(r.get("log_id")) for r in rows}

    def new_texts(self, rows: list[Mapping[str, Any]]) -> list[str]:
        if self.seen is None:
            return []
        out: list[str] = []
        for row in rows:
            log_id, url = row.get("log_id"), row.get("url_generated")
            if not isinstance(log_id, str) or not isinstance(url, str) or log_id in self.seen:
                continue
            self.seen.add(log_id)
            out.append(hand_off_link_text(url))
        return out


# The MCP tools that can log a hand-off, by bare name. `research_log_append` is on the
# plugin hook's MAIN_THREAD_OK, so the main thread can log one without delegating;
# `build_external_search_url` is denied to it, and listed so a change there is covered.
HAND_OFF_LOG_TOOLS = frozenset({"research_log_append", "build_external_search_url"})


def opens_hand_offs(tool: Any) -> bool:
    """Whether a main-thread call to ``tool`` can open a hand-off: a delegation, or one of
    ``HAND_OFF_LOG_TOOLS`` under any server prefix (``mcp__genealogy__…``)."""
    if not isinstance(tool, str):
        return False
    return tool in DELEGATION_TOOLS or tool.rsplit("__", 1)[-1] in HAND_OFF_LOG_TOOLS


def wants_hand_off_seed(links: HandOffLinks, data: Mapping[str, Any]) -> bool:
    """Whether a ``PreToolUse`` input would seed the turn: the turn is unseeded and this is a
    main-thread (no ``agent_id`` key) call that can open a hand-off. Lets a plane share one
    read between the seed and another reading before the same call."""
    return not links.seeded and "agent_id" not in data and opens_hand_offs(data.get("tool_name"))


def seed_hand_offs(
    links: HandOffLinks,
    data: Mapping[str, Any],
    read_rows: Callable[[], list[Mapping[str, Any]] | None],
) -> None:
    """Seed the turn from a ``PreToolUse`` input, once: the ONE seed both planes run. Only a
    main-thread (no ``agent_id`` key) call that can open a hand-off (``opens_hand_offs``)
    seeds. It runs in the hook, before the tool does, and not at the message stream's
    ``tool_use``, because by the time the host reads that the CLI may already have run the
    call, and a fast ``research_log_append`` would then be seeded as seen and never posted.

    ``read_rows`` returning None (unreadable) seeds the turn EMPTY, so every open hand-off
    a later read finds is posted, even one an earlier turn handed out. Left unseeded, the
    next qualifying call would seed instead, after this call's agent may have logged its
    links, and they would never be posted (/code-review round 3). A link shown twice can be
    ignored; a link never shown cannot be run."""
    if not wants_hand_off_seed(links, data):
        return
    rows = read_rows()
    links.seed(rows if rows is not None else [])


def hand_off_texts(
    links: HandOffLinks,
    message: Any,
    event: Mapping[str, Any],
    read_rows: Callable[[], list[Mapping[str, Any]] | None],
) -> list[str]:
    """The link paragraphs one ``map_message`` event calls for: the ONE trigger both planes
    run. The ``tool_result`` of a main-thread (no ``parent_tool_use_id``) call that can open
    a hand-off (``opens_hand_offs``) posts what it opened, once the turn was seeded
    (``seed_hand_offs``, from the plane's ``PreToolUse``). ``read_rows`` is the plane's read
    of ``step_boundary.awaiting_hand_offs``; None means it could not read, and then nothing
    is posted."""
    tool = event.get("tool")
    if not opens_hand_offs(tool) or getattr(message, "parent_tool_use_id", None):
        return []
    if event.get("kind") == "tool_result" and links.seeded:
        rows = read_rows()
        return links.new_texts(rows) if rows is not None else []
    return []


def env_int(name: str, default: int, *, env=None, on_error=None, floor: int = 0) -> int:
    """An int from the environment that cannot crash-loop the process that reads it.

    Every reader of these is at module scope or at container start, so a bare ``int()``
    on ``"  "`` or ``"forty"`` raises before anything binds and the orchestrator restarts
    it forever -- a typo in one environment variable taking the service down with no
    working state to read the error from. This shipped three times as three separate
    hand-written guards; the third instance is what says it belongs in one place.

    ``env=None`` rather than ``env=os.environ``: a default evaluated at DEFINITION time
    is evaluated by anything that lifts this module's functions into a clean namespace,
    which the AST parity test does -- and ``os`` is not there, so the default turns that
    test into a collection error.
    """
    raw = ((os.environ if env is None else env).get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        if on_error is not None:
            on_error(name, raw, default)
        return default
    return max(floor, value)


def env_float(name: str, default: float, *, env=None, on_error=None) -> float:
    """``env_int`` for a float. Same reason, same shape; a negative or non-finite value
    takes the default because every current reader is a price, an interval or a cap, and
    none of those has a meaning below zero or at ``nan``/``inf``. Those parse, so they
    reach ``on_error`` like a typo does (U23: ``-1`` meaning "cap off" was a silent $35)."""
    raw = ((os.environ if env is None else env).get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        value = math.nan
    if not (math.isfinite(value) and value >= 0):
        if on_error is not None:
            on_error(name, raw, default)
        return default
    return value
