"""Tests for `make replay-sizes` (e2e/replay_sizes.py).

The harness's failure mode is not a crash — it is a reassuring 0%. A broken
rebase, a typo'd filter or a reconstruction that lost state all make both
builds answer the same way, so every guard here is pinned in the direction
that matters: it must refuse to report, not report zero. The other direction
too: drift in a tool's argument rules must NOT read as a broken harness.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from collections import Counter
from pathlib import Path

import pytest

from e2e import replay_sizes as rs

REPO = Path(__file__).resolve().parents[4]
REAL_ERROR_RUN = REPO / "eval/runlogs/e2e/cruz-corona-ancestry/run-2026-09-25_11-30-49.json"


# --- measurement -----------------------------------------------------------


def test_a_success_is_measured_as_the_json_of_the_content_list():
    """Pins the wrapper and separators the orchestrator used (near-tautological
    for a verbatim capture: the capture IS this serialization)."""
    content = [{"type": "text", "text": '{"ok":true,"count":0}'}]
    assert rs.measure(content, is_error=False) == len(json.dumps(content))
    # The escaped quotes are why a 1,010-char pad reads as +1,014.
    pad = ',"_pad":"' + "x" * 1000 + '"'
    assert rs.measure([{"type": "text", "text": "{}" + pad}], False) - rs.measure(
        [{"type": "text", "text": "{}"}], False
    ) == 1014


def test_an_error_is_measured_as_its_plain_text_on_a_real_capture():
    """The SDK hands the orchestrator a plain string on the error path; measuring
    an error as json.dumps of a wrapper inflates every error-message change."""
    call = json.loads(REAL_ERROR_RUN.read_text(encoding="utf-8"))["tool_calls"][97]
    assert call["is_error"] is True
    content = [{"type": "text", "text": call["response_summary"]}]
    assert rs.measure(content, is_error=True) == call["result_chars"]
    assert rs.measure(content, is_error=False) != call["result_chars"]


# --- error classes ---------------------------------------------------------


@pytest.mark.parametrize("text, cls", [
    ("research.json 'plans' is missing or not an array", "state"),
    ("research.json not found in projectPath", "state"),
    ("Person 'I1' not found in tree.gedcomx.json.", "state"),
    ('section "localities" is not one of: questions, plans', "argument"),
    ("'targetId' is not a supported filter for section 'plans'", "argument"),
    ("something else broke", "other"),
])
def test_errors_are_classified_so_only_state_errors_can_exit_3(text, cls):
    assert rs.classify_error(text) == cls


def test_non_empty_success_catches_empty_but_successful_answers():
    assert rs.non_empty_success("research_query", '{"ok":true,"count":3,"items":[]}')
    assert not rs.non_empty_success("research_query", '{"ok":true,"count":0,"items":[]}')
    assert rs.non_empty_success("person_warnings", '{"warningCount":0,"warnings":[]}')
    assert not rs.non_empty_success("person_warnings", "not json")


# --- item building -----------------------------------------------------------


def _call(tool, **kw):
    c = {"tool": f"mcp__genealogy__{tool}", "args": {"projectPath": "C:\\Temp\\x", "section": "plans"},
         "result_chars": 100, "is_error": False, "response_summary": '{"ok":true}'}
    c.update(kw)
    return c


def _items(tmp_path, calls, tools=rs.REPLAYABLE, tree=True, monkeypatch=None):
    slug = "fx"
    run_dir = tmp_path / "runlogs" / slug
    run_dir.mkdir(parents=True)
    run = run_dir / "run-2026-10-06_00-00-00.json"
    run.write_text("{}", encoding="utf-8")
    if tree:
        run.with_name("run-2026-10-06_00-00-00.final-tree.gedcomx.json").write_text(
            json.dumps({"persons": []}), encoding="utf-8")
    fixture = tmp_path / "tests" / slug
    fixture.mkdir(parents=True)
    (fixture / "starting-research.json").write_text(json.dumps({"plans": []}), encoding="utf-8")
    monkeypatch.setattr(rs, "E2E_TESTS", tmp_path / "tests")
    skipped, chars = Counter(), Counter()
    out = rs.build_items(run, {"tool_calls": calls}, set(tools), skipped, chars)
    return out, skipped


def test_cap_denials_are_skipped_by_text_and_by_the_stripped_fallback(tmp_path, monkeypatch):
    calls = [
        _call("research_query", is_error=True, result_chars=29,
              response_summary="tool_calls cap (300) exceeded"),
        _call("research_query", is_error=True, result_chars=29,
              response_summary="tool_calls cap (200) exceeded"),
        dict(_call("project_context", is_error=True, result_chars=29), response_summary=None),
        _call("research_query"),
    ]
    out, skipped = _items(tmp_path, calls, monkeypatch=monkeypatch)
    assert skipped[("research_query", "harness-denied")] == 2
    assert skipped[("project_context", "harness-denied")] == 1
    assert [i.index for i in out.items] == [3]


def test_non_replayable_calls_land_in_not_replayed_with_a_reason(tmp_path, monkeypatch):
    calls = [_call("wiki_search"), _call("research_append"), _call("sidecar_read"),
             {"tool": "ToolSearch", "args": {}}, _call("research_query")]
    out, skipped = _items(tmp_path, calls, monkeypatch=monkeypatch)
    assert skipped[("wiki_search", "not-on-local-allow-list")] == 1
    assert skipped[("research_append", "writer")] == 1
    assert skipped[("sidecar_read", "sidecar-not-committed")] == 1
    assert not any(t == "ToolSearch" for t, _ in skipped)  # not an MCP call
    assert len(out.items) == 1


def test_each_item_sees_the_state_as_of_its_call(tmp_path, monkeypatch):
    write = {"tool": "mcp__genealogy__research_append",
             "args": {"section": "questions", "op": "append", "entry": {"question": "q?"}},
             "response_summary": '{"ok":true,"entryId":"q_001"}', "result_chars": 30}
    calls = [_call("research_query", args={"section": "questions"}), write,
             _call("research_query", args={"section": "questions"})]
    out, _ = _items(tmp_path, calls, monkeypatch=monkeypatch)
    before, after = out.items
    assert not before.research.get("questions")
    assert [q["id"] for q in after.research["questions"]] == ["q_001"]


def test_tree_readers_without_a_tree_are_skipped_but_research_reads_run(tmp_path, monkeypatch):
    calls = [_call("person_warnings"), _call("research_query")]
    out, skipped = _items(tmp_path, calls, tree=False, monkeypatch=monkeypatch)
    assert skipped[("person_warnings", "no-tree")] == 1
    assert [i.tool for i in out.items] == ["research_query"]


# --- guards that must refuse to report ---------------------------------------


@pytest.mark.parametrize("text", [
    '{"ok":false,"reason":"no_project","message":"x"}',
    "projectPath is required",
    "projectPath does not exist: C:\\Temp\\x",
    "research.json not found in projectPath",
    "tree.gedcomx.json not found at /tmp/x",
    "replay-sizes: network blocked",
])
def test_a_broken_rebase_or_a_network_call_is_an_integrity_error(text):
    with pytest.raises(rs.IntegrityError):
        rs._check_answer(text, "here")


def _row(tool, base_err=False, base_text="{}", recorded_err=False):
    item = rs.Item("r", 0, tool, {}, {}, None, 10, recorded_err)
    return rs.Row(item, rs.Answer(10, base_err, base_text), rs.Answer(10, base_err, base_text))


def test_state_errors_over_the_margin_exit_3_but_argument_errors_never_do():
    state = [_row("research_query", True, "research.json 'plans' is missing or not an array")
             for _ in range(11)]
    with pytest.raises(rs.IntegrityError):
        rs.check_margins(rs.summarize(state))
    argument = [_row("research_query", True, 'section "localities" is not one of: a') for _ in range(11)]
    rs.check_margins(rs.summarize(argument))  # contract drift: printed, not fatal


def test_a_new_error_and_a_cured_one_are_not_netted_to_zero():
    rows = [_row("research_query", True, "Person 'I9' not found", recorded_err=False),
            _row("research_query", False, '{"ok":true}', recorded_err=True)]
    assert rs.summarize(rows)["research_query"].new_errors["state"] == 1


def test_main_refuses_a_typo_d_tool_filter_and_a_json_path_in_the_corpus(capsys):
    # Checked by message, not just the code: an empty filter would ALSO end in
    # "zero calls left to replay" (exit 2), which would hide a deleted guard.
    assert rs.main(["--tools", "reserch_query"]) == 2
    assert "matches no replayable tool" in capsys.readouterr().err
    assert rs.main(["--json", str(REPO / "eval/runlogs/e2e/x.json")]) == 2
    assert "corpus pollution" in capsys.readouterr().err


def test_main_refuses_a_build_without_build_info(tmp_path):
    assert rs.main(["--test", "spriggs-parents-1898", "--candidate-build", str(tmp_path)]) == 2


def _repo(tmp_path):
    """A two-commit repo: `old`, then `stamp`. Real git, independent of how deep
    this checkout's history is (CI clones shallow)."""
    def git(*args):
        return subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True,
                              text=True, encoding="utf-8").stdout.strip()
    git("init", "-q")
    shas = []
    for name in ("old", "stamp"):
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", name)
        shas.append(git("rev-parse", "HEAD"))
    return shas


