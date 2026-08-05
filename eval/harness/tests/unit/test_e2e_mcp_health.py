"""Unit tests for e2e.mcp_health — the #941 absent-tool-surface detector.

Every arm of the decision lives here because the async message loop that calls
it cannot be unit-tested (see test_e2e_orchestrator.py's module docstring). The
last two tests replay the actual incident: the recorded `tool_calls` of the
three runs lost on 2026-07-29 and of the healthy control run from the same
night, so the backstop threshold is regression-tested against the corpus rather
than against a hand-made sequence.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.mcp_health import (
    CONSECUTIVE_TOOL_SEARCH_MISSES,
    GENEALOGY_SERVER_NAME,
    backstop_fired,
    classify_server_status,
    find_server_entry,
    genealogy_mcp_config,
    is_no_match_tool_search,
    should_abort_at_init,
    tool_search_miss_streak,
    unavailable_cause,
    unavailable_message,
)

# eval/runlogs/e2e/ — four levels up from eval/harness/tests/unit/.
RUNLOG_ROOT = Path(__file__).resolve().parents[3] / "runlogs" / "e2e"
FERBER = RUNLOG_ROOT / "william-ferber-origins"


def _entries(status: str, name: str = GENEALOGY_SERVER_NAME, **extra):
    return [{"name": name, "status": status, **extra}]


# --------------------------------------------------------------------------
# genealogy_mcp_config — shared by the run and preflight, so its shape matters
# --------------------------------------------------------------------------


def test_config_is_a_stdio_node_server_under_the_genealogy_key():
    entry = Path("/tmp/build/index.js")
    config = genealogy_mcp_config(entry)
    assert list(config) == [GENEALOGY_SERVER_NAME]
    assert config[GENEALOGY_SERVER_NAME]["type"] == "stdio"
    assert config[GENEALOGY_SERVER_NAME]["command"] == "node"
    # `str(Path)`, not a POSIX literal: the genealogist team runs Windows, where
    # this renders with backslashes.
    assert config[GENEALOGY_SERVER_NAME]["args"] == [str(entry)]


def test_config_stringifies_the_entry_path():
    # The SDK serializes this to JSON for the CLI; a Path would not survive.
    config = genealogy_mcp_config(Path("build") / "index.js")
    assert all(isinstance(a, str) for a in config[GENEALOGY_SERVER_NAME]["args"])


# --------------------------------------------------------------------------
# classify_server_status — one test per arm
# --------------------------------------------------------------------------


def test_connected_is_connected():
    assert classify_server_status(_entries("connected")) == "connected"


def test_failed_is_unavailable():
    assert classify_server_status(_entries("failed")) == "unavailable"


def test_needs_auth_is_unavailable():
    assert classify_server_status(_entries("needs-auth")) == "unavailable"


def test_disabled_is_unavailable():
    assert classify_server_status(_entries("disabled")) == "unavailable"


def test_absent_entry_is_unavailable():
    """The observed mode: the tools were simply not in the session."""
    assert classify_server_status(_entries("connected", name="other")) == "unavailable"


def test_empty_server_list_is_inconclusive_not_unavailable():
    # The CLI seeds every configured client as `pending` before connecting, so a
    # configured server is present from the first init. An EMPTY list therefore
    # means "not populated yet", not "your server is gone" — and this is the one
    # arm that kills a run leaving no artifact to diagnose from. The backstop
    # covers a list that stays empty.
    assert classify_server_status([]) == "inconclusive"


def test_other_servers_listed_but_not_ours_is_unavailable():
    # THIS is the observed failure: the CLI answered with a real server list and
    # the genealogy server simply is not in it.
    assert (
        classify_server_status([{"name": "claude.ai Slack", "status": "needs-auth"}])
        == "unavailable"
    )


def test_pending_is_inconclusive():
    """A healthy stdio server can still be handshaking — never abort on this."""
    assert classify_server_status(_entries("pending")) == "inconclusive"


def test_unknown_status_is_inconclusive():
    assert classify_server_status(_entries("something-new")) == "inconclusive"


def test_missing_server_list_is_inconclusive_not_unavailable():
    # A non-init system message, or an older CLI: say nothing rather than
    # accuse the environment and kill the run.
    assert classify_server_status(None) == "inconclusive"
    assert classify_server_status({"mcp_servers": []}) == "inconclusive"


def test_malformed_members_do_not_raise_and_do_not_abort():
    # A payload shape we cannot read is evidence we are reading the wrong shape,
    # NOT evidence the server is absent. Fail open: this arm aborts a run with no
    # run log to diagnose from, so an unparseable list must not reach it.
    assert classify_server_status(["nonsense", None, 7]) == "inconclusive"


def test_one_readable_member_is_enough_to_judge_absence():
    # Mixed garbage plus at least one real entry: the list IS readable, ours is
    # not in it, so this is the observed failure and must abort.
    assert classify_server_status([None, 7, {"name": "other"}]) == "unavailable"


def test_abort_at_init_only_before_the_first_genealogy_call():
    assert should_abort_at_init("unavailable", mcp_call_count=0) is True
    # A resume after a stall re-spawns the CLI and emits a fresh `init`. Aborting
    # then would raise before write_result_files and discard real research while
    # claiming none happened, so past the first call this must NOT abort.
    assert should_abort_at_init("unavailable", mcp_call_count=1) is False
    assert should_abort_at_init("unavailable", mcp_call_count=87) is False


def test_abort_at_init_never_fires_on_a_healthy_or_unsettled_reading():
    for health in ("connected", "inconclusive"):
        assert should_abort_at_init(health, mcp_call_count=0) is False


def test_backstop_message_names_the_queries_it_searched():
    # This arm writes no run log, so the console is the only artifact: without
    # the queries a false positive is indistinguishable from a dead server.
    cause = unavailable_cause(None, backstop=True, queries=["+record_search", "+tree_edit"])
    assert "+record_search" in cause and "+tree_edit" in cause
    # And it must still read cleanly with none supplied.
    assert "searched:" not in unavailable_cause(None, backstop=True)


def test_find_server_entry_returns_the_matching_dict():
    entries = [{"name": "other", "status": "connected"}, *_entries("failed", error="boom")]
    assert find_server_entry(entries)["error"] == "boom"
    assert find_server_entry([{"name": "other", "status": "connected"}]) is None


# --------------------------------------------------------------------------
# is_no_match_tool_search / tool_search_miss_streak
# --------------------------------------------------------------------------


def test_no_match_tool_search_is_recognized_case_insensitively():
    assert is_no_match_tool_search("ToolSearch", "No matching deferred tools found")
    assert is_no_match_tool_search("ToolSearch", "no MATCHING DEFERRED TOOLS found")


def test_a_matching_tool_search_is_not_a_miss():
    assert not is_no_match_tool_search("ToolSearch", '{"matches": ["record_search"]}')


def test_a_none_summary_is_not_a_miss():
    # A tool_use whose result has not arrived yet must not count as evidence.
    assert not is_no_match_tool_search("ToolSearch", None)


def test_another_tool_is_never_a_miss():
    assert not is_no_match_tool_search("Glob", "No matching deferred tools found")


def test_streak_increments_only_while_no_mcp_call_has_succeeded():
    kwargs = {"tool": "ToolSearch", "response_summary": "No matching deferred tools found"}
    assert tool_search_miss_streak(0, mcp_call_count=0, **kwargs) == 1
    assert tool_search_miss_streak(1, mcp_call_count=0, **kwargs) == 2
    # Once any genealogy call has worked, the surface demonstrably exists.
    assert tool_search_miss_streak(2, mcp_call_count=1, **kwargs) == 0


def test_a_matching_tool_search_carries_the_streak_rather_than_resetting_it():
    """A match proves *some* deferred tool exists, not that ours does.

    `ENABLE_TOOL_SEARCH` defers the built-ins too, so a matched lookup is no
    evidence about the genealogy surface. Only a dispatched `mcp__` call is
    (see the test above).
    """
    assert (
        tool_search_miss_streak(
            2, tool="ToolSearch", response_summary='{"matches": ["x"]}', mcp_call_count=0
        )
        == 2
    )


def test_a_dead_server_cannot_starve_the_backstop_with_unrelated_matches():
    """The evasion review found on this branch, as a regression test.

    Alternating a genealogy miss with a match on some *other* deferred tool
    (`select:WebFetch` — a query shape recorded verbatim in all three lost runs)
    used to hold the streak at 1 forever, so the backstop never fired and the
    run flailed to the wall-clock cap. It must now reach the threshold.
    """
    streak = 0
    for _ in range(CONSECUTIVE_TOOL_SEARCH_MISSES):
        streak = tool_search_miss_streak(
            streak,
            tool="ToolSearch",
            response_summary="No matching deferred tools found",
            mcp_call_count=0,
        )
        streak = tool_search_miss_streak(
            streak,
            tool="ToolSearch",
            response_summary='{"matches": ["WebFetch"]}',
            mcp_call_count=0,
        )
    assert backstop_fired(streak)


def test_unrelated_tools_carry_the_streak_unchanged():
    # All three lost runs interleaved Glob/Read/WebSearch between searches; a
    # counter that reset on those would never have reached the threshold.
    for tool in ("Glob", "Read", "WebSearch", "Edit", "mcp__genealogy__record_search"):
        assert tool_search_miss_streak(2, tool=tool, response_summary="ok", mcp_call_count=0) == 2


def test_backstop_fires_at_the_threshold_and_not_before():
    assert not backstop_fired(CONSECUTIVE_TOOL_SEARCH_MISSES - 1)
    assert backstop_fired(CONSECUTIVE_TOOL_SEARCH_MISSES)


# --------------------------------------------------------------------------
# unavailable_message — acceptance criterion 4 is about these words
# --------------------------------------------------------------------------


def test_message_quotes_the_servers_own_error_text():
    text = unavailable_message({"name": GENEALOGY_SERVER_NAME, "status": "failed", "error": "spawn node ENOENT"})
    assert "spawn node ENOENT" in text
    assert "'failed'" in text


def test_message_names_absence_when_there_is_no_entry_to_quote():
    # McpServerStatus.error is NotRequired and only present on `failed`; the
    # absent-entry arm has no entry at all, so nothing may render as "None".
    text = unavailable_message(None)
    assert "never registered" in text
    assert "None" not in text


def test_message_tells_a_genealogist_to_rerun_not_to_reresearch():
    for text in (unavailable_message(None), unavailable_message(None, backstop=True)):
        assert "ENVIRONMENT failure" in text
        assert "RE-RUN" in text
        assert "re-research" in text
        assert "make e2e-preflight" in text


def test_backstop_message_explains_the_streak_rather_than_a_status():
    text = unavailable_message(None, backstop=True)
    assert str(CONSECUTIVE_TOOL_SEARCH_MISSES) in text
    assert "ToolSearch" in text


# --------------------------------------------------------------------------
# Corpus replay — the actual incident (issue #941)
# --------------------------------------------------------------------------

# (run log, tool call number at which the backstop fires). Measured by
# replaying the committed run logs; see CONSECUTIVE_TOOL_SEARCH_MISSES.
LOST_RUNS = [
    ("run-2026-07-29_02-09-46.json", 12),
    ("run-2026-07-29_12-16-49.json", 11),
    ("run-2026-07-29_17-05-11.json", 13),
]
HEALTHY_RUN = "run-2026-07-29_18-46-15.json"


def _replay(runlog: Path) -> tuple[int | None, int, int]:
    """Fold a run's recorded tool_calls through the detector.

    Returns (1-based call number the backstop fired at or None, total calls,
    successful `mcp__` calls) — mirroring the orchestrator's loop, which folds
    each ToolResultBlock in arrival order and tracks its own `mcp__`-only count.
    """
    return _fold(json.loads(runlog.read_text(encoding="utf-8")).get("tool_calls", []))


def _fold(calls: list) -> tuple[int | None, int, int]:
    """The replay itself, over already-parsed `tool_calls`.

    Split out so the corpus sweep below parses each run log once instead of
    twice — these logs carry full transcripts and the sweep reads every one.
    """
    streak = 0
    mcp_calls = 0
    fired_at = None
    for index, call in enumerate(calls, start=1):
        tool = str(call.get("tool", ""))
        streak = tool_search_miss_streak(
            streak,
            tool=tool,
            response_summary=call.get("response_summary"),
            mcp_call_count=mcp_calls,
        )
        if tool.startswith("mcp__"):
            mcp_calls += 1
        if fired_at is None and backstop_fired(streak):
            fired_at = index
    return fired_at, len(calls), mcp_calls


@pytest.mark.parametrize(("filename", "expected_call"), LOST_RUNS)
def test_backstop_fires_on_each_lost_run(filename: str, expected_call: int):
    """The three runs #941 was filed for: abort in the first fifth of the run."""
    runlog = FERBER / filename
    # A hard failure, NOT a skip. These four committed run logs are this arm's
    # only acceptance evidence: CONSECUTIVE_TOOL_SEARCH_MISSES is calibrated
    # against them and against nothing else. Run-log pruning is automated as of
    # #1238, so a skip would let a prune turn the one test that proves the
    # backstop fires into a silent green — which is precisely the class of
    # failure #941 exists to end. If these ever must go, inline the sequences
    # here first (the plan's original shape) and delete this assert.
    assert runlog.exists(), (
        f"missing #941 acceptance evidence: {runlog}. The backstop threshold is "
        "calibrated against this run log — do not prune it without first "
        "inlining its ToolSearch sequence into this test."
    )
    fired_at, total_calls, mcp_calls = _replay(runlog)
    assert mcp_calls == 0, "this run's premise is that no genealogy call succeeded"
    assert fired_at == expected_call
    # The whole point is stopping early instead of burning 35 minutes.
    assert fired_at < total_calls / 3


