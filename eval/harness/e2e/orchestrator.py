"""E2e orchestrator: load fixture → spawn agent → judge → persist.

Skeleton implementation per docs/specs/e2e-test-spec.md. The harness
is single-fixture-focused for now; the CLI wraps it for one-test or
all-tests invocation.

Real MCP server (the built TypeScript MCP server at
packages/engine/mcp-server/build/index.js) is spawned via stdio so the agent's tool
calls go to live FamilySearch. Auth comes from the host's pre-existing
~/.familysearch-mcp/tokens.json (the user must have logged in before
running tests).
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    HookMatcher,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from harness.auth import env_for_sdk, resolve_auth
from harness.context_policy import (
    bare_tool_name as _bare_tool_name,  # re-exported: callers + tests import it from here
    is_subagent_call,
    subagent_only_denial,
)
from harness.judge import _summarize_response
from harness.skill_invocation import (
    find_citation_nulling_in_conclusions,
    find_effects_without_invocation,
    find_missing_mentor_verdicts,
    find_person_evidence_missing_same_person,
    find_protected_writes_by_unnamed_delegate,
    find_unguarded_protected_writes,
    PERSON_EVIDENCE_DENY_KIND,
    same_person_scored_ids,
    unguarded_new_person_evidence_links,
)

from e2e import provenance
from e2e.mcp_health import (
    CONSECUTIVE_TOOL_SEARCH_MISSES,
    backstop_fired,
    classify_server_status,
    find_server_entry,
    genealogy_mcp_config,
    is_no_match_tool_search,
    should_abort_at_init,
    tool_search_miss_streak,
    unavailable_message,
)
from e2e.result import E2eResult, timestamp_slug, write_result_files
from e2e.stop_checker import (
    derive_stop_reason,
    read_research_json,
    read_tree_json,
    should_continue_run,
)
from e2e.subagent_capture import collect_subagents
from e2e import judge as judge_module


class McpUnavailableError(RuntimeError):
    """The genealogy MCP surface was absent, so this run never happened.

    Issue #941. Raised by `run_e2e_test` *after* the agent stops and *before*
    the judge or any file write, which is what implements the lead's retention
    decision: an `mcp_unavailable` run writes no run-log files at all, makes no
    judge call, and exits non-zero. Rationale and the rejected alternatives are
    in docs/specs/e2e-test-spec.md beside the `stop_reason` table.

    Carries the operator-facing text (e2e.mcp_health.unavailable_message) as
    its message, so `run_e2e.py` can print it verbatim.
    """


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MCP_SERVER_ENTRY = REPO_ROOT / "packages" / "engine" / "mcp-server" / "build" / "index.js"
DEFAULT_RUNLOG_ROOT = REPO_ROOT / "eval" / "runlogs" / "e2e"
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"
DEFAULT_PLUGIN_SKILLS = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
DEFAULT_PLUGIN_AGENTS = REPO_ROOT / "packages" / "engine" / "plugin" / "agents"


# Tools always allowed alongside MCP tools. See e2e-test-spec.md §6.
# "Task" lets the /research orchestrator delegate to the gps-mentor
# subagent (staged into .claude/agents/ by build_workspace). Without it,
# the main agent cannot spawn the mentor and improvises a verdict that
# never appends to research.json's evaluations[] — see
# docs/specs/gps-mentor-agent-spec.md §8 and the gps-mentor staging note
# in build_workspace below.
BASELINE_ALLOWED_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Skill",
    "Task",
]


# Tools that hand the agent the stripped answer off the LIVE FamilySearch
# tree instead of making it research. The fixture strips the answer from
# the *local* tree.gedcomx.json, but FamilySearch still has it.
#
# The principle: block anything keyed off the SUBJECT PERSON that surfaces
# the answer; allow tools keyed off a record the agent had to find first,
# and tools that read the local stripped tree.
#
#   person_read / person_search / person_ancestors
#       read the subject's facts/relationships/parents straight off the
#       live tree — the most direct leak.
#   person_record_matches(subjectPID)
#       returns the records FamilySearch has matched to the subject —
#       which INCLUDE the answer records, curated and keyed off the PID,
#       with no searching. Same leak, one step indirect.
#   person_person_matches(subjectPID)
#       surfaces tree persons matched to the subject — can leak a stripped
#       relative in a parents/siblings fixture.
#
# NOT blocked (legitimate research): record_search / record_read /
# fulltext_search / image_* / collections_search (the agent must find
# records itself); record_person_matches / record_record_matches (keyed
# off a RECORD the agent already found, not the subject); source_attachments
# (confirms a found record's attachment — real GPS work); person_warnings
# (reads the local stripped tree, not the live one).
#
# See e2e-test-spec.md §6.1. Matched on the bare tool name (after the
# `mcp__<server>__` prefix).
BLOCKED_TREE_TOOLS = frozenset(
    {
        "person_read",
        "person_search",
        "person_ancestors",
        "person_record_matches",
        "person_person_matches",
    }
)


# docs/specs/guardrail-enforcement-spec.md §7/§10 — trailing tool-call
# window for the shadow-mode guardrail check: a first-cut default, not yet
# empirically tuned against the runlog corpus. Generous on purpose — a
# guardrail skill legitimately does several reads/searches/writes before its
# protected write, so this needs to be wide enough to cover that without
# being so wide it stops meaning anything.
GUARDRAIL_SHADOW_WINDOW = 40


def is_turn_cap_error(detail: str | None) -> bool:
    """Whether an SDK error result is really a turn-cap hit.

    The SDK reports a max-turns stop as an *error result* ("Reached
    maximum number of turns (N)") rather than a clean stop_reason, so the
    orchestrator reclassifies it to `max_turns` — a known stop condition,
    not an unexpected error.
    """
    return "maximum number of turns" in str(detail or "").lower()


def is_blocked_tree_tool(tool_name: str) -> bool:
    """Whether a tool call should be denied as a live-tree answer-read.

    Only MCP genealogy tools are candidates; baseline tools (Read, Skill,
    …) are never blocked. Matched on the bare advertised name.
    """
    if not tool_name.startswith("mcp__"):
        return False
    return _bare_tool_name(tool_name) in BLOCKED_TREE_TOOLS


def is_main_thread_extraction_append(input_data: dict[str, Any]) -> bool:
    """Whether this is `extraction_append` on the main thread — the #942 bug.

    `extraction_append` is the record-extractor subagent's private writer: it is
    declared by NO skill's `allowed-tools` and lives only on
    `agents/record-extractor.md`. So the only legitimate caller is the
    Task-spawned subagent, whose PreToolUse firing carries `agent_id`; a call on
    the main thread (no `agent_id`) is the router substituting for a failed
    spawn and doing the extraction itself.

    The policy binds in e2e for this tool because `agent_id` presence alone is a
    sufficient discriminator — which is all e2e can see, since its sub-skills run
    in the same session via the `Skill` tool with no `agent_id` to attribute them
    (see `harness.context_policy` docstring). We deny the bare tool directly
    rather than routing through `subagent_only_violation`, which guards the whole
    set and takes a `declared_tools` argument e2e cannot supply; keeping the check
    tool-specific also means a future skill that legitimately declares a guarded
    tool is not denied here.

    `image_read`, the set's other member, satisfies the same condition today — no
    skill has declared it since `search-images` moved to `@plugin:image-reader`
    (2026-07-17), and it lives only on `agents/image-reader-opus.md` — so it is
    equally enforceable here and simply is not yet: that is outside #942's blast
    radius, tracked as issue #1273.
    """
    # `or ""` rather than a get() default: a present-but-None `tool_name` would
    # raise AttributeError here, and a raising hook fails a call the agent was
    # entitled to make (CLAUDE.md, "Plugin hooks"). Fail closed to "not blocked".
    if not (input_data.get("tool_name") or "").startswith("mcp__"):
        return False
    return (
        _bare_tool_name(input_data["tool_name"]) == "extraction_append"
        and not is_subagent_call(input_data)
    )


def is_fixture_blocked_tool(tool_name: str, blocked_tools: frozenset) -> bool:
    """Whether a tool call is denied by THIS fixture's `blocked_tools`.

    Same matching rules as the universal tree block: MCP tools only,
    matched on the bare advertised name. Used for fixtures whose ground
    truth a specific tool can surface directly (e.g. `wiki_search` on a
    fixture built from a wiki case-study article that names the answer).
    """
    if not tool_name.startswith("mcp__"):
        return False
    return _bare_tool_name(tool_name) in blocked_tools


# The two project files that must never be touched by raw Write/Edit — all
# writes go through the MCP writer tools (research_append, research_log_append,
# tree_edit, tree_correct), which validate before persisting. See
# docs/specs/guardrail-enforcement-spec.md §6.
PROTECTED_PROJECT_FILES = ("research.json", "tree.gedcomx.json")


def direct_project_file_write(tool_name: str, tool_input: dict) -> str | None:
    """The protected filename a raw file-write call targets, or None.

    Only the file-write tools are candidates — every other tool (including the
    MCP writer tools) is a different code path. Matched on the `file_path`
    argument's basename, so it doesn't matter whether the model passed an
    absolute or relative path.

    Both path separators are handled. Splitting on "/" alone made this a no-op
    on Windows, where the workspace is a `C:\\Users\\...\\Temp\\e2e-<id>` path
    and the model composes `C:\\...\\research.json` — the basename never
    matched, so the guard silently did nothing on the platform the genealogist
    team runs. Kept in sync with `real_agent.direct_project_file_write`
    (issue #940), which cannot import from here.
    """
    if tool_name not in ("Write", "Edit", "NotebookEdit"):
        return None
    file_path = str((tool_input or {}).get("file_path") or "")
    name = file_path.replace("\\", "/").rsplit("/", 1)[-1]
    return name if name in PROTECTED_PROJECT_FILES else None


# Cap on how many person ids the issue-#963 shadow entry names inline. A single
# batch research_append can append person_evidence for many new persons; without
# a cap the recorded detail string could balloon to an unreadable length. Show
# the first N, then "+M more".
_MAX_SHADOW_IDS = 10


def load_seed_person_ids(starting_tree_path: Path) -> set[str] | None:
    """Seed-tree person ids for the issue-#963 same_person check, read from the
    IMMUTABLE fixture file.

    `starting_tree_path` is `FixtureCaps`/`Fixture.starting_tree_path`, which
    `load_fixture` sets to `<fixture_dir>/starting-tree.gedcomx.json` — the
    committed fixture input, NOT the per-run workspace copy `build_workspace`
    makes at `<workspace>/tree.gedcomx.json` and the run then mutates. Reading
    the fixture path (not the workspace) is what guarantees these ids are the
    run's *starting* state, so "new this run" is computed against a baseline the
    run can't have changed.

    Returns the id set, or **None on any read/parse failure** so the check FAILS
    OPEN (the caller skips it). An empty set would instead mis-classify every
    legitimate seed-person link as "new + unscored" and log a shadow entry for
    each one on nothing worse than a fixture/IO hiccup, inflating exactly the
    number this is here to measure. Failing open loses only the in-run signal;
    the post-run hard-fail (find_person_evidence_missing_same_person, which does
    its own seed read) still backstops any real bypass.

    Non-string `persons[].id` values are dropped rather than admitted as None:
    the ids this set is compared against are always strings, so a None member
    could never match, and admitting it would make the `set[str]` annotation a
    lie for no benefit.

    The failure is printed to stderr rather than swallowed or sent to a logger:
    the harness has no module logger, and every other operator-facing signal
    here (`_emit`, the blocked-tool notices) is a direct stderr print for the
    same reason — it always shows in the run's captured output on the
    genealogist team's Windows consoles. Kept diagnosable, not silent.
    """
    try:
        seed = json.loads(starting_tree_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(
            f"  [warn] could not read seed tree {starting_tree_path} "
            f"({type(e).__name__}: {e}) — issue #963 same_person check DISABLED "
            "for this run; the post-run guardrail check still applies.",
            file=sys.stderr,
            flush=True,
        )
        return None
    persons = seed.get("persons") if isinstance(seed.get("persons"), list) else []
    return {p["id"] for p in persons if isinstance(p, dict) and isinstance(p.get("id"), str)}


def person_evidence_provenance_gap(
    tool_name: str,
    tool_input: dict[str, Any] | None,
    *,
    tool_calls: list[dict[str, Any]],
    starting_person_ids: set[str],
) -> str | None:
    """The issue-#963 provenance gap for a pending `research_append` that links
    a brand-new, unscored tree person via `person_evidence`, or None if clean.

    SHADOW MODE — the caller records this and lets the write through; it does
    not deny. Graduating to a real deny is issue #1231, gated on the shadow
    numbers this produces.

    Pure decision logic, extracted from `pretool_hook` so the clean, fail-open,
    and gap paths are unit-testable without spinning up the SDK.

    Scoring is read from `tool_calls` alone. There is deliberately no
    `pending_tool_uses` argument: `pretool_hook` runs from a spawned control-
    request task while `tool_calls` is appended by the message loop, so a
    `same_person` issued in the SAME turn as the write may not be visible yet
    (the SDK buffers up to 100 messages before the loop drains them). Passing
    `pending_tool_uses` did not fix that — the AssistantMessage branch appends
    one entry object to `tool_calls` AND stores it in `pending_tool_uses`, so
    the latter is always a subset of the former and unioning them adds nothing.
    Under shadow mode a same-turn miss costs one over-counted log line; closing
    it properly means accumulating scored ids inside the hook itself, which is
    #1231's job when this graduates.

    Ordering note — this is a STRICTER question than the post-run detector
    `find_person_evidence_missing_same_person` asks. That one is whole-run: a
    `same_person` anywhere, INCLUDING after the link, satisfies it. This one
    only sees calls already made, so link-then-score is a gap here and a pass
    there. Rare but real (one occurrence in the committed corpus:
    ferber-marriage 2026-07-21, person I5 linked at call #45 and scored at
    #68), and it is a genuine divergence, not an equivalence — read the shadow
    count with that in mind.
    """
    scored = same_person_scored_ids(tool_calls)
    unguarded = unguarded_new_person_evidence_links(
        tool_name, tool_input, scored_ids=scored, starting_ids=starting_person_ids
    )
    if not unguarded:
        return None
    return person_evidence_gap_reason(unguarded)


def person_evidence_gap_reason(unguarded: list[str]) -> str:
    """The operator/agent-facing text for a provenance gap, given the ids.

    Split from `person_evidence_provenance_gap` so a caller that already holds
    the flagged ids — `pretool_hook`, which needs them for the deny valve's
    per-id-set key — can format the reason without a second
    `same_person_scored_ids` + `unguarded_new_person_evidence_links` pass over
    the whole `tool_calls` list on every flagged write.
    """
    shown = ", ".join(unguarded[:_MAX_SHADOW_IDS])
    if len(unguarded) > _MAX_SHADOW_IDS:
        shown += f", +{len(unguarded) - _MAX_SHADOW_IDS} more"
    example = unguarded[0]
    return (
        f"person_evidence link written for new tree person(s) {shown} with no "
        "prior same_person call: a brand-new identity should be scored before it "
        "is asserted (research/SKILL.md doctrine; issue #963). "
        # Issue #1231 prereq 2. The text above alone is unactionable — replayed
        # over the corpus it would have denied 100 of 103 runs that link a new
        # person, and the agent believes it DID call same_person. The cause is an
        # id mismatch, so the reason has to name the one shape that satisfies the
        # gate. See docs/specs/guardrail-enforcement-spec.md §4's last row.
        f"These are LOCAL tree ids minted by tree_edit (which rejects "
        f"caller-supplied ids), not FamilySearch ids, so score them by passing "
        f"the TREE side as `gedcomx2` — a subset simplified-GedcomX holding the "
        f"person plus their matching mob — with `primaryId2: \"{example}\"`, and "
        "the record side as `gedcomx1`/`primaryId1` (person-evidence/SKILL.md, "
        "'Score the match with same_person'). "
        # A PreToolUse deny is all-or-nothing on the call, and the batches this
        # fires on have a median of 17 ops (max 152), 11% of which carry ops in
        # OTHER sections. Without this sentence the agent cannot tell what it lost.
        "If this call was denied, the entire batch was rejected — including any "
        "ops in other sections — and must be re-issued after the same_person "
        "call. "
        # The one real escape: scoring needs a record persona to compare
        # against, and a non-record_search assertion has no record_persona_id.
        #
        # There is deliberately NO escape for "the id is a locally-minted stub".
        # person-evidence/SKILL.md says such an id returns a degenerate score to
        # be treated as "no score available", but that guidance (2026-07-02)
        # predates the match-engine mint-hardening (2026-07-07) and is stale.
        # Probed live against the API (dev/probe-same-person-local-id.ts): with
        # the tree focus person's ARK removed the score is 0.9999484 against a
        # 0.999967 control — and identical across two runs despite randomFsId()
        # minting a fresh id each call. FS scores document CONTENT, so a minted
        # person IS scorable, and telling the agent otherwise would hand it a
        # documented way to skip a call that works.
        "If no score is obtainable — the assertion is not record_search-sourced, "
        "so it has no record_persona_id to compare against — say so in the "
        "link's `rationale` and proceed. A locally-minted tree id is NOT such a "
        "case: it scores on document content and must be scored."
    )


# The loop valve (issue #1231 prereq 3). Two limits, because one does not bound
# the loop:
#   * per id set — a wedged identity stops costing wall clock after N tries;
#   * per run — the per-key counter alone is unbounded, since a batch differing
#     by one op, or a freshly minted I2/I3, mints a NEW key and buys another full
#     per-key budget.
# Past either, the write is RELEASED rather than denied again. That matters
# mechanically: the deny returns above `tool_call_count["n"] += 1`, so a denied
# call charges no budget, and `activity_count` increments unconditionally so the
# no-progress watchdog reads a deny loop as progress. Releasing is the only path
# that reaches the tool_calls cap. Spec §10 also prefers a merely-wrong run over
# a stuck one.
PERSON_EVIDENCE_DENY_REPEAT_LIMIT = 3
PERSON_EVIDENCE_DENY_TOTAL_LIMIT = 10

# The two run modes for the §8 provenance check. `shadow` (the default
# everywhere) records and lets the write through; `deny` additionally returns a
# PreToolUse deny, and is opt-in per run via --person-evidence-guard.
PERSON_EVIDENCE_GUARD_SHADOW = "shadow"
PERSON_EVIDENCE_GUARD_DENY = "deny"
PERSON_EVIDENCE_GUARD_MODES = (PERSON_EVIDENCE_GUARD_SHADOW, PERSON_EVIDENCE_GUARD_DENY)


def person_evidence_deny_decision(
    reason: str,
    flagged_ids: set[str] | frozenset[str],
    *,
    mode: str,
    repeat_counts: dict[frozenset[str], int],
    denied_total: dict[str, int],
    per_key_limit: int = PERSON_EVIDENCE_DENY_REPEAT_LIMIT,
    total_limit: int = PERSON_EVIDENCE_DENY_TOTAL_LIMIT,
) -> tuple[str, dict[str, Any] | None]:
    """Whether a provenance gap should be denied, and the PreToolUse payload.

    Returns `(outcome, payload)` where outcome is one of `shadow` (mode is not
    `deny` — nothing denied, no counter moved), `denied` (payload is the deny),
    or `released` (the valve opened: a limit was reached, so the write goes
    through even though the gap is real).

    A `None` payload means the hook falls through to its normal path, which
    already increments `tool_call_count` — so the release path charges budget for
    free, and that is deliberate: it is the only route to the tool_calls cap.

    Pure decision logic living beside `person_evidence_provenance_gap` for the
    same reason that one was extracted — `pretool_hook` spawns the SDK and the
    real MCP server, so a closure-local implementation would be reachable only
    from a paid e2e run (`tests/unit/test_e2e_orchestrator.py`'s own docstring
    says so). The two counter arguments are mutated in place, matching the
    hook's existing `{"n": 0}` counter idiom.

    An unrecognized `mode` is treated as `shadow` rather than raising: a hook
    that raises fails a tool call the agent was entitled to make (CLAUDE.md,
    "Plugin hooks"), so the failure direction here is always fail-open.
    """
    if mode != PERSON_EVIDENCE_GUARD_DENY:
        return PERSON_EVIDENCE_GUARD_SHADOW, None

    key = frozenset(flagged_ids)
    if repeat_counts.get(key, 0) >= per_key_limit or denied_total["n"] >= total_limit:
        return "released", None

    repeat_counts[key] = repeat_counts.get(key, 0) + 1
    denied_total["n"] += 1
    return "denied", {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


@dataclass
class FixtureCaps:
    # The DEFAULT caps every fixture inherits for any cap it doesn't set.
    # These are the single source of truth — load_fixture fills omitted
    # caps from here (don't re-hardcode the numbers there). Tuned so a real
    # full-GPS run fits: an early fixture hit the 100-turn cap mid-loop
    # (111 tool calls / 101 turns, still not done) — see e2e-test-spec.md §6.
    wall_clock_seconds: int = 7200  # 120 min — the formal GPS apparatus
    # (research-exhaustiveness + gps-mentor gates + proof-conclusion) pushes a
    # real full-GPS run well past 60 min; kenneth/elizabeth/teitje all hit the
    # old 3600 cap mid-proof-conclusion (morris already overrode to 4800).
    inactivity_seconds: int = 600   # 10 min with NO SDK message at all (silence)
    # Abort (or, with resume_on_stall, resume) when the agent makes no PROGRESS
    # — no assistant text and no tool call/result — for this long, even while the
    # SDK keeps emitting non-progress messages (so the inactivity timer never
    # fires). The observed stalls were exactly this: the stream stayed alive but
    # the model made no progress for ~40 min until the wall-clock cap. Conservative
    # default; tune down once the per-turn `timeline` shows the normal max gap.
    progress_stall_seconds: int = 600
    tool_calls: int = 300
    max_turns: int = 250
    max_cost_usd: float = 15.0
    # Voluntary-yield nudges allowed before an autonomous run is permitted to
    # end. The agent sometimes narrates the next step then stops mid-loop; a
    # Stop hook vetoes that, bounded by this cap. See should_continue_run().
    # Generous by design: a full GPS proof yields after each of ~10+ sub-skill
    # steps, so a stingy cap ends the loop before proof-conclusion. The
    # no-progress check (see should_continue_run) is the real backstop against
    # a genuinely idle agent; this cap only bounds the worst case.
    max_continue_nudges: int = 20


@dataclass
class Fixture:
    """In-memory representation of one fixture directory."""
    id: str
    dir: Path
    researcher_question: str
    tags: dict[str, str]
    agent_model: str
    judge_model: str
    caps: FixtureCaps
    expected_findings: dict[str, Any]
    starting_research_path: Path
    starting_tree_path: Path
    # Extra tools denied for THIS fixture's runs, beyond the universal
    # BLOCKED_TREE_TOOLS — bare advertised names (e.g. "wiki_search").
    # For fixtures whose ground truth derives from a source an MCP tool
    # can surface directly (a wiki case-study article naming the answer).
    # See e2e-test-spec.md §6.1 "Per-fixture blocked tools".
    blocked_tools: frozenset = frozenset()
    # The fixture's subject person id(s), from starting-research.json's
    # project.subject_person_ids (plus a real source_pid). Passed to the
    # avoid-guard so a same-name subject isn't mis-flagged as the avoided
    # namesake in a look-alike fixture.
    subject_person_ids: frozenset = frozenset()


def load_fixture(fixture_dir: Path) -> Fixture:
    """Read fixture.json + expected-findings.json from a fixture directory."""
    fixture_dir = Path(fixture_dir)
    fixture_json = json.loads((fixture_dir / "fixture.json").read_text(encoding="utf-8"))
    expected = json.loads((fixture_dir / "expected-findings.json").read_text(encoding="utf-8"))

    # Subject person id(s) for the avoid-guard's subject exemption. Primary
    # source is starting-research.json's project.subject_person_ids; source_pid
    # is added when it's a real PID (not the "PID-TODO" marker).
    subject_ids: set[str] = set()
    try:
        starting_research = json.loads(
            (fixture_dir / "starting-research.json").read_text(encoding="utf-8")
        )
        for sid in (starting_research.get("project") or {}).get("subject_person_ids") or []:
            subject_ids.add(str(sid))
    except (OSError, json.JSONDecodeError):
        pass
    src = fixture_json.get("source_pid")
    if src and "TODO" not in str(src):
        subject_ids.add(str(src))

    # Fill omitted caps from FixtureCaps() — the single source of default
    # values (don't re-hardcode the numbers here, or they drift).
    caps_raw = fixture_json.get("caps") or {}
    defaults = FixtureCaps()
    caps = FixtureCaps(
        wall_clock_seconds=caps_raw.get("wall_clock_seconds", defaults.wall_clock_seconds),
        inactivity_seconds=caps_raw.get("inactivity_seconds", defaults.inactivity_seconds),
        progress_stall_seconds=caps_raw.get(
            "progress_stall_seconds", defaults.progress_stall_seconds
        ),
        tool_calls=caps_raw.get("tool_calls", defaults.tool_calls),
        max_turns=caps_raw.get("max_turns", defaults.max_turns),
        max_cost_usd=caps_raw.get("max_cost_usd", defaults.max_cost_usd),
        max_continue_nudges=caps_raw.get(
            "max_continue_nudges", defaults.max_continue_nudges
        ),
    )
    model = fixture_json.get("model") or {}
    return Fixture(
        id=fixture_json["id"],
        dir=fixture_dir,
        researcher_question=fixture_json["researcher_question"],
        tags=fixture_json.get("tags") or {},
        agent_model=model.get("agent", "claude-sonnet-4-6"),
        judge_model=model.get("judge", judge_module.DEFAULT_JUDGE_MODEL),
        caps=caps,
        expected_findings=expected,
        starting_research_path=fixture_dir / "starting-research.json",
        starting_tree_path=fixture_dir / "starting-tree.gedcomx.json",
        blocked_tools=frozenset(fixture_json.get("blocked_tools") or ()),
        subject_person_ids=frozenset(subject_ids),
    )


# A fixture may bundle external-evidence captures (PDFs the real /research
# flow expects a USER to upload from sites with no API — Ancestry, Find A
# Grave, …). A headless run has no human, so the harness pre-provides them:
# the docs live in `provided-documents/` and are copied into the workspace
# root, exactly where search-external-sites expects an uploaded capture
# (it reads them by `capture_filename`). See spec §6.2.
PROVIDED_DOCS_DIRNAME = "provided-documents"


def provided_documents(fixture: Fixture) -> list[Path]:
    """The fixture's bundled external-evidence captures (may be empty)."""
    d = fixture.dir / PROVIDED_DOCS_DIRNAME
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.is_file() and not p.name.startswith("."))


def _override_agent_model(md_text: str, model: str) -> str:
    """Rewrite a staged subagent's ``model:`` frontmatter to ``model``.

    Overrides the agent's own pin (e.g. record-extractor's ``claude-sonnet-5``)
    so an e2e run can be executed against a different model — e.g. to test
    whether the sonnet-5 record-extractor freeze reproduces under sonnet-4-6,
    the model Cowork uses. Inserts a ``model:`` line if the agent has none.
    """
    if re.search(r"(?m)^model:[ \t]*.*$", md_text):
        return re.sub(r"(?m)^model:[ \t]*.*$", f"model: {model}", md_text, count=1)
    if md_text.startswith("---\n"):
        return f"---\nmodel: {model}\n" + md_text[len("---\n"):]
    return md_text  # no frontmatter to pin into


def build_workspace(
    fixture: Fixture,
    target: Path,
    skills_dir: Path,
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
    effort_level: str | None = None,
    agent_model: str | None = None,
) -> Path:
    """Populate a temp dir with fixture starting state + plugin skills + agents.

    Plugin subagents (`packages/engine/plugin/agents/*.md`) are staged into
    `.claude/agents/` as project subagents so the /research orchestrator's
    `@plugin:gps-mentor` delegation can resolve to the real agent. Without
    this the agent file is absent from the workspace, the orchestrator falls
    back to an improvised generic subagent, and the mentor's verdict never
    appends to research.json's `evaluations[]` (see
    docs/specs/gps-mentor-agent-spec.md §8). This mirrors how the shipped
    plugin zip carries `agents/` (scripts/package-plugin.sh); the harness
    simply flattens it into the project scope the SDK loads via
    setting_sources=["project"].
    """
    target = Path(target)
    shutil.copy(fixture.starting_research_path, target / "research.json")
    shutil.copy(fixture.starting_tree_path, target / "tree.gedcomx.json")

    skills_target = target / ".claude" / "skills"
    skills_target.mkdir(parents=True, exist_ok=True)
    for skill in Path(skills_dir).iterdir():
        if skill.is_dir() and not skill.name.startswith("."):
            shutil.copytree(skill, skills_target / skill.name, dirs_exist_ok=True)

    # Stage plugin subagents as project subagents (.claude/agents/<name>.md).
    agents_dir = Path(agents_dir)
    if agents_dir.is_dir():
        agents_target = target / ".claude" / "agents"
        agents_target.mkdir(parents=True, exist_ok=True)
        for agent_file in sorted(agents_dir.glob("*.md")):
            dest = agents_target / agent_file.name
            if agent_model is None:
                shutil.copy(agent_file, dest)
            else:
                # Override every staged subagent's model pin (see agent_model).
                dest.write_text(
                    _override_agent_model(agent_file.read_text(encoding="utf-8"), agent_model),
                    encoding="utf-8",
                )

    # Optionally pin the run's reasoning effort via a PROJECT-level setting.
    # setting_sources=["project"] reads this file; the CLAUDE_EFFORT env var does
    # NOT (it's output-only — verified). This is the only working effort lever
    # from the harness. Session-wide (parent + every subagent). Left unset, the
    # run uses the CLI's bare default, which for sonnet-5 resolves to 'high' —
    # deep enough that the record-extractor subagent can spend its whole output
    # budget on one thinking turn (stop_reason=max_tokens, no tool call) and
    # freeze the run; lower it here to A/B whether that clears (read the runlog's
    # `subagents[].runaway_thinking`). Valid: low | medium | high | xhigh | max.
    if effort_level is not None:
        claude_dir = target / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)
        (claude_dir / "settings.json").write_text(
            json.dumps({"effortLevel": effort_level}, indent=2) + "\n", encoding="utf-8"
        )

    # Drop bundled captures into the workspace root, where an uploaded PDF
    # would land — the agent reads them by filename like a user upload.
    for doc in provided_documents(fixture):
        shutil.copy(doc, target / doc.name)
    return target


def _render_user_message(fixture: Fixture) -> str:
    """The literal user message sent to the agent. See spec §5.

    If the fixture bundles external-evidence captures, name them so the
    agent reads them instead of pausing to ask the user to upload (which
    can't happen in a headless run).
    """
    base = f"/research --autonomous {fixture.researcher_question}"
    docs = provided_documents(fixture)
    if not docs:
        return base
    names = ", ".join(d.name for d in docs)
    return (
        f"{base}\n\n"
        f"(Pre-provided external captures are in the working directory: {names}. "
        "When research calls for a document from an external site that's among "
        "these, read the local file instead of asking me to upload it.)"
    )


def _unwrap_mcp_text_blocks(content: Any) -> Any:
    """Parse the JSON document an MCP tool result carries inside a text block.

    MCP results arrive as `[{"type": "text", "text": "<a whole JSON document>"}]`,
    so to any generic summarizer the entire response is one very long *string*.
    Bounding strings then keeps the head and hides every key, which is the
    mechanism behind the `record_search` blindness described below. Parsing the
    inner document first is what lets the summarizer work on real structure.

    Anything that does not parse is passed through untouched — a plain-text tool
    result stays a plain-text tool result.

    Only an object or array is unwrapped. A bare JSON scalar is left as the string
    it arrived as, because `json.loads` would otherwise coerce a tool result of
    `"1"` to `1`, `"true"` to `True`, `"null"` to `None` and `"NaN"` to a float
    nan — changing what the run log says the tool returned, which is the one thing
    this artifact exists to record faithfully.
    """
    if not isinstance(content, list):
        return content
    out: list[Any] = []
    for block in content:
        text = (
            block.get("text")
            if isinstance(block, dict)
            else getattr(block, "text", None)
        )
        if isinstance(text, str) and text.lstrip()[:1] in ("{", "["):
            try:
                out.append(json.loads(text))
                continue
            except (ValueError, RecursionError):
                # RecursionError is not a ValueError: a deeply nested payload
                # would otherwise escape to the run-level handler and abort a
                # run that costs $7-25. The old code could not raise at all
                # because it never parsed, so this must not either.
                pass
        out.append(block)
    return out


# The old head-truncation's threshold. A response at or under this was captured
# whole before, so it is passed through whole now — the guarantee that this
# function can only ever widen the artifact, never narrow it.
_RUNLOG_VERBATIM_MAX = 500
# Must not sit below the 497 content chars the old head-truncation kept, or this
# function REGRESSES the artifact it exists to widen: a string-valued result
# (`Read`, `Glob`, `Grep`, and a `record_search` that came back as the MCP
# over-limit error) is one long string with no keys to preserve, so the string
# bound is the whole budget for it.
#
# What this constant is and is NOT responsible for, since a first draft of this
# comment credited it with the whole regression: at 200, 112 of the 284 tool
# results in `run-2026-07-31_13-02-13` captured less than the old head cut, but
# only **12** of those are string-valued (9 of them losing exactly 237 chars).
# The other 100 are list-valued, losing 52.8 chars on average to
# `_summarize_response`'s list sampling, which no string bound can fix — that is
# what the verbatim passthrough below is for. Raising 200 -> 500 fixes 23 of the
# 112 and introduces 2 new ones (the bound is not monotone: for a string of
# length just over 200, truncating at 200 plus the ~61-char marker is LONGER than
# leaving it whole at 500), for a net of 21. The passthrough fixes the rest.
#
# Still far under the judge tier's 2000, because that copy is a throwaway prompt
# and this one is committed to git.
_RUNLOG_STRING_MAX = 500
# Backstop for the widest tail: 11 of the 1544 tool results across the six
# committed jimmie-jewel-neal runs (0.7%) reach it. Kept at 4000 rather than
# raised, because at that hit rate a bigger cap grows a git-committed artifact for
# the long tail alone. Must stay ABOVE _RUNLOG_VERBATIM_MAX or the never-shorter
# floor at the end of _summarize_tool_response silently defeats it. Note what
# happens for those 11: the output degrades to a head cut *of a summary*, which
# reintroduces the un-reasonable-about bound this function otherwise rejects —
# acceptable at 0.7%, but that is the trade, not an absence of one.
_RUNLOG_MAX_CHARS = 4000


def _summarize_tool_response(content: Any) -> str:
    """Key-preserving summary of a tool result for the run log.

    This head-truncated at 497 chars before `HARNESS_SCHEMA_VERSION` 2, which
    made exactly the
    fields worth diffing invisible. `record_search` leads with `results`, its
    largest field by far, so every field serialized after it was cut: across the
    46 `record_search` calls in `run-2026-07-31_13-02-13`, `ranked` appears in
    the run log **0 times**, even though 18 of those calls supplied `subjectId`
    and 14 of them were ranked. The run log is the artifact we assert tool
    behavior from, and it was silently dropping the evidence — a head bound
    cannot be reasoned about, because whether a field survives depends on how
    much data happened to precede it.

    So summarize by KEY instead, reusing the unit tier's `_summarize_response`
    rather than growing a second summarizer: dicts keep every key, long lists
    keep their length plus a sample, long strings are bounded with an explicit
    marker. An overall cap stays as a backstop, since run logs are committed.

    Responses that already fit are passed through VERBATIM rather than summarized.
    That is not an optimization, it is what makes this strictly non-regressive:
    `_summarize_response` samples any list past three entries, so summarizing
    unconditionally *lost* content for 91 of the 284 tool results in
    `run-2026-07-31_13-02-13` — short responses made of many small items, which
    the old bound captured whole. Summarize only what the old code would have cut.

    KNOWN CONSEQUENCE of that passthrough: `response_summary` now has two shapes.
    Under the threshold it keeps the raw MCP envelope, where the tool's document is
    an escaped string (`[{"type": "text", "text": "{\\"totalMatches\\": 0}"}]`);
    over it, the document is unwrapped and its keys are real JSON keys. Two things
    follow. A call whose payload crosses the threshold between runs flips
    representation and shows a spurious diff, which matters because
    `docs/specs/e2e-test-spec.md` tells readers to diff `response_summary` across
    runs. And grepping a quoted key (`'"rankingSkipped"'`) undercounts, because the
    escaped form does not contain it — grep the bare name, which matches both.
    """
    try:
        raw = content if isinstance(content, str) else json.dumps(content)
    except (TypeError, ValueError):
        raw = repr(content)
    except RecursionError:
        # NOT `repr(content)`: repr recurses too, so on the only input class that
        # can raise here the fallback raises identically and the guard is a no-op.
        # (Measured: a 20,000-deep nested list raises in json.dumps AND in repr.)
        # Letting it escape aborts a run costing $7-25, so degrade to a marker
        # instead. Unreachable today — `ToolResultBlock.content` is a str or a
        # shallow list of dicts — but this function had no `json.dumps` of caller
        # data at all before, so the exposure is new.
        raw = f"<unserializable {type(content).__name__}: nesting too deep>"
    if len(raw) <= _RUNLOG_VERBATIM_MAX:
        return raw

    summary = _summarize_response(
        _unwrap_mcp_text_blocks(content), string_max=_RUNLOG_STRING_MAX
    )
    try:
        text = summary if isinstance(summary, str) else json.dumps(summary)
    except (TypeError, ValueError):
        text = repr(summary)
    if len(text) > _RUNLOG_MAX_CHARS:
        text = text[: _RUNLOG_MAX_CHARS - 3] + "..."

    # Never emit a SHORTER capture than the old head-truncation would have. A
    # key-preserving summary can come out shorter on a long list of small items —
    # 14 of the 284 tool results in `run-2026-07-31_13-02-13` — and in those cases
    # it is arguably the better record, since `_full_length: 26` beats an arbitrary
    # 497-char prefix that never says how many entries there were. But "arguably
    # better" is a judgement a reader takes on trust, whereas "never shorter" is a
    # property they can check, and its absence is exactly what made the first cut
    # of this change a regression.
    #
    # It is a LENGTH floor, not a content guarantee: a payload can clear it on one
    # wide key while a sampled list drops entries the head cut happened to include.
    # Zero of the 1544 tool results across the six committed runs do that, but do
    # not restate this as "captures everything it used to".
    #
    # `_RUNLOG_MAX_CHARS` must stay above `_RUNLOG_VERBATIM_MAX`, or this floor
    # silently defeats the cap applied just above it.
    head = raw[: _RUNLOG_VERBATIM_MAX - 3] + "..."  # raw > _RUNLOG_VERBATIM_MAX here
    return text if len(text) >= len(head) else head


def apply_tool_result(entry: dict[str, Any], block: ToolResultBlock, summary: str) -> None:
    """Populate the producer-side fields on a `tool_calls` entry when its
    `ToolResultBlock` arrives: the response summary, and `is_error`.

    Split out of `_consume` so the producer half is unit-testable — the
    guardrail gates in `skill_invocation.py` skip an entry when
    `entry.get("is_error") is True`, and until this set the field nothing did,
    so every gate treated a failed Skill call as a success (#999). The existing
    gate tests fabricate `is_error` themselves, so they can't catch that; this
    helper can. `is True` normalizes the SDK's None-on-success (`is_error` is
    `bool | None`, `None` when the call succeeded) into a clean bool the gates
    and the acceptance test can rely on.
    """
    entry["response_summary"] = summary
    entry["is_error"] = block.is_error is True


def _timeline_tool_label(tool: str, args: dict | None) -> str:
    """Human-legible label for a `timeline` entry's tool-names list.

    `tool_calls` already has the bare name (and, for Skill, the skill it
    launched, in `args["skill"]`) — but no timestamp. `timeline` has the
    timestamp — but until this label existed, no tool identity, so a
    per-skill wall-clock breakdown (e2e.latency_report --by-skill) could
    only be reconstructed from the raw SDK session transcript, which is
    gitignored and normally discarded once the run's tempdir is cleaned up
    (not a reliable source for other contributors' PRs). Labeling the
    timeline directly means every committed run carries it for free.

    A Skill call is labeled with the skill it launches (e.g.
    "Skill:person-evidence") rather than the bare "Skill" — that is the
    actual phase-boundary signal callers need; the bare tool name alone
    would require a second join against `tool_calls` to recover it.
    """
    if tool == "Skill":
        return f"Skill:{(args or {}).get('skill', '?')}"
    return _bare_tool_name(tool)


_USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def _accumulate_usage(acc: dict[str, dict[str, int]], message: Any) -> None:
    """Record one AssistantMessage's usage, keyed by its message id.

    Do NOT sum on arrival. The SDK re-emits the same assistant message once
    per content block, and every copy carries the SAME cumulative usage for
    that message — so adding each time multiplies the totals (verified by
    replaying a real run: naive summing reported 358,610 output tokens
    against a true 106,661, and 226 messages against 87 distinct ones).
    Keying by message id and letting the last write win reproduces the
    ResultMessage token totals exactly.

    Best-effort by design: the SDK types `usage` loosely (a dict on the
    observed path, an object on some versions) and a malformed or absent
    block must never take down a run.
    """
    msg_id = getattr(message, "message_id", None)
    # No id to dedupe on — count it once under a synthetic key rather than
    # dropping it or letting it collide with another anonymous message.
    key = msg_id if msg_id else f"__anon_{len(acc)}"
    usage = getattr(message, "usage", None)

    def _get(field: str) -> int:
        if usage is None:
            return 0
        raw = usage.get(field) if isinstance(usage, dict) else getattr(usage, field, 0)
        return raw if isinstance(raw, int) else 0

    acc[key] = {field: _get(field) for field in _USAGE_FIELDS}


def _fallback_usage(acc: dict[str, dict[str, int]], elapsed_ms: int) -> dict[str, Any]:
    """Usage block reconstructed from the stream when no ResultMessage came.

    Two fields are deliberately left null rather than synthesized:

    `total_cost_usd` — a run spans several models (the parent plus each
    subagent on its own `.md` pin), so one price lookup would be wrong, and a
    plausible-but-wrong dollar figure is worse than a null here: it would be
    silently compared against real costs from clean runs. Token counts are
    exact, so cost stays derivable later from a per-model breakdown.

    `num_turns` — the SDK counts turns differently from distinct assistant
    messages (118 vs 87 on the replayed run), and `latency_report` divides
    output tokens by it. Publishing the smaller number under the same name
    would inflate tokens-per-turn by ~1.4x in exactly the metric the latency
    work depends on. The exact count we DO have is reported separately as
    `assistant_messages`.

    `duration_api_ms` is absent for the same reason: only the SDK knows the
    API/local split, and a monotonic clock can't recover it.
    """
    return {
        "duration_ms": elapsed_ms,
        "duration_api_ms": None,
        "num_turns": None,
        "assistant_messages": len(acc),
        "is_error": True,
        "stop_reason": None,
        "total_cost_usd": None,
        "usage": {
            field: sum(m[field] for m in acc.values()) for field in _USAGE_FIELDS
        },
    }


async def _run_agent(
    *,
    fixture: Fixture,
    workspace: Path,
    mcp_server_entry: Path,
    resume_on_stall: bool = False,
    max_output_tokens: int | None = None,
    agent_model: str | None = None,
    person_evidence_guard: str = PERSON_EVIDENCE_GUARD_SHADOW,
) -> tuple[
    list[dict[str, Any]],  # tool_calls
    list[dict[str, Any]],  # narration
    dict[str, Any],  # usage
    str | None,  # aborted_reason
    str | None,  # error
    list[dict[str, Any]],  # blocked_tree_reads
    list[dict[str, Any]],  # blocked_context_calls
    list[dict[str, Any]],  # guardrail_shadow_violations
    list[str],  # unnamed_delegate_violations
]:
    """Spawn the agent SDK and consume messages until done or capped.

    Returns (tool_calls, narration, usage, aborted_reason, error,
    blocked_tree_reads, blocked_context_calls, guardrail_shadow_violations,
    unnamed_delegate_violations).
    """
    tool_calls: list[dict[str, Any]] = []
    # The agent's prose between tool calls, plus the two harness-side events
    # that only make sense in trace order (a denied tool, a continue-nudge).
    # Each entry carries `tool_calls_before` — how many tool calls had already
    # happened. A value of N means the entry sits between tool_calls[N-1] and
    # tool_calls[N]; 0 means before any tool call. That is a COUNT, not an
    # index: naming it as an index would be off by one, and a negative index
    # would silently wrap in Python. This is what makes the stream
    # reconstructible against tool_calls without being interleaved *into* it — that would break the
    # specced {tool, args, response_summary} entry shape and, worse, shift the
    # index windows find_unguarded_protected_writes() and recently_succeeded()
    # compute (skill_invocation.py), silently changing the §7 shadow-window
    # violation rate between old and new runs.
    narration: list[dict[str, Any]] = []
    pending_tool_uses: dict[str, dict[str, Any]] = {}
    # Seed-tree person ids for the issue-#963 same_person-provenance check (in
    # pretool_hook), read once from the IMMUTABLE fixture file. None on a read
    # failure => the check fails open for this run. See load_seed_person_ids for
    # the full rationale (immutable-path guarantee, fail-open, stderr warning).
    starting_person_ids: set[str] | None = load_seed_person_ids(fixture.starting_tree_path)
    # issue #963, SHADOW MODE — hook-sourced provenance gaps (a person_evidence
    # link written before any same_person scored that identity). Folded into
    # `guardrail_shadow_violations` at the end of the run so the whole shadow
    # signal lands in one already-plumbed field; entries carry `required_skill`
    # to match that list's shape. Nothing reads this into a verdict.
    provenance_shadow: list[dict[str, Any]] = []
    # Loop-valve state for `person_evidence_guard == "deny"` (issue #1231
    # prereq 3). Both are inert under the default shadow mode. Per-id-set counts
    # bound a single wedged identity; the run-global count bounds the loop the
    # per-key counter cannot, since a batch differing by one op mints a new key.
    pe_deny_repeat_counts: dict[frozenset[str], int] = {}
    pe_denied_total = {"n": 0}

    # docs/specs/guardrail-enforcement-spec.md §11, "Step 0" — every
    # tool_use_id's (agent_id, agent_type) as PreToolUse saw it, joined onto
    # the matching tool_calls entry when its ToolResultBlock arrives below.
    # (None, None) for a main-thread call — the SDK omits agent_id entirely
    # from a main-thread PreToolUse payload, and .get() returns None either
    # way, so "key absent" and "key present as None" read identically
    # downstream. This is what makes every guardrail-bypass check in
    # skill_invocation.py caller-aware instead of guessing from Skill/Agent
    # adjacency in the flat list.
    caller_by_tool_use_id: dict[str, tuple[str | None, str | None]] = {}
    usage: dict[str, Any] = {}
    aborted_reason: str | None = None
    error: str | None = None
    # mcp__-only, for the tool_calls budget cap. Distinct from activity_count
    # below, which powers the no-progress stop check.
    tool_call_count = {"n": 0}
    # Any-tool counter (Skill, Read, mcp__, …) for the no-progress check. A
    # read-only sub-skill step (e.g. research-exhaustiveness deciding "not yet
    # exhaustive" and writing nothing) is real progress, not a stuck agent —
    # gating no-progress on mcp__-only calls false-killed runs mid-loop.
    activity_count = {"n": 0}
    # Every denied attempt to read the answer off the live tree. A
    # non-empty list means the agent tried to shortcut research — surfaced
    # in the result so a reviewer can audit the run. See spec §6.1.
    blocked_tree_reads: list[dict[str, Any]] = []
    # Every denied main-thread `extraction_append` — the router doing the
    # record-extractor's job because the subagent failed to spawn (#942). The
    # attempt itself is in `tool_calls` (streamed from the ToolUseBlock before
    # the PreToolUse deny); this list is the record that it did not run.
    blocked_context_calls: list[dict[str, Any]] = []
    # Continue-nudge state: when the agent voluntarily yields before
    # project.status == "completed" (the known "narrated next step then
    # stopped" stall), the Stop hook vetoes the yield and tells it to resume —
    # bounded by max_continue_nudges + a no-progress check (see
    # should_continue_run) so a genuinely stuck run still ends and fails.
    continue_nudges = {"n": 0}
    last_nudge_activity_count = {"n": -1}
    # #941 — the genealogy MCP surface's health. `unavailable` latches True on
    # the first detector hit and is read by the Stop hook (so an in-flight
    # nudge can't push the agent back into an empty tool set) and by the abort
    # path. `misses` is the consecutive no-match ToolSearch streak feeding the
    # mid-run backstop; see e2e.mcp_health for how it is calibrated.
    # `queries` keeps only the last CONSECUTIVE_TOOL_SEARCH_MISSES *no-match*
    # ToolSearch queries — the ones that actually built the streak — so a
    # backstop abort can name what was searched: that path writes no run log, so
    # the console is the only place a false positive could ever be spotted.
    mcp_state: dict[str, Any] = {"unavailable": False, "misses": 0, "queries": []}

    run_started = time.monotonic()

    # Per-message timeline for forensics: [elapsed_seconds, kind, tool_names].
    # Lets a later analysis split a run into structural vs stall time, pinpoint
    # a no-progress gap, AND segment a run by Skill-phase boundaries — all
    # WITHOUT a session.jsonl (which isn't reliably copied, and is gitignored
    # even when it is — see _timeline_tool_label). tool_names is the list of
    # `_timeline_tool_label`-formatted names for any ToolUseBlock/ToolResultBlock
    # in this message ([] for assistant messages with no tool call, and always
    # [] for system:*/result kinds).
    timeline: list[list[Any]] = []
    # Stall detection tracks time since the last PROGRESS message (assistant
    # text, a tool call, or a tool result) — not since any message, because the
    # SDK keeps emitting non-progress messages during a hang, so a plain
    # inactivity timer misses it (the observed stall ran to the wall-clock cap).
    last_progress = {"t": run_started}
    # session_id from the SDK init message — required to resume a stalled run.
    session_id: dict[str, str | None] = {"id": None}
    # Claude Code CLI version from the init message. Logged so a harness-vs-Cowork
    # discrepancy can be checked against a version delta (the local CLI the SDK
    # spawns may differ from Cowork's bundled one).
    cli_version: dict[str, str | None] = {"v": None}
    resumes = {"n": 0}  # how many times we resumed after a stall (capped)
    MAX_RESUME = 2

    # Streamed usage accumulator. The SDK's ResultMessage carries the
    # authoritative duration/turns/cost, but it only arrives on a CLEAN end —
    # a wall-clock timeout, an inactivity abort or a no-progress stall cuts the
    # stream before it, so `usage` stayed {} and the run landed in the runlog
    # with no turns, no duration and no tokens at all. That silently blinded
    # every `timeout` run (9 of 9 in the corpus as of 2026-07-20) — exactly the
    # runs whose cost and turn count you most want to see. Accumulating per
    # AssistantMessage gives a fallback that is always available. See
    # _fallback_usage below for what is and isn't recoverable this way.
    streamed: dict[str, dict[str, int]] = {}

    def _emit(line: str) -> None:
        """Live progress to stderr so a long, otherwise-silent run shows
        roughly where it is. ASCII only (the genealogist team runs on Windows
        cp1252 consoles); stdout stays clean for the CLI's own output."""
        elapsed = int(time.monotonic() - run_started)
        print(
            f"  [{elapsed // 60}m{elapsed % 60:02d}s] {line}",
            file=sys.stderr,
            flush=True,
        )

    async def pretool_hook(input_data, _tool_use_id, _ctx):
        tool_name = input_data.get("tool_name", "")
        # spec §11 Step 0 — record caller identity for EVERY call, including ones
        # about to be denied below (an unnamed subagent attempting a raw
        # Write bypass is exactly the kind of call worth attributing), so
        # this must run before any early return in this function, not just
        # before the mcp__ filter further down.
        caller_by_tool_use_id[_tool_use_id] = (
            input_data.get("agent_id"),
            input_data.get("agent_type"),
        )
        # Count EVERY tool the agent issues (Skill, Read, mcp__, …) toward the
        # no-progress signal — invoking a sub-skill is progress even when that
        # skill writes nothing. The mcp__-only budget cap is tool_call_count,
        # incremented separately below.
        activity_count["n"] += 1

        # docs/specs/guardrail-enforcement-spec.md §6 — no skill's
        # allowed-tools lists bare Write/Edit, and research/SKILL.md already
        # prose-forbids direct writes to these two files ("all writes go
        # through the writer tools"). This closes that as a real denial
        # instead of a convention. Hygiene, not the fix for the observed
        # bypass — both known bypass shapes write via research_append, never
        # raw Write/Edit (see §4.1/§4.2 for the actual gates).
        protected_file = direct_project_file_write(tool_name, input_data.get("tool_input", {}))
        if protected_file:
            _emit(f"[blocked direct write] {tool_name} -> {protected_file}")
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{tool_name} on {protected_file} is disabled — all writes to "
                        "research.json/tree.gedcomx.json must go through the writer tools "
                        "(research_append, research_log_append, tree_edit, tree_correct), "
                        "which validate before persisting. Direct file writes never validate."
                    ),
                },
            }

        if not tool_name.startswith("mcp__"):
            return {}

        # NOTE: the per-context tool policy (harness/context_policy.py) is only
        # PARTIALLY enforced here — see that module's docstring.
        #   - `extraction_append` IS enforced (below). No skill declares it, so
        #     its only legitimate caller is the Task-spawned record-extractor,
        #     which carries `agent_id`; a main-thread call is the #942 router
        #     substitution. `agent_id` presence alone discriminates, which is all
        #     e2e can see — sub-skills run in this same session via the Skill
        #     tool with no `agent_id` to attribute them, so the full per-skill
        #     check (`subagent_only_violation`) has no `declared_tools` to take.
        #   - `image_read`, the set's other member, is NOT enforced here yet. It
        #     meets the same condition today (no skill declares it; it lives only
        #     on agents/image-reader-opus.md) — issue #1273.
        if is_main_thread_extraction_append(input_data):
            bare = _bare_tool_name(tool_name)
            blocked_context_calls.append(
                {
                    "tool": bare,
                    "args": dict(input_data.get("tool_input") or {}),
                    "blocked_by": "context",
                }
            )
            narration.append(
                {
                    "tool_calls_before": len(tool_calls),
                    "kind": "blocked",
                    "text": (
                        f"`{bare}` denied on the main thread — writing extracted "
                        "assertions is the record-extractor subagent's job. If it "
                        "failed to spawn, report the failure and stop (#942)."
                    ),
                }
            )
            _emit(f"[blocked context call] {bare} (main-thread extraction_append)")
            return subagent_only_denial(bare)

        # Block tree-reading tools BEFORE counting toward the cap — a denied
        # call never runs, so it shouldn't consume the budget. The run
        # continues (no stopReason); the agent must find a records path.
        bare = _bare_tool_name(tool_name)
        if is_blocked_tree_tool(tool_name):
            blocked_tree_reads.append(
                {
                    "tool": bare,
                    "args": dict(input_data.get("tool_input") or {}),
                    "blocked_by": "tree",
                }
            )
            narration.append(
                {
                    "tool_calls_before": len(tool_calls),
                    "kind": "blocked",
                    "text": (
                        f"`{bare}` denied — tree-reading tools are disabled in "
                        "e2e runs; recover the answer from records."
                    ),
                }
            )
            _emit(f"[blocked tree-read] {bare}")
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{bare} is disabled in e2e benchmark runs. Reading the "
                        "tree would hand you the stripped answer for free. "
                        "Recover it through records instead (record_search, "
                        "record_read, fulltext_search, image_search, …)."
                    ),
                },
            }
        if is_fixture_blocked_tool(tool_name, fixture.blocked_tools):
            blocked_tree_reads.append(
                {
                    "tool": bare,
                    "args": dict(input_data.get("tool_input") or {}),
                    "blocked_by": "fixture",
                }
            )
            narration.append(
                {
                    "tool_calls_before": len(tool_calls),
                    "kind": "blocked",
                    "text": (
                        f"`{bare}` denied — disabled by this fixture "
                        "(fixture.json `blocked_tools`)."
                    ),
                }
            )
            _emit(f"[blocked fixture tool] {bare}")
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{bare} is disabled for this benchmark fixture: its "
                        "ground truth derives from a source this tool can "
                        "surface directly. Recover the answer through record "
                        "research instead (record_search, record_read, "
                        "fulltext_search, image_search, …)."
                    ),
                },
            }

        # docs/specs/guardrail-enforcement-spec.md §8, issue #963 — a
        # person_evidence link for a BRAND-NEW tree person should be preceded
        # by a same_person call scoring that identity, the doctrine
        # find_person_evidence_missing_same_person already hard-fails on
        # post-run. This is the LIVE, pre-write form of that question, and it
        # runs in SHADOW MODE: it records and lets the write through.
        #
        # Why shadow and not a deny, despite same_person being a required call
        # rather than a windowed heuristic: replaying this check over the
        # committed e2e corpus, 65 of 81 fixtures fire at least one hit (265
        # across 280 runs). Scoring a locally-minted person is simply not
        # current agent behavior, so a deny here would not be a rare guardrail
        # — it would intervene in four fifths of a suite costing $7-25 a run,
        # with no e2e evidence for how the agent recovers. Graduating it is
        # issue #1231, gated on the numbers this produces. Unlike the two
        # post-hoc shadow detectors below, this one must live in the hook: the
        # thing being measured is what a PreToolUse gate would have done, and
        # only a live hook sees the write before it lands.
        #
        # Skipped entirely when starting_person_ids is None (seed read failed —
        # fail open; see load_seed_person_ids). The bare == "research_append"
        # gate just avoids a needless tool_calls scan on every other call —
        # person_evidence_provenance_gap also returns None for any non-
        # research_append tool, so it's safe either way. Decision logic lives in
        # that helper so it's unit-testable without the SDK.
        if bare == "research_append" and starting_person_ids is not None:
            # Scanned ONCE. The flagged ids are needed twice — for the reason
            # text and for the deny valve's per-id-set key — so they are computed
            # here rather than via person_evidence_provenance_gap, which would
            # re-walk the whole tool_calls list to rebuild the same list.
            unguarded_ids = unguarded_new_person_evidence_links(
                tool_name,
                input_data.get("tool_input") or {},
                scored_ids=same_person_scored_ids(tool_calls),
                starting_ids=starting_person_ids,
            )
            provenance_gap = person_evidence_gap_reason(unguarded_ids) if unguarded_ids else None
            if provenance_gap:
                # Shaped to match find_unguarded_protected_writes' entries so
                # both can share `guardrail_shadow_violations` without a reader
                # having to branch on which source an entry came from.
                # `detail` is the discriminator: only this source sets it.
                entry: dict[str, Any] = {
                    "index": len(tool_calls),
                    "tool": bare,
                    "required_skill": "person-evidence",
                    "question_id": None,
                    "detail": provenance_gap,
                }
                # issue #1231 prereq 3 — opt-in per run, `shadow` everywhere by
                # default, so this is a no-op unless --person-evidence-guard deny
                # was passed. The gap is recorded either way: what changes is
                # whether the write is also blocked.
                outcome, deny = person_evidence_deny_decision(
                    provenance_gap,
                    unguarded_ids,
                    mode=person_evidence_guard,
                    repeat_counts=pe_deny_repeat_counts,
                    denied_total=pe_denied_total,
                )
                if outcome != PERSON_EVIDENCE_GUARD_SHADOW:
                    # Tag deny-mode entries so `guardrail_shadow_report`'s
                    # scan_provenance can exclude them: it selects on key shape,
                    # never on the run's mode, and the valve can record several
                    # denials plus a release for ONE logical gap. Untagged, they
                    # would inflate the very corpus the graduation reads.
                    entry["kind"] = PERSON_EVIDENCE_DENY_KIND
                    entry["valve_released"] = outcome == "released"
                provenance_shadow.append(entry)
                _emit(f"[guardrail-{outcome}] person_evidence w/o prior same_person")
                if deny is not None:
                    narration.append(
                        {
                            "tool_calls_before": len(tool_calls),
                            "kind": "blocked",
                            "text": (
                                "`research_append` denied — a person_evidence link "
                                "for a brand-new tree person must be scored by "
                                "`same_person` first (#1231). The whole batch was "
                                "rejected; re-issue it after scoring."
                            ),
                        }
                    )
                    # Returns BEFORE tool_call_count below, so a denied call
                    # charges no budget — which is exactly why the valve above
                    # must eventually release: releasing falls through to that
                    # increment, and the tool_calls cap is the only bound a
                    # wedged agent can actually reach.
                    return deny

        tool_call_count["n"] += 1
        if tool_call_count["n"] > fixture.caps.tool_calls:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"tool_calls cap ({fixture.caps.tool_calls}) exceeded"
                    ),
                },
                "continue_": False,
                "stopReason": "max_tool_calls",
            }
        return {}

    async def stop_hook(_input_data, _tool_use_id, _ctx):
        # The agent is ending its turn. In an autonomous e2e run the only
        # valid end is project.status == "completed"; an earlier yield is the
        # known stall. Veto it (decision=block) and tell the agent to resume,
        # bounded by should_continue_run() so a stuck run still ends + fails.
        research = read_research_json(workspace)
        if not should_continue_run(
            research=research,
            nudges_used=continue_nudges["n"],
            max_nudges=fixture.caps.max_continue_nudges,
            tool_count=activity_count["n"],
            tool_count_at_last_nudge=last_nudge_activity_count["n"],
            mcp_unavailable=mcp_state["unavailable"],
        ):
            return {}
        continue_nudges["n"] += 1
        last_nudge_activity_count["n"] = activity_count["n"]
        narration.append(
            {
                "tool_calls_before": len(tool_calls),
                "kind": "harness",
                "text": (
                    f"continue-nudge {continue_nudges['n']}/"
                    f"{fixture.caps.max_continue_nudges}: agent yielded before "
                    "project.status=='completed'; instructing it to resume the loop."
                ),
            }
        )
        _emit(
            f"[continue-nudge {continue_nudges['n']}/"
            f"{fixture.caps.max_continue_nudges}] agent yielded; resuming"
        )
        return {
            "decision": "block",
            "reason": (
                "You are mid-run in an autonomous /research session and the "
                "project is not yet complete (project.status is not "
                "'completed'). Do not stop to report progress or announce the "
                "next step. Re-read research.json and invoke the next GPS "
                "sub-skill now; keep going until project.status is "
                "'completed' or you hit a genuine, logged blocker."
            ),
        }

    options = ClaudeAgentOptions(
        cwd=str(workspace),
        setting_sources=["project"],
        # One definition, shared with preflight's connection check (#941) — a
        # preflight that proves a *different* config than the run uses is the
        # bug class that issue was filed about.
        mcp_servers=genealogy_mcp_config(mcp_server_entry),
        # ...and `strict_mcp_config` is what makes that sharing mean anything:
        # without it the CLI merges file/user-scoped MCP config over the block
        # above, so preflight (which sets it) and the run (which did not) could
        # resolve the same `genealogy` key to different servers — reopening the
        # gap from the other side.
        #
        # Measured, not assumed: a run's own init message listed the operator's
        # claude.ai connectors (`needs-auth`) even though `build_workspace`
        # stages no `.mcp.json` and `cwd` is a fresh tempdir — user scope leaks
        # in. Nothing usable is lost by dropping them: `allowed_tools` below is
        # `BASELINE_ALLOWED_TOOLS + ["mcp__genealogy"]`, so a foreign MCP tool
        # was never callable in an e2e run; this only stops one from being
        # advertised, and removes a way to shadow the server under test.
        strict_mcp_config=True,
        # Allow all genealogy MCP tools + baseline filesystem/Skill tools.
        # Wildcard form on the mcp__<server>__ prefix. NOTE: the tree-reading
        # tools (BLOCKED_TREE_TOOLS) are advertised here but denied at call
        # time by pretool_hook — the integrity block (§6.1) is enforced in the
        # hook, not the allowlist, so it can deny per-call with arguments.
        allowed_tools=BASELINE_ALLOWED_TOOLS + ["mcp__genealogy"],
        permission_mode="dontAsk",
        # ENABLE_TOOL_SEARCH turns tool search ON, not off. This comment used to
        # say "forcing tool search off" while setting "true"; the polarity is
        # inverted (issue #1110). Read off the installed CLI (v2.1.220): a truthy
        # value (`true|1|yes|on`) selects deferred/tool-search mode, `auto`/
        # `auto:N` is the adaptive variant, and only a FALSY value
        # (`false|0|no|off`) selects "standard" mode, where every schema is
        # loaded up front. Unset also lands on tool-search mode, so deleting the
        # variable eager-loads nothing. (Additionally forced off on a
        # non-first-party ANTHROPIC_BASE_URL, on Vertex, and under
        # CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS.)
        #
        # So "true" below means e2e runs WITH tool search: the ~38-tool
        # genealogy server's schemas are deferred and re-discovered via
        # ToolSearch mid-session (the 17x in the spriggs run, ~11% of all tool
        # calls across recent runs). Idea 3a of the speedup plan wanted the
        # opposite; flipping to "false" is a separate, tracked decision that
        # requires re-measuring the tool mix, so the value is left as it has been
        # running. `env` MERGES onto the inherited environment (claude_agent_sdk
        # subprocess_cli merges os.environ, then options.env), so this adds the
        # var without dropping PATH.
        #
        # env_for_sdk(resolve_auth()) routes the agent run to the operator's
        # subscription when one is available (suppressing the ANTHROPIC_API_KEY
        # that run_e2e.load_env_file pushed into os.environ for the judge), and
        # falls back to injecting the key when there's no subscription. The
        # judge keeps using the key from os.environ — only the agent subprocess
        # env is overridden here.
        # CLAUDE_CODE_MAX_OUTPUT_TOKENS caps the model's output budget. Unlike
        # CLAUDE_EFFORT (output-only, verified inert as input), this env var IS
        # read as input by the CLI. Left unset the run uses the CLI default (for
        # sonnet-5, 32000). Set it to bound a runaway-thinking subagent that
        # fills the output budget with thinking (see subagent_capture); recorded
        # in the runlog. Applies session-wide (parent + every subagent).
        env={
            "ENABLE_TOOL_SEARCH": "true",
            **({"CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(max_output_tokens)} if max_output_tokens else {}),
            **env_for_sdk(resolve_auth()),
        },
        # Parent model: the --agent-model override (also applied to staged
        # subagents in build_workspace) or the fixture's default.
        model=agent_model or fixture.agent_model,
        max_turns=fixture.caps.max_turns,
        # The SDK's stdio transport defaults to a 1 MiB max_buffer_size for a
        # single JSON message (claude_agent_sdk _DEFAULT_MAX_BUFFER_SIZE). A
        # live image_read response (base64, ~1.33x the raw bytes) plus its
        # JSON-RPC/MCP envelope can exceed that even when the tool's own
        # 700KB inline-image guard (packages/engine/mcp-server/src/tools/
        # image-read.ts MAX_INLINE_IMAGE_BYTES) has already passed the image
        # through — observed killing this exact e2e run on a real FamilySearch
        # death-certificate image (2026-07-08). Raised generously here since
        # this is eval-harness-only config; it does not change production
        # Cowork behavior or the tool's own inline-image ceiling.
        max_buffer_size=10 * 1024 * 1024,
        hooks={
            "PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook])],
            "Stop": [HookMatcher(matcher=None, hooks=[stop_hook])],
        },
    )

    user_message = _render_user_message(fixture)

    def _should_resume() -> bool:
        # Resume only in a provably-safe state: the flag is on, we have a session
        # id, no tool call is in flight (so we can't double-apply a write whose
        # result hadn't returned), and we're under the retry cap. When unsure,
        # DON'T resume — fall back to a clean abort. (Residual: a write that
        # committed in the MCP server before its tool_result arrived would still
        # look "not pending"; this gate narrows but doesn't fully close that
        # window — acceptable for a flagged first cut.)
        return (
            resume_on_stall
            and session_id["id"] is not None
            and not pending_tool_uses
            and resumes["n"] < MAX_RESUME
        )

    async def _consume():
        nonlocal usage, error, aborted_reason

        def _abort_mcp_unavailable(
            entry: dict[str, Any] | None,
            *,
            backstop: bool = False,
            queries: list[str] | None = None,
        ) -> None:
            """Latch the #941 abort. Callers `return` immediately after.

            Travels as an `aborted_reason` sentinel rather than an exception on
            purpose: a raise from inside this coroutine is swallowed by the
            generic `except Exception` around `_consume()` below and relabelled
            `error`, which is the very confusion this detector exists to end.
            `run_e2e_test` turns the sentinel into `McpUnavailableError` after
            `_run_agent` returns, before the judge or any file write.
            """
            nonlocal aborted_reason, error
            mcp_state["unavailable"] = True
            aborted_reason = "mcp_unavailable"
            error = unavailable_message(entry, backstop=backstop, queries=queries)
            # Recorded like every other harness-side event even though THIS path
            # never persists it (the run writes no files at all — see
            # run_e2e_test). Kept so the in-memory trace is complete and so a
            # future change to the retention rule needs no new code here.
            narration.append(
                {
                    "tool_calls_before": len(tool_calls),
                    "kind": "harness",
                    "text": f"ABORT (mcp_unavailable) — {error}",
                }
            )
            _emit("[abort] genealogy MCP server unavailable — this run never happened")

        async def _shutdown(it) -> None:
            """Close the query stream so the CLI subprocess exits before we go.

            This abort fires seconds into a run, while every other stop reason
            takes minutes and then spends ~30s in the judge. That difference
            matters on Windows: a live CLI child still holds handles inside the
            workspace, so `TemporaryDirectory.__exit__` raises
            `PermissionError [WinError 32]` — and because `__exit__` runs before
            our exception propagates, that error *replaces* McpUnavailableError,
            burying the operator message and returning the wrong exit code
            (observed 2026-08-04). Mirrors the resume path's teardown below.
            """
            try:
                await asyncio.wait_for(it.aclose(), timeout=15)
            except Exception:  # noqa: BLE001 — teardown is best-effort
                pass

        current_options = options
        current_prompt = user_message
        while True:  # session (re)start loop — re-entered only to resume a stall
            iterator = query(prompt=current_prompt, options=current_options).__aiter__()
            _emit("agent started" if resumes["n"] == 0
                  else f"resumed session (attempt {resumes['n']}) after stall")
            restart = False
            while True:  # message loop
                try:
                    message = await asyncio.wait_for(
                        iterator.__anext__(),
                        timeout=fixture.caps.inactivity_seconds,
                    )
                except StopAsyncIteration:
                    return
                except asyncio.TimeoutError:
                    # No SDK message at all within the window (true silence).
                    if _should_resume():
                        restart = True
                        break
                    aborted_reason = "sdk_stream_silence"
                    error = (
                        f"no SDK message within {fixture.caps.inactivity_seconds}s "
                        "(inactivity)"
                    )
                    return

                now = time.monotonic()
                progressed = False

                if isinstance(message, AssistantMessage):
                    assistant_tool_names: list[str] = []
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            narration.append(
                                {
                                    "tool_calls_before": len(tool_calls),
                                    "kind": "assistant",
                                    "text": block.text,
                                }
                            )
                            one_line = " ".join(block.text.split())
                            if one_line:
                                _emit(one_line[:200])
                            progressed = True
                        elif isinstance(block, ToolUseBlock):
                            entry = {
                                "tool": block.name,
                                "args": dict(block.input or {}),
                                "response_summary": None,
                            }
                            tool_calls.append(entry)
                            pending_tool_uses[block.id] = entry
                            assistant_tool_names.append(
                                _timeline_tool_label(block.name, block.input)
                            )
                            if block.name == "Skill":
                                _emit(f">> skill: {(block.input or {}).get('skill', '?')}")
                            elif block.name.startswith("mcp__"):
                                _emit(f"   - {_bare_tool_name(block.name)}")
                            progressed = True
                    # Record before the timeline append so a message that
                    # arrives moments before a timeout still counts.
                    _accumulate_usage(streamed, message)
                    timeline.append(
                        [round(now - run_started, 1), "assistant", assistant_tool_names]
                    )
                elif isinstance(message, UserMessage):
                    # Tool results return as UserMessages with ToolResultBlock content.
                    content = message.content
                    tool_result_names: list[str] = []
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, ToolResultBlock):
                                entry = pending_tool_uses.pop(block.tool_use_id, None)
                                summary = _summarize_tool_response(block.content)
                                if entry is not None:
                                    apply_tool_result(entry, block, summary)
                                    # spec §11 Step 0 — join caller identity onto
                                    # this entry now that pretool_hook is
                                    # guaranteed to have already run for it
                                    # (the CLI always completes the
                                    # PreToolUse round-trip before executing
                                    # the tool and streaming this result).
                                    # pop, not get: this id is joined exactly
                                    # once, and an unpopped mapping would grow
                                    # for the life of the run. Mirrors
                                    # pending_tool_uses.pop() just above.
                                    agent_id, agent_type = caller_by_tool_use_id.pop(
                                        block.tool_use_id, (None, None)
                                    )
                                    entry["agent_id"] = agent_id
                                    entry["agent_type"] = agent_type
                                    tool_result_names.append(
                                        _timeline_tool_label(entry["tool"], entry.get("args"))
                                    )
                                    # #941 backstop — for a server that dies
                                    # AFTER init, when there is no init message
                                    # left to read. Absence surfaces only as
                                    # ToolSearch finding nothing (the genealogy
                                    # schemas are deferred under
                                    # ENABLE_TOOL_SEARCH), so count consecutive
                                    # no-match lookups while not one `mcp__`
                                    # call has ever succeeded. Threshold and
                                    # reset rule are calibrated against the
                                    # three lost runs in e2e.mcp_health.
                                    mcp_state["misses"] = tool_search_miss_streak(
                                        mcp_state["misses"],
                                        tool=entry["tool"],
                                        response_summary=summary,
                                        mcp_call_count=tool_call_count["n"],
                                    )
                                    # Record only the lookups that BUILT the
                                    # streak. A matched ToolSearch no longer
                                    # resets it (see tool_search_miss_streak),
                                    # so "the last N ToolSearch queries" is no
                                    # longer the same set as "the N misses" —
                                    # and it is the misses the operator needs to
                                    # tell a dead server from a real streak of
                                    # searches for tools that never existed.
                                    if is_no_match_tool_search(entry["tool"], summary):
                                        q = (entry.get("args") or {}).get("query")
                                        mcp_state["queries"] = (
                                            mcp_state["queries"] + [str(q)]
                                        )[-CONSECUTIVE_TOOL_SEARCH_MISSES:]
                                    if backstop_fired(mcp_state["misses"]):
                                        _abort_mcp_unavailable(
                                            None,
                                            backstop=True,
                                            queries=mcp_state["queries"],
                                        )
                                        await _shutdown(iterator)
                                        return
                                progressed = True
                    timeline.append(
                        [round(now - run_started, 1), "tool_result", tool_result_names]
                    )
                elif isinstance(message, SystemMessage):
                    # Init / config / hint messages. Capture the session id (for
                    # resume) and the CLI version (for the runlog); neither counts
                    # as progress.
                    data = getattr(message, "data", None) or {}
                    sid = data.get("session_id")
                    if sid:
                        session_id["id"] = sid
                    ver = data.get("version") or data.get("cli_version")
                    if ver:
                        cli_version["v"] = ver
                    timeline.append(
                        [round(now - run_started, 1), f"system:{message.subtype}", []]
                    )
                    # #941 — the decisive check, and it costs nothing: the CLI's
                    # init message lists every MCP server it tried to connect
                    # (`mcp_servers: [{name, status}]`, a required field of its
                    # own init schema). Three e2e runs were lost to a genealogy
                    # server that never connected; the agent then improvised for
                    # 35 minutes and two of the three declared success.
                    #
                    # Measured against this CLI (2026-08-04), which is why the
                    # classification is three-way and not a `!= "connected"`
                    # assert:
                    #   - dead server  -> init at ~25s, status ALREADY "failed"
                    #     (it settles in ~4s), so this aborts at ~25s.
                    #   - healthy      -> init at ~11s, status still "pending"
                    #     (it settles at ~25s). A "not connected -> abort" test
                    #     would kill EVERY healthy run here.
                    # So `pending` is the normal healthy reading at init, and a
                    # dead server that settles late lands there too — which is
                    # what the ToolSearch backstop below exists to catch.
                    #
                    # Scoped to the genealogy server by name on purpose: this
                    # list also carries the operator's own claude.ai connectors
                    # (observed: "claude.ai Google Drive"/"Slack" as
                    # `needs-auth`), so an "any server unhealthy" test would
                    # abort every run on such a machine.
                    if message.subtype == "init":
                        servers = data.get("mcp_servers")
                        health = classify_server_status(servers)
                        # Only a run that has done NOTHING can be declared never
                        # to have happened. This branch is NOT reachable only at
                        # t=0: a resume after a stall (resume_on_stall, ON by
                        # default) re-spawns the CLI — and with it the MCP server
                        # — and emits a FRESH init. If that second spawn fails 40
                        # minutes into a run that already did real, tool-backed
                        # research, aborting would raise before
                        # write_result_files and throw all of it away while
                        # printing "no research was possible", which would be
                        # false. So past the first genealogy call this degrades
                        # to a recorded warning: the run keeps its artifacts and
                        # ends on its own terms (natural_end / a cap), which is
                        # the honest verdict for a run that did work and then
                        # lost its tools.
                        abort_now = should_abort_at_init(
                            health, mcp_call_count=tool_call_count["n"]
                        )
                        nothing_attempted_yet = tool_call_count["n"] == 0
                        note = {
                            "connected": "connected — tools available",
                            "inconclusive": (
                                "still connecting (normal at init); the "
                                "ToolSearch backstop covers it from here"
                            ),
                            "unavailable": (
                                "UNAVAILABLE — aborting"
                                if nothing_attempted_yet
                                else (
                                    "UNAVAILABLE on this session, but "
                                    f"{tool_call_count['n']} genealogy call(s) "
                                    "already happened — NOT aborting; the run "
                                    "keeps its artifacts and ends on its own"
                                )
                            ),
                        }[health]
                        # Persisted on every run, healthy ones included: `init`
                        # arrives before any tool call, so this lands at
                        # tool_calls_before 0 and tells a reader whether the
                        # surface was there at all.
                        narration.append(
                            {
                                "tool_calls_before": len(tool_calls),
                                "kind": "harness",
                                "text": (
                                    f"genealogy MCP server at session start: {note}"
                                ),
                            }
                        )
                        if abort_now:
                            _abort_mcp_unavailable(find_server_entry(servers))
                            await _shutdown(iterator)
                            return
                elif isinstance(message, ResultMessage):
                    timeline.append([round(now - run_started, 1), "result", []])
                    usage = {
                        "duration_ms": message.duration_ms,
                        "duration_api_ms": message.duration_api_ms,
                        "num_turns": message.num_turns,
                        "is_error": message.is_error,
                        "stop_reason": message.stop_reason,
                        "total_cost_usd": message.total_cost_usd,
                        "usage": message.usage,
                    }
                    if message.is_error and aborted_reason is None:
                        detail = message.result or message.stop_reason or ""
                        # The SDK surfaces a turn-cap hit as an *error result*
                        # rather than a clean stop_reason="max_turns". Reclassify.
                        if is_turn_cap_error(detail):
                            aborted_reason = "max_turns"
                            error = str(detail)
                        else:
                            aborted_reason = "error"
                            error = detail
                    # Cost cap wins over a plain max_turns end: if the run both
                    # hit the turn limit and blew the budget, the budget is the
                    # more actionable reason. Neither overwrites an earlier abort
                    # (e.g. a mid-stream error).
                    if (
                        aborted_reason is None
                        and message.total_cost_usd is not None
                        and message.total_cost_usd > fixture.caps.max_cost_usd
                    ):
                        aborted_reason = "cost_cap"
                    if aborted_reason is None and message.stop_reason == "max_turns":
                        aborted_reason = "max_turns"

                # Progress watchdog: a stall is "stream alive, no progress". The
                # plain inactivity timer above misses it (messages keep arriving),
                # which is why the observed stall burned to the wall-clock cap.
                if progressed:
                    last_progress["t"] = now
                elif now - last_progress["t"] > fixture.caps.progress_stall_seconds:
                    if _should_resume():
                        restart = True
                        break
                    aborted_reason = "no_progress_stall"
                    error = (
                        "no progress (assistant text / tool call) for "
                        f"{fixture.caps.progress_stall_seconds}s"
                    )
                    return

            # Reached only on a stall in a provably-safe state: tear down the
            # hung query and resume the same session from where it left off.
            if not restart:
                return
            resumes["n"] += 1
            try:
                await asyncio.wait_for(iterator.aclose(), timeout=15)
            except Exception:  # noqa: BLE001 — best-effort teardown of a hung subprocess
                pass
            _emit(f"stall — resuming session {session_id['id']!r} (attempt {resumes['n']})")
            current_options = replace(options, resume=session_id["id"], fork_session=False)
            current_prompt = (
                "Continue from where you left off — resume the research workflow."
            )
            last_progress["t"] = time.monotonic()

    try:
        await asyncio.wait_for(_consume(), timeout=fixture.caps.wall_clock_seconds)
    except asyncio.TimeoutError:
        aborted_reason = "max_wall_clock_seconds"
        error = f"wall-clock timeout after {fixture.caps.wall_clock_seconds}s"
    except Exception as e:  # noqa: BLE001 — surface any SDK failure cleanly
        detail = f"{type(e).__name__}: {e}"
        # The SDK can raise the turn-cap as an exception rather than a clean
        # ResultMessage; reclassify it to `max_turns` (a known stop) the same
        # way the ResultMessage branch does, so it isn't mislabeled `error`.
        aborted_reason = "max_turns" if is_turn_cap_error(detail) else "error"
        error = detail

    if aborted_reason is None and tool_call_count["n"] > fixture.caps.tool_calls:
        aborted_reason = "max_tool_calls"
        error = f"tool_calls cap ({fixture.caps.tool_calls}) exceeded"

    # A ResultMessage populates `usage` with the SDK's authoritative numbers.
    # Every abort path (wall-clock timeout, inactivity silence, no-progress
    # stall) cuts the stream before it, leaving `usage` empty — so fall back to
    # what the stream already told us. `usage_source` marks which one you're
    # reading: a fallback block has exact token counts but a null cost, and
    # must not be compared against a clean run's `total_cost_usd`.
    result_message_seen = "num_turns" in usage
    if not result_message_seen:
        usage = _fallback_usage(
            streamed, int((time.monotonic() - run_started) * 1000)
        )

    usage = {
        **usage,
        "usage_source": "result_message" if result_message_seen else "streamed_fallback",
        "continue_nudges": continue_nudges["n"],
        # Stall-resume + forensics (added with the progress watchdog). `timeline`
        # is [elapsed_seconds, kind] per SDK message — split structural vs stall
        # time and locate a no-progress gap without a session.jsonl. `caps` makes
        # the runlog self-describing so a `timeout` is never ambiguous again.
        "session_id": session_id["id"],
        "resumes": resumes["n"],
        "resume_on_stall": resume_on_stall,
        "timeline": timeline,
        # Reasoning knobs actually used, so a run is self-describing when we
        # A/B effort × output-budget against subagent behavior. `effort_level`
        # and `agent_model` are added in run_e2e_test; `max_output_tokens` None
        # means the CLI default (sonnet-5 -> 32000).
        "max_output_tokens": max_output_tokens,
        "cli_version": cli_version["v"],
        "caps": {
            "wall_clock_seconds": fixture.caps.wall_clock_seconds,
            "inactivity_seconds": fixture.caps.inactivity_seconds,
            "progress_stall_seconds": fixture.caps.progress_stall_seconds,
            "tool_calls": fixture.caps.tool_calls,
            "max_turns": fixture.caps.max_turns,
            "max_cost_usd": fixture.caps.max_cost_usd,
        },
    }
    # docs/specs/guardrail-enforcement-spec.md §7 — SHADOW MODE ONLY:
    # computed once over the completed `tool_calls` list (equivalent to
    # checking live at each call, since the check only ever looks backward),
    # so this ships without touching pretool_hook's decision path at all.
    # Graduating to actual denial later requires moving the check into
    # pretool_hook, since only a live PreToolUse decision can reject a call
    # before it happens — this post-hoc form can only ever log.
    guardrail_shadow_violations = find_unguarded_protected_writes(
        tool_calls, window=GUARDRAIL_SHADOW_WINDOW
    )
    if guardrail_shadow_violations:
        _emit(
            f"[guardrail-shadow] {len(guardrail_shadow_violations)} protected write(s) "
            "with no recent matching Skill invocation (shadow mode — not denied)"
        )
    # issue #963 — fold in the hook-sourced provenance gaps collected live in
    # pretool_hook. Same list because both answer "a guardrail's effect landed
    # without its guardrail", and one field keeps the shadow signal readable in
    # one place; kept ordered after the post-hoc entries so the two sources stay
    # distinguishable by their `detail` key.
    if provenance_shadow:
        guardrail_shadow_violations = guardrail_shadow_violations + provenance_shadow
        _emit(
            f"[guardrail-shadow] {len(provenance_shadow)} person_evidence link(s) "
            "written with no prior same_person (shadow mode — not denied)"
        )

    # SHADOW MODE ONLY, same as the block above — see
    # harness/skill_invocation.py::find_protected_writes_by_unnamed_delegate
    # (docs/specs/guardrail-enforcement-spec.md §11) for the bypass shape
    # this detects: a guardrail skill's (or record-extraction's) protected
    # write whose PreToolUse-sourced agent_id/agent_type shows it was made
    # by neither the main thread nor one of the four dedicated Cowork
    # agents. Relies on the caller attribution `pretool_hook` now stamps
    # onto every tool_calls entry (spec §11's "Step 0") — historical runlogs
    # simply lack the keys, so this logs rather than overrides the verdict
    # until real runs accumulate a shadow-mode sample (tracked as its own
    # backlog item — task #980).
    unnamed_delegate_violations = find_protected_writes_by_unnamed_delegate(tool_calls)
    if unnamed_delegate_violations:
        _emit(
            f"[unnamed-delegate] {len(unnamed_delegate_violations)} protected write(s) "
            "made by neither the main thread nor a dedicated agent (shadow mode — not denied)"
        )

    # SHADOW MODE ONLY (issue #1133) — a post-hoc read of the FINAL research.json,
    # not a tool_calls scan: a source that BACKS A WRITTEN CONCLUSION carries an
    # empty ESM citation string (the provenance-nulling half the engine's
    # write-seam ref guard deliberately disowns; see
    # find_citation_nulling_in_conclusions). Folded into the same already-plumbed
    # `guardrail_shadow_violations` field, discriminated by its `kind` key so the
    # shadow report counts it in its own bucket. Logs; never fails the run.
    # Graduating to a hard 4th §7.5 compliance check is gated on measuring this
    # fire rate across the corpus (issue #1358; see the spec's §7.5 note).
    citation_nulling_shadow = find_citation_nulling_in_conclusions(
        read_research_json(workspace)
    )
    if citation_nulling_shadow:
        guardrail_shadow_violations = guardrail_shadow_violations + citation_nulling_shadow
        _emit(
            f"[guardrail-shadow] {len(citation_nulling_shadow)} concluded source(s) "
            "with a null/empty citation string (shadow mode — not failed)"
        )

    return (
        tool_calls,
        narration,
        usage,
        aborted_reason,
        error,
        blocked_tree_reads,
        blocked_context_calls,
        guardrail_shadow_violations,
        unnamed_delegate_violations,
    )


def _find_session_transcript(workspace: Path) -> Path | None:
    """Locate the Agent SDK's raw session JSONL for this run.

    The SDK runs Claude Code as a subprocess, which writes a session transcript
    to ``~/.claude/projects/<cwd-slug>/<session>.jsonl``. That file lives OUTSIDE
    the workspace tempdir, so it survives the TemporaryDirectory cleanup — but it
    is otherwise only discoverable by hand. It is strictly richer than the
    runlog's own structured trace: only the JSONL has
    per-message timestamps, per-turn token/cache usage, thinking blocks, and
    untruncated tool payloads — everything needed to diagnose latency and cost.

    Matched on the unique tempdir leaf (``e2e-<id>-<rand>``), which appears
    verbatim in the slug, so this does not depend on the exact path-slug
    transform. Returns the newest matching JSONL, or None if none is found.
    """
    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        return None
    leaf = workspace.name
    candidates = [
        p
        for d in projects.iterdir()
        if d.is_dir() and d.name.endswith(leaf)
        for p in d.glob("*.jsonl")
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def check_guardrail_compliance(
    tool_calls: list[dict[str, Any]],
    final_research: dict[str, Any] | None,
    final_tree: dict[str, Any] | None,
    *,
    starting_tree: dict[str, Any] | None = None,
) -> list[str]:
    """The §8 HARD guardrail detector — every non-windowed check, in one call.

    docs/specs/guardrail-enforcement-spec.md §8. A guardrail skill's
    effect present in the FINAL project state with no matching successful
    invocation anywhere in the run, or a resolved question's proof_summary
    missing its mandatory gps-mentor proof-critique verdict. Mirrors the unit
    harness's `test_positive_fails_when_skill_not_in_skills_invoked`, which
    had no e2e equivalent. Unlike §4.1's shadow-mode recency check, this only
    asks whether the skill ran AT ALL across the whole run, so it is far less
    prone to false positives and was safe to hard-fail on immediately rather
    than rolling out in shadow mode first.

    `find_person_evidence_missing_same_person` is a separate, also-hard,
    also-non-windowed check added after the first real run of
    bagley-father-1884 showed the gap in "invoked anywhere": that run linked a
    brand-new person across 13 person_evidence entries with zero same_person
    calls in the whole run, while person-evidence ITSELF was invoked 52 tool
    calls later for unrelated work — passing the "invoked anywhere" bar while
    still skipping the identity-scoring doctrine entirely. It checks the
    specific required tool for the specific person instead of the skill's mere
    presence in the run.

    Note this is NOT vacuous on a treeless run: `find_missing_mentor_verdicts`
    takes no tree at all, and the exhaustiveness arm reads only
    `research["questions"]`. That is why compliance is always a real result
    and never "not checked" for a run this harness performed.

    Extracted from `run_e2e_test` so it is unit-testable — the fused-verdict
    bug this replaced (issue #972) lived in an assembly statement buried in a
    1200-line async function that needs the SDK and a live FamilySearch session.
    """
    return (
        find_effects_without_invocation(
            tool_calls, final_research, final_tree, starting_tree=starting_tree
        )
        + find_missing_mentor_verdicts(final_research)
        + find_person_evidence_missing_same_person(
            tool_calls, final_research, final_tree, starting_tree=starting_tree
        )
    )


async def run_e2e_test(
    *,
    fixture_dir: Path,
    runlog_root: Path = DEFAULT_RUNLOG_ROOT,
    mcp_server_entry: Path = DEFAULT_MCP_SERVER_ENTRY,
    skills_dir: Path = DEFAULT_PLUGIN_SKILLS,
    skip_judge: bool = False,
    resume_on_stall: bool = False,
    effort_level: str | None = "high",
    max_output_tokens: int | None = None,
    agent_model: str | None = None,
    person_evidence_guard: str = PERSON_EVIDENCE_GUARD_SHADOW,
) -> tuple[E2eResult, dict[str, Path]]:
    """Run one e2e fixture end-to-end. Returns (result, written-paths).

    Reasoning is pinned deliberately so runs don't inherit the launching Claude
    Code session / shell (which made verdicts non-reproducible):
    ``effort_level`` (low|medium|high|xhigh|max, default "high" to match Cowork)
    via a project-level setting; ``max_output_tokens`` (None = CLI default,
    sonnet-5 → 32000) via CLAUDE_CODE_MAX_OUTPUT_TOKENS. ``agent_model`` (None =
    fixture default for the parent + each subagent's own `.md` pin) overrides the
    model for BOTH the parent and every staged subagent — e.g. run the whole flow
    under claude-sonnet-4-6 to test whether the sonnet-5 record-extractor freeze
    reproduces under Cowork's model. All are logged.
    """
    fixture = load_fixture(fixture_dir)
    if not mcp_server_entry.exists():
        raise FileNotFoundError(
            f"MCP server build not found at {mcp_server_entry}. "
            "Run `npm run build` in packages/engine/mcp-server/ first."
        )

    started_at = time.time()  # real clock (counts system sleep)
    started_mono = time.monotonic()  # active clock (pauses during macOS sleep)
    # Provenance (#1091), captured at run start from the repo files this run
    # stages — the prompt identity, so a committed run ties back to what produced
    # it. `agents_dir` MUST match the one `build_workspace` uses below (it takes
    # its default, DEFAULT_PLUGIN_AGENTS); if an `--agents-dir` override is ever
    # threaded there, thread it here too or the hash silently diverges.
    run_git_sha = provenance.git_sha(REPO_ROOT)
    run_skills_hash = provenance.skills_hash(skills_dir, DEFAULT_PLUGIN_AGENTS)

    # ignore_cleanup_errors: on Windows a CLI child that outlives the run keeps
    # handles inside the workspace, and TemporaryDirectory.__exit__ then raises
    # PermissionError [WinError 32] — which REPLACES whatever exception the block
    # was already propagating (observed with #941's McpUnavailableError, where it
    # buried the operator message and changed the exit code). A leaked temp dir is
    # strictly better than a masked error; the OS reclaims it.
    with tempfile.TemporaryDirectory(
        prefix=f"e2e-{fixture.id}-", ignore_cleanup_errors=True
    ) as tmp:
        workspace = build_workspace(
            fixture, Path(tmp), skills_dir, effort_level=effort_level, agent_model=agent_model
        )
        # Snapshot BEFORE the agent touches the workspace — build_workspace just
        # copied fixture.starting_tree_path in. Lets the §8 guardrail-effects
        # check (below) tell a fixture's own seeded persons apart from persons
        # the agent created/enriched this run (docs/plan/
        # guardrail-enforcement-spec.md §8).
        starting_tree = read_tree_json(workspace)

        (
            tool_calls,
            narration,
            usage,
            aborted,
            error,
            blocked_tree_reads,
            blocked_context_calls,
            guardrail_shadow_violations,
            unnamed_delegate_violations,
        ) = await _run_agent(
            fixture=fixture,
            workspace=workspace,
            mcp_server_entry=mcp_server_entry,
            resume_on_stall=resume_on_stall,
            max_output_tokens=max_output_tokens,
            agent_model=agent_model,
            person_evidence_guard=person_evidence_guard,
        )

        final_research = read_research_json(workspace)
        final_tree = read_tree_json(workspace)
        stop_reason = derive_stop_reason(
            sdk_aborted_reason=aborted, research=final_research
        )

        # #941 — bail out here, and only here. One raise, placed between the
        # stop_reason and the judge, satisfies the whole retention decision:
        # the judge below never fires (its `final_tree is None` guard would NOT
        # have caught this — build_workspace copies the fixture's starting tree
        # in, so an aborted run HAS a tree and would have paid for an opus
        # call), and neither write_result_files nor the session.jsonl copy is
        # reached, so no run-log files exist and no E2eResult is ever built.
        # "This run never happened" — print the error, exit non-zero.
        if stop_reason == "mcp_unavailable":
            raise McpUnavailableError(
                error or unavailable_message(None)
            )

        judge_seconds = 0.0
        if skip_judge or final_tree is None:
            # Both cases produce no verdict: --skip-judge by request, or no
            # tree for the judge to grade (agent crashed before writing one).
            judge_output: dict[str, Any] = {}
            verdict = "skipped"
        else:
            judge_start = time.monotonic()
            try:
                judge_output = judge_module.run_judge(
                    research_question=fixture.researcher_question,
                    expected_findings=fixture.expected_findings,
                    final_tree=final_tree,
                    final_research=final_research,
                    model=fixture.judge_model,
                )
                # Deterministic §3.4.1 backstop: an `avoid` finding whose
                # target is still in the final tree is forced to matched:
                # "false" and the verdict recomputed (downgrade-only).
                judge_output = judge_module.apply_avoid_guard(
                    judge_output,
                    expected_findings=fixture.expected_findings,
                    final_tree=final_tree,
                    subject_person_ids=fixture.subject_person_ids,
                )
                verdict = str(judge_output.get("verdict") or "fail")
            except Exception as e:  # noqa: BLE001 — keep the run loggable
                judge_output = {"error": f"{type(e).__name__}: {e}"}
                # A run with a final tree is worth committing even when the judge
                # failed — the tree can be re-graded later. "ungraded" is distinct
                # from "fail" (the judge never reached a conclusion) and from
                # "skipped" (no tree at all). The tree can be re-graded with
                # /grade-e2e-run or by re-running the judge.
                verdict = "ungraded"
            judge_seconds = time.monotonic() - judge_start

        # The COMPLIANCE axis (§4.4). Deliberately does not touch `verdict` —
        # `E2eResult` derives `compliance` and the combined `outcome` gate
        # from these violations. See check_guardrail_compliance.
        guardrail_bypass_violations = check_guardrail_compliance(
            tool_calls, final_research, final_tree, starting_tree=starting_tree
        )

        # `wall_clock_seconds` is the ACTIVE wall-clock (time.monotonic), so it
        # matches the wall-clock cap and the stall watchdog (also monotonic) and
        # is NOT inflated by laptop sleep. `real_clock_seconds` is the literal
        # elapsed (time.time); `slept_seconds` (their gap) is ≈ time the machine
        # slept, so a long idle never masquerades as a stall again. `judge_seconds`
        # is the post-agent judge call, kept separate from the agent run.
        active_seconds = time.monotonic() - started_mono
        real_seconds = time.time() - started_at
        usage = {
            **usage,
            "wall_clock_seconds": active_seconds,
            "real_clock_seconds": real_seconds,
            "slept_seconds": max(0.0, real_seconds - active_seconds),
            "judge_seconds": judge_seconds,
            # Reasoning config, so a run is self-describing when A/B'ing effort ×
            # output-budget × model vs subagents[] behavior. `agent_model` is the
            # effective PARENT model. `subagent_model_override` is non-null only
            # when --agent-model forced every staged subagent off its own `.md`
            # pin (record-extractor's default is sonnet-5); null means each
            # subagent used its pin. `max_output_tokens` / `cli_version` come from
            # _run_agent.
            "agent_model": agent_model or fixture.agent_model,
            "subagent_model_override": agent_model,
            "effort_level": effort_level,
            # issue #1231. "shadow" (the default) records provenance gaps and
            # lets the write through; "deny" also blocks it. Recorded because the
            # two are NOT interchangeable when reading a run: under "deny" the
            # blocked write never lands, so the post-run
            # find_person_evidence_missing_same_person sees no person_evidence
            # entry for that person and its compliance arm passes VACUOUSLY.
            "person_evidence_guard": person_evidence_guard,
        }

        # Summarize any subagent transcripts (record-extractor, image-reader, …)
        # from the SDK's ephemeral cache while `workspace` is still in scope (the
        # cache lives outside the tempdir, keyed on workspace.name). Best-effort;
        # surfaces a runaway-thinking subagent freeze directly in the committed
        # runlog, which tool_calls alone can't show. See subagent_capture.py.
        subagents = collect_subagents(workspace)

        result = E2eResult(
            test_id=fixture.id,
            captured_at=timestamp_slug(),
            verdict=verdict,
            stop_reason=stop_reason,
            judge_output=judge_output,
            usage=usage,
            tool_calls=tool_calls,
            error=error,
            tags=fixture.tags,
            blocked_tree_reads=blocked_tree_reads,
            blocked_context_calls=blocked_context_calls,
            narration=narration,
            guardrail_bypass_violations=guardrail_bypass_violations,
            guardrail_shadow_violations=guardrail_shadow_violations,
            protected_writes_by_unnamed_delegate=unnamed_delegate_violations,
            subagents=subagents,
            git_sha=run_git_sha,
            skills_hash=run_skills_hash,
        )

        runlog_dir = runlog_root / fixture.id
        paths = write_result_files(
            result=result,
            runlog_dir=runlog_dir,
            final_tree=final_tree,
            final_research=final_research,
            timestamp=result.captured_at,
        )

        # Copy the raw SDK session transcript next to the runlog. The runlog
        # carries a summarized trace; this JSONL carries per-message
        # timestamps, per-turn token/cache usage, thinking, and untruncated
        # payloads. Best-effort — a missing session file never fails an
        # otherwise-successful run. Done inside the tempdir block so `workspace`
        # is still in scope (the JSONL itself lives outside the tempdir).
        session_jsonl = _find_session_transcript(workspace)
        if session_jsonl is not None:
            dest = runlog_dir / f"{paths['result'].stem}.session.jsonl"
            shutil.copy(session_jsonl, dest)
            paths["session"] = dest

    return result, paths