def test_a_base_older_than_the_build_stamp_is_refused(tmp_path):
    old, stamp = _repo(tmp_path)
    with pytest.raises(rs.UsageError, match="predates"):
        rs.check_base_supported(old, repo=tmp_path, stamp=stamp)
    rs.check_base_supported(stamp, repo=tmp_path, stamp=stamp)  # the stamp itself is supported


def test_a_clone_without_the_stamp_says_shallow_not_predates(tmp_path):
    _, head = _repo(tmp_path)
    with pytest.raises(rs.UsageError, match="shallow"):
        rs.check_base_supported(head, repo=tmp_path, stamp="e8607990d")


def test_zero_items_after_skips_is_a_usage_error(monkeypatch):
    monkeypatch.setattr(rs, "select_runs", lambda test, tracked: ([(Path("x"), {"tool_calls": []})], 0))
    monkeypatch.setattr(rs, "build_version", lambda b: "v")
    assert rs.main(["--base-build", "/tmp", "--candidate-build", "/tmp"]) == 2


# --- end to end against the real compiled engine -------------------------------


@pytest.mark.requires_engine_build
def test_an_unchanged_build_replays_to_exactly_zero_with_real_answers(capsys):
    build = REPO / "packages/engine/mcp-server/build"
    code = rs.main(["--test", "spriggs-parents-1898", "--tracked-only", "--tools", "research_query",
                    "--base-build", str(build), "--candidate-build", str(build)])
    out = capsys.readouterr().out
    assert code == 0, out
    row = next(line for line in out.splitlines() if line.startswith("research_query "))
    assert "+0 " in row
    stats_row = next(line for line in out.splitlines() if line.strip().startswith("research_query")
                     and "/" in line)
    non_empty = int(stats_row.split()[2].replace(",", ""))
    assert non_empty > 0  # real, non-empty answers — not a replay of empties