def test_backstop_never_fires_on_the_healthy_run():
    """Same fixture, same night, verdict `pass` — must not be touched."""
    runlog = FERBER / HEALTHY_RUN
    # Hard failure for the same reason as above: this is the ONLY evidence that
    # the threshold cannot false-abort a working run. Losing it silently would
    # leave the false-positive side of the calibration unproven.
    assert runlog.exists(), (
        f"missing #941 control evidence: {runlog}. This is the only proof the "
        "backstop does not fire on a healthy run — do not prune it without "
        "first inlining its ToolSearch sequence into this test."
    )
    fired_at, _total_calls, mcp_calls = _replay(runlog)
    assert mcp_calls > 0
    assert fired_at is None


# Below the number of healthy runs committed when this was measured (138 of 142
# logs), with room for pruning. Its job is to stop the sweep from passing
# vacuously if the corpus is ever emptied or the field renamed.
_MIN_HEALTHY_RUNS = 100


def test_no_healthy_run_in_the_whole_corpus_false_aborts():
    """The false-abort margin, measured against every committed run, not one.

    Review of this branch raised the inverse hazard: a *healthy* session whose
    early ToolSearches miss (a mistyped or genuinely absent tool name) reaching
    the threshold before its first genealogy call, which aborts a good run AND
    writes no run log to diagnose from. It is a real shape, so it is gated
    rather than argued: fold every committed run log that made at least one
    `mcp__` call through the detector and require that none of them fires.

    Measured 2026-08-05 across 142 logs — 138 healthy — the worst healthy streak
    is 1 against a threshold of 3, and tightening the reset rule (see
    tool_search_miss_streak) did not move it. This is what keeps that true.
    """
    healthy = 0
    offenders = []
    for runlog in sorted(RUNLOG_ROOT.rglob("run-*.json")):
        if runlog.name.endswith((".ann.json", ".final-tree.gedcomx.json")):
            continue
        calls = json.loads(runlog.read_text(encoding="utf-8")).get("tool_calls")
        if not isinstance(calls, list):
            continue
        fired_at, _total, mcp_calls = _fold(calls)
        if mcp_calls == 0:
            continue  # a lost run — the arm above owns these
        healthy += 1
        if fired_at is not None:
            offenders.append(f"{runlog.parent.name}/{runlog.name} fired at {fired_at}")
    assert not offenders, "backstop would abort healthy runs: " + "; ".join(offenders)
    assert healthy >= _MIN_HEALTHY_RUNS, (
        f"only {healthy} healthy run logs found (expected >= {_MIN_HEALTHY_RUNS}); "
        "this sweep is the false-abort evidence, so verify the corpus rather "
        "than lowering the floor"
    )
