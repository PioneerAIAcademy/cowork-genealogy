"""Tests for `make replay-collapse` (e2e/replay_collapse.py).

The comparator's failure mode is "nothing equals nothing": a wrong notebook in
the project dir makes the walk AND the replacement come back empty. So the stub
tool server here reads the `research.json` the comparator actually placed —
never the test's own copy — and every guard is pinned in the direction that
matters: it must refuse, not pass.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from e2e import replay_collapse as rc
from e2e.replay_sizes import IntegrityError

STATE = {
    "plans": [
        {"id": "pl_001", "question_id": "q_001", "items": [{"id": "pli_001"}, {"id": "pli_002"}]},
        {"id": "pl_002", "question_id": "q_002", "items": [{"id": "pli_003"}]},
    ],
    "log": [
        {"id": "log_001", "plan_item_id": "pli_001", "tool": "record_search"},
        {"id": "log_002", "plan_item_id": "pli_002", "tool": "wiki_read"},
        {"id": "log_003", "plan_item_id": "pli_003", "tool": "record_read"},
    ],
}


def _walk(item, count, agent="ag1", **kw):
    call = {
        "tool": "mcp__genealogy__research_query", "agent_id": agent,
        "agent_type": "research-exhaustiveness",
        "args": {"projectPath": "C:\\x", "section": "log", "planItemId": item},
        "is_error": False, "result_chars": 100,
        "response_summary": f'[{{"ok": true, "section": "log", "count": {count}, "items": []}}]',
    }
    call.update(kw)
    return call


def _writer():
    return {"tool": "mcp__genealogy__research_log_append", "args": {},
            "response_summary": '{"ok": true, "logId": "log_009"}', "result_chars": 30}


# --- grouping (pure) ----------------------------------------------------------


def test_consecutive_walk_calls_for_one_question_form_one_group():
    groups, listed = rc.find_walk_groups([_walk("pli_001", 1), _walk("pli_002", 1)], STATE)
    assert [(g.question, [c.plan_item for c in g.calls]) for g in groups] == [("q_001", ["pli_001", "pli_002"])]
    assert listed == []


def test_a_writer_between_walk_calls_splits_them():
    groups, listed = rc.find_walk_groups([_walk("pli_001", 1), _writer(), _walk("pli_002", 1)], STATE)
    assert groups == []
    assert [r for _, _, r in listed] == ["singleton", "singleton"]


def test_calls_in_two_threads_never_share_a_group():
    groups, _ = rc.find_walk_groups([_walk("pli_001", 1, "a"), _walk("pli_002", 1, "b")], STATE)
    assert groups == []


def test_items_of_two_questions_split_at_the_boundary():
    calls = [_walk("pli_001", 1), _walk("pli_002", 1), _walk("pli_003", 1)]
    groups, listed = rc.find_walk_groups(calls, STATE)
    assert [g.question for g in groups] == ["q_001"]
    assert [r for _, _, r in listed] == ["singleton"]


def test_excluded_calls_are_listed_with_their_reason_and_unowned_closes_the_group():
    calls = [
        _walk("pli_001", 1, args={"projectPath": "x", "section": "log", "planItemId": "pli_001", "offset": 50}),
        _walk("pli_001", 1, is_error=True),
        _walk("pli_001", 1, is_error=True, result_chars=29, response_summary="tool_calls cap (300) exceeded"),
        _walk("pli_001", 1), _walk("pli_999", 0), _walk("pli_002", 1),
    ]
    groups, listed = rc.find_walk_groups(calls, STATE)
    assert groups == []  # the unowned item split pli_001 from pli_002
    assert [r for _, _, r in listed] == [
        "extra-args", "recorded-error", "harness-denied", "unowned-item", "singleton", "singleton",
    ]


def test_a_non_writer_read_between_walk_calls_does_not_break_the_group():
    read = {"tool": "mcp__genealogy__wiki_read", "args": {}, "result_chars": 10}
    groups, _ = rc.find_walk_groups([_walk("pli_001", 1), read, _walk("pli_002", 1)], STATE)
    assert len(groups) == 1


def test_main_thread_calls_without_agent_id_group_together():
    groups, _ = rc.find_walk_groups([_walk("pli_001", 1, None), _walk("pli_002", 1, None)], STATE)
    assert groups[0].thread == "main"


@pytest.mark.parametrize("summary, expected", [
    ('[{"ok": true, "section": "log", "count": 9, "items": []}]', 9),
    ('[{"type": "text", "text": "{\\"ok\\":true,\\"section\\":\\"log\\",\\"count\\":0}"}]', 0),
    ('{"ok": true}', None),
    (None, None),
])
def test_the_recorded_count_is_read_from_both_summary_shapes(summary, expected):
    assert rc.recorded_count(summary) == expected


def test_ownership_that_disagrees_with_the_final_notes_is_an_integrity_error():
    groups, _ = rc.find_walk_groups([_walk("pli_001", 1), _walk("pli_002", 1)], STATE)
    final = {"plans": [{"question_id": "q_002", "items": [{"id": "pli_001"}]}]}
    with pytest.raises(IntegrityError, match="final-research"):
        rc.check_ownership(groups, final)
    rc.check_ownership(groups, STATE)  # agreeing final notes pass


# --- replaying a group against stub servers -------------------------------------


class Stub:
    """A research_query server that reads the research.json the comparator placed."""

    def __init__(self, label, project, mode="ok"):
        self.label, self.project, self.mode = label, project, mode

    async def call(self, tool, args, where):
        research = json.loads((self.project / "research.json").read_text(encoding="utf-8"))
        log = research.get("log") or []
        if "planItemId" in args:
            items = [e for e in log if e.get("plan_item_id") == args["planItemId"]]
        else:
            if self.mode == "reject":
                return [{"type": "text", "text": '{"ok":false,"errors":["\'questionId\' is not a supported filter"]}'}], True
            owned = {i["id"] for p in research.get("plans") or [] if p.get("question_id") == args["questionId"]
                     for i in p.get("items") or []}
            items = [e for e in log if e.get("plan_item_id") in owned]
            if self.mode == "drop-one":
                items = items[1:]
            if self.mode == "whole-log":
                items = list(log)
            if self.mode == "edit":
                items = [dict(e, tool="changed") for e in items]
        offset = args.get("offset", 0)
        page = items[offset:offset + 1] if self.mode == "tiny-pages" else items[offset:offset + 50]
        count = len(items) if self.mode != "drop-one" else len(items) + 1
        body = {"ok": True, "section": "log", "count": count, "items": page,
                "truncated": offset + len(page) < len(items)}
        if self.mode == "duplicate" and "questionId" in args:
            body["items"] = page + page[:1]
        return [{"type": "text", "text": json.dumps(body)}], False


def _group():
    groups, _ = rc.find_walk_groups([_walk("pli_001", 1), _walk("pli_002", 1)], STATE)
    return groups[0]


def _run(tmp_path, mode="ok", group=None, base_mode="reject"):
    project = tmp_path / "proj"
    project.mkdir(exist_ok=True)
    return asyncio.run(rc.evaluate_group(
        group or _group(), Stub("base", project, base_mode), Stub("candidate", project, mode), project, {}
    ))


def test_a_correct_replacement_collapses_the_walk(tmp_path):
    out = _run(tmp_path)
    assert out.status == "collapsed"
    assert (out.walk_calls, out.replacement_calls, out.entries_returned) == (2, 1, 2)
    assert out.base_accepts is False


def test_a_replacement_needing_several_pages_still_collapses(tmp_path):
    assert _run(tmp_path, mode="tiny-pages").status == "collapsed"


def test_a_base_that_accepts_the_replacement_is_not_an_error(tmp_path):
    out = _run(tmp_path, base_mode="ok")
    assert out.status == "collapsed" and out.base_accepts is True


@pytest.mark.parametrize("mode", ["drop-one", "whole-log", "edit", "duplicate"])
def test_a_wrong_replacement_is_an_integrity_error(tmp_path, mode):
    with pytest.raises(IntegrityError):
        _run(tmp_path, mode=mode)


def test_the_wrong_notebook_in_the_project_dir_is_caught_by_the_walk_counts(tmp_path):
    """The group's state replaced by the starting state: every walk now answers
    0 where the run recorded 1 — exit 3, never 'nothing equals nothing'."""
    g = _group()
    g.state = {"plans": STATE["plans"], "log": []}
    with pytest.raises(IntegrityError, match="recorded"):
        _run(tmp_path, group=g)


def test_a_candidate_without_the_filter_is_rejected_not_passed(tmp_path):
    assert _run(tmp_path, mode="reject").status == "rejected"


def test_a_walk_without_a_recorded_count_is_unverifiable(tmp_path):
    g = _group()
    g.calls[0].recorded_count = None
    assert _run(tmp_path, group=g).status == "unverifiable"


def test_an_empty_walk_is_not_a_collapse(tmp_path):
    g = _group()
    g.state = {"plans": STATE["plans"], "log": []}
    for c in g.calls:
        c.recorded_count = 0
    assert _run(tmp_path, group=g).status == "empty-walk"


# --- exit codes ---------------------------------------------------------------------


def _outcome(status):
    return rc.Outcome(_group(), status)


def test_exit_codes_and_their_precedence():
    assert rc.exit_code([_outcome("collapsed")]) == 0
    assert rc.exit_code([_outcome("collapsed"), _outcome("rejected")]) == 1
    assert rc.exit_code([_outcome("empty-walk")]) == 2
    assert rc.exit_code([_outcome("unverifiable"), _outcome("unverifiable")]) == 2
    # Integrity (3) raises before exit_code runs, so it outranks both.


def test_no_walk_groups_in_the_selection_is_a_usage_error(monkeypatch):
    monkeypatch.setattr(rc, "select_runs", lambda t, tr: ([(Path("x"), {"tool_calls": []})], 0))
    assert rc.main(["--base-build", "/tmp", "--candidate-build", "/tmp"]) == 2


@pytest.mark.requires_engine_build
def test_the_real_engine_collapses_one_fixtures_walks(capsys):
    build = Path(__file__).resolve().parents[4] / "packages/engine/mcp-server/build"
    code = rc.main(["--test", "anders-monsen-ancestry", "--tracked-only",
                    "--base-build", str(build), "--candidate-build", str(build)])
    out = capsys.readouterr().out
    assert code == 0, out
    assert "collapsed" in out
