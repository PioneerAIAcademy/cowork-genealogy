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
import re
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
    assert rc.main(["--rule", "plan-log", "--base-build", "/tmp", "--candidate-build", "/tmp"]) == 2


@pytest.mark.requires_engine_build
def test_the_real_engine_collapses_one_fixtures_walks(capsys):
    build = Path(__file__).resolve().parents[4] / "packages/engine/mcp-server/build"
    code = rc.main(["--rule", "plan-log", "--test", "anders-monsen-ancestry", "--tracked-only",
                    "--base-build", str(build), "--candidate-build", str(build)])
    out = capsys.readouterr().out
    assert code == 0, out
    assert "collapsed" in out


# ==========================================================================
# Rule plural-id (T2.3)
# ==========================================================================

P_STATE = {
    "sources": [{"id": "src_001"}, {"id": "src_002"}, {"id": "src_003"}],
    "assertions": [
        {"id": "a_1", "record_id": "R1", "record_role": "principal", "source_id": "src_001"},
        {"id": "a_2", "record_id": "R2", "record_role": "principal", "source_id": "src_002"},
        {"id": "a_3", "record_id": "R1", "record_role": "child", "source_id": "src_001"},
    ],
    # Interleaved: document order is not "all of I1, then all of I2".
    "person_evidence": [
        {"id": "pe_1", "person_id": "I1", "assertion_id": "a_1"},
        {"id": "pe_2", "person_id": "I2", "assertion_id": "a_2"},
        {"id": "pe_3", "person_id": "I1", "assertion_id": "a_3"},
    ],
}

#: The stub's own filter table. A test stub may restate the tool; the
#: comparator may not, which is why its truth is the base build's answers.
FIELDS = {
    ("person_evidence", "personId"): "person_id",
    ("person_evidence", "assertionId"): "assertion_id",
    ("assertions", "recordId"): "record_id",
    ("assertions", "sourceId"): "source_id",
    ("assertions", "recordRole"): "record_role",
    ("sources", "sourceId"): "id",
}


def _q(section, key, value, count, agent="pe1", **extra):
    args = {"projectPath": "C:\\x", "section": section, key: value, **extra}
    return {
        "tool": "mcp__genealogy__research_query", "agent_id": agent, "agent_type": "person-evidence",
        "args": args, "is_error": False, "result_chars": 100,
        "response_summary": f'[{{"ok": true, "section": "{section}", "count": {count}, "items": []}}]',
    }


class PluralStub:
    """research_query over the research.json the comparator placed, with lists.

    `mode` plants one defect in the LIST answer (singular answers stay right),
    except `singular-differs`, which breaks the singular answer itself, and
    `singular-content-differs`, which keeps its count but changes one item."""

    def __init__(self, label, project, mode="ok"):
        self.label, self.project, self.mode = label, project, mode

    async def call(self, tool, args, where):
        research = json.loads((self.project / "research.json").read_text(encoding="utf-8"))
        section = args["section"]
        items = research.get(section) or []
        listed = None
        for key, value in args.items():
            if key in ("projectPath", "section", "offset"):
                continue
            field_ = FIELDS[(section, key)]
            values = value if isinstance(value, list) else [value]
            if isinstance(value, list):
                listed = (field_, value)
            items = [e for e in items if e.get(field_) in values]
        is_list = listed is not None
        if is_list and self.mode == "today":
            return [{"type": "text", "text": json.dumps(
                {"ok": True, "section": section, "count": 0, "items": [], "truncated": False})}], False
        if is_list and self.mode == "drop-second":
            items = [e for e in items if e.get(listed[0]) != listed[1][1]]
        if not is_list and self.mode == "singular-differs" and args.get("offset") is None:
            items = items[:-1]
        if not is_list and self.mode == "singular-content-differs" and items:
            items = items[:-1] + [dict(items[-1], rationale="changed")]
        offset = args.get("offset", 0)
        size = 1 if self.mode == "tiny-pages" else 50
        page = items[offset:offset + size]
        if is_list and self.mode == "repeat-page1":
            page = items[:size]
        body = {"ok": True, "section": section, "count": len(items), "items": page,
                "truncated": offset + len(page) < len(items) or (is_list and self.mode == "repeat-page1")}
        if is_list and self.mode == "duplicate":
            body["items"] = page + page[:1]
        if is_list and self.mode != "no-count-by-id":
            counts = {i: sum(1 for e in items if e.get(listed[0]) == i) for i in dict.fromkeys(listed[1])}
            if self.mode == "count-by-id-off":
                counts[next(iter(counts))] += 1
            if self.mode == "count-by-id-missing":
                counts.pop(next(iter(counts)))
            body["countById"] = counts
        return [{"type": "text", "text": json.dumps(body)}], False


def _pgroups(calls, state=P_STATE, run="fx/run-1"):
    return rc.find_plural_groups(calls, state, run)


def _person_group(counts=(2, 1)):
    groups, _ = _pgroups([_q("person_evidence", "personId", "I1", counts[0]),
                          _q("person_evidence", "personId", "I2", counts[1])])
    return groups[0]


def _prun(tmp_path, group, mode="ok", base_mode="ok"):
    project = tmp_path / "proj"
    project.mkdir(exist_ok=True)
    return asyncio.run(rc.evaluate_plural_group(
        group, PluralStub("base", project, base_mode), PluralStub("candidate", project, mode), project, {}
    ))


# --- grouping (pure) --------------------------------------------------------------


def test_adjacent_one_id_calls_form_one_group_in_first_seen_order():
    calls = [_q("person_evidence", "personId", x, 1) for x in ("I2", "I1", "I2")]
    groups, listed = _pgroups(calls)
    assert [(g.section, g.key, g.ids, len(g.calls)) for g in groups] == [
        ("person_evidence", "personId", ["I2", "I1"], 3)]
    assert listed == []


def test_a_same_thread_call_between_them_breaks_the_group():
    read = {"tool": "mcp__genealogy__wiki_read", "agent_id": "pe1", "args": {}, "result_chars": 10}
    groups, listed = _pgroups([_q("person_evidence", "personId", "I1", 2), read,
                               _q("person_evidence", "personId", "I2", 1)])
    assert groups == []
    assert [r for _, _, r in listed] == ["singleton", "singleton"]


def test_a_writer_in_another_thread_splits_the_group():
    writer = dict(_writer(), agent_id="other")
    groups, _ = _pgroups([_q("person_evidence", "personId", "I1", 2), writer,
                          _q("person_evidence", "personId", "I2", 1)])
    assert groups == []


def test_a_read_in_another_thread_does_not_break_it_and_interleaved_threads_make_two_groups():
    read = {"tool": "mcp__genealogy__wiki_read", "agent_id": "elsewhere", "args": {}, "result_chars": 10}
    calls = [_q("person_evidence", "personId", "I1", 2, "a"), read, _q("sources", "sourceId", "src_001", 1, "b"),
             _q("person_evidence", "personId", "I2", 1, "a"), _q("sources", "sourceId", "src_002", 1, "b")]
    groups, _ = _pgroups(calls)
    assert sorted((g.thread, g.ids) for g in groups) == [("a", ["I1", "I2"]), ("b", ["src_001", "src_002"])]


def test_a_varying_section_or_key_never_groups():
    groups, _ = _pgroups([_q("assertions", "sourceId", "src_001", 2), _q("sources", "sourceId", "src_002", 1)])
    assert groups == []
    groups, _ = _pgroups([_q("person_evidence", "personId", "I1", 2),
                          _q("person_evidence", "assertionId", "a_2", 1)])
    assert groups == []


def test_two_varying_keys_never_group():
    calls = [_q("assertions", "recordId", "R1", 1, recordRole="principal"),
             _q("assertions", "recordId", "R2", 1, recordRole="child")]
    groups, _ = _pgroups(calls)
    assert groups == []


def test_plan_item_walks_stay_in_the_plan_log_rule():
    groups, listed = _pgroups([_walk("pli_001", 1), _walk("pli_002", 1)], STATE)
    assert groups == [] and listed == []


def test_offsets_errors_denials_and_extra_args_are_listed_with_their_reason():
    calls = [
        _q("person_evidence", "personId", "I1", 2, offset=50),
        dict(_q("person_evidence", "personId", "I1", 2), is_error=True),
        dict(_q("person_evidence", "personId", "I1", 2), is_error=True, result_chars=29,
             response_summary="tool_calls cap (300) exceeded"),
        _q("person_evidence", "personId", "I1", 2, assertionId="a_1"),
        _q("person_evidence", "personId", ["I1", "I2"], 3),
    ]
    groups, listed = _pgroups(calls)
    assert groups == []
    assert [r for _, _, r in listed] == [
        "offset", "recorded-error", "harness-denied", "extra-args", "non-string-value"]


def test_a_fixed_record_role_is_carried_into_the_list_call(tmp_path):
    calls = [_q("assertions", "recordId", "R1", 1, recordRole="principal"),
             _q("assertions", "recordId", "R2", 1, recordRole="principal")]
    groups, _ = _pgroups(calls)
    assert groups[0].fixed == {"recordRole": "principal"}
    out = _prun(tmp_path, groups[0])
    assert (out.status, out.walk_calls, out.plural_calls) == ("collapsed", 2, 1)


# --- breaks: each must fail, and say so ---------------------------------------------


def _report(out):
    return rc.render_plural([], [out], [], 0, 1)


def test_today_s_engine_answers_a_list_count_0_and_is_wrong(tmp_path):
    out = _prun(tmp_path, _person_group(), mode="today", base_mode="today")
    assert out.status == "wrong"
    assert "count 0 != truth 3" in out.reason and "countById None" in out.reason
    assert rc.exit_code_plural([out]) == 1
    text = _report(out)
    assert "wrong: fx/run-1#0 person_evidence × personId — p1: count 0 != truth 3" in text
    assert "base build answers the list correctly on 0 of 1 groups" in text


@pytest.mark.parametrize("mode, says", [
    ("drop-second", "items ['pe_1', 'pe_3'] != truth ['pe_1', 'pe_2', 'pe_3']"),
    ("duplicate", "an item appears twice across the pages"),
    ("count-by-id-off", "countById {'I1': 3, 'I2': 1} != {'I1': 2, 'I2': 1}"),
    ("count-by-id-missing", "countById {'I2': 1} != {'I1': 2, 'I2': 1}"),
])
def test_a_wrong_list_answer_is_wrong_and_names_the_defect(tmp_path, mode, says):
    out = _prun(tmp_path, _person_group(), mode=mode)
    assert out.status == "wrong", out
    assert says in out.reason
    assert rc.exit_code_plural([out]) == 1
    assert f"wrong: fx/run-1#0 person_evidence × personId — " in _report(out)


def test_an_empty_walk_answered_without_count_by_id_is_wrong(tmp_path):
    groups, _ = _pgroups([_q("person_evidence", "personId", "I8", 0),
                          _q("person_evidence", "personId", "I9", 0)])
    out = _prun(tmp_path, groups[0], mode="no-count-by-id")
    assert out.status == "wrong"
    assert "countById None != {'I8': 0, 'I9': 0}" in out.reason


def test_a_list_page_over_the_spill_size_is_spill(tmp_path):
    # Right answers, big items: each singular page is under 50,000 chars, the
    # one list page holding all three is over it.
    big = {**P_STATE, "person_evidence": [dict(e, rationale="x" * 17_000) for e in P_STATE["person_evidence"]]}
    groups, _ = _pgroups([_q("person_evidence", "personId", "I1", 2),
                          _q("person_evidence", "personId", "I2", 1)], big)
    out = _prun(tmp_path, groups[0])
    assert out.status == "spill"
    assert out.largest_page > rc.SPILL_CHARS
    assert "over the 50,000 spill" in out.reason
    assert rc.exit_code_plural([out]) == 1
    assert "spill: fx/run-1#0" in _report(out)


def test_base_and_candidate_disagreeing_on_a_singular_answer_is_an_integrity_error(tmp_path):
    with pytest.raises(IntegrityError, match="base count 2 != candidate 1"):
        _prun(tmp_path, _person_group(), mode="singular-differs")


def test_base_and_candidate_disagreeing_on_a_singular_page_is_an_integrity_error(tmp_path):
    """Counts agree, so the count gate passes; only the page content differs."""
    with pytest.raises(IntegrityError, match="the singular answer differs between builds"):
        _prun(tmp_path, _person_group(), mode="singular-content-differs")


def test_the_spill_boundary_is_strictly_over_the_cap(tmp_path, monkeypatch):
    """A page exactly at the cap is not a spill; one char over it is."""
    big = {**P_STATE, "person_evidence": [dict(e, rationale="x" * 17_000) for e in P_STATE["person_evidence"]]}
    groups, _ = _pgroups([_q("person_evidence", "personId", "I1", 2),
                          _q("person_evidence", "personId", "I2", 1)], big)
    size = _prun(tmp_path, groups[0]).largest_page
    monkeypatch.setattr(rc, "SPILL_CHARS", size)
    assert _prun(tmp_path, groups[0]).status == "collapsed"
    monkeypatch.setattr(rc, "SPILL_CHARS", size - 1)
    assert _prun(tmp_path, groups[0]).status == "spill"


def test_a_pager_that_repeats_page_one_hits_the_cap(tmp_path):
    with pytest.raises(IntegrityError, match="list paging passed"):
        _prun(tmp_path, _person_group(), mode="repeat-page1")


def _unfaithful(tmp_path, run, state, final, calls):
    groups, _ = _pgroups(calls, state, run)
    g = groups[0]
    g.final = final
    return _prun(tmp_path, g)


def test_a_ledger_gap_outside_the_known_set_is_exit_3(tmp_path):
    state = {**P_STATE, "person_evidence": P_STATE["person_evidence"][:2]}  # pe_3 never replayed
    calls = [_q("person_evidence", "personId", "I1", 2), _q("person_evidence", "personId", "I2", 1)]
    out = _unfaithful(tmp_path, "fx/run-1", state, P_STATE, calls)
    assert (out.status, out.cause, out.fatal) == ("unfaithful", "ledger-missing-writes", True)
    assert rc.exit_code_plural([out]) == 3
    text = _report(out)
    assert "unfaithful: ledger-missing-writes 1" in text
    assert "diagnose the capture before adding it to KNOWN_LEDGER_GAPS" in text


def test_a_known_ledger_gap_is_counted_not_fatal(tmp_path):
    run, index = sorted(rc.KNOWN_LEDGER_GAPS)[0]
    state = {**P_STATE, "person_evidence": P_STATE["person_evidence"][:2]}
    filler = [{"tool": "mcp__genealogy__wiki_read", "agent_id": "x", "args": {}, "result_chars": 1}] * index
    calls = filler + [_q("person_evidence", "personId", "I1", 2), _q("person_evidence", "personId", "I2", 1)]
    out = _unfaithful(tmp_path, run, state, P_STATE, calls)
    assert (out.cause, out.fatal) == ("ledger-missing-writes", False)


def test_an_unclassifiable_unfaithful_group_is_exit_3(tmp_path):
    calls = [_q("person_evidence", "personId", "I1", 7), _q("person_evidence", "personId", "I2", 1)]
    out = _unfaithful(tmp_path, "fx/run-1", P_STATE, P_STATE, calls)
    assert (out.status, out.cause) == ("unfaithful", "unclassified")
    assert rc.exit_code_plural([out]) == 3
    assert "unfaithful (unclassified): fx/run-1#0" in _report(out)


# --- must pass ------------------------------------------------------------------------


def test_a_correct_list_collapses_the_walk_in_document_order(tmp_path):
    out = _prun(tmp_path, _person_group())
    assert (out.status, out.walk_calls, out.plural_calls, out.base_correct) == ("collapsed", 2, 1, True)
    assert rc.exit_code_plural([out]) == 0


def test_duplicate_ids_still_collapse(tmp_path):
    groups, _ = _pgroups([_q("person_evidence", "personId", x, n) for x, n in (("I1", 2), ("I2", 1), ("I1", 2))])
    assert groups[0].ids == ["I1", "I2"]
    out = _prun(tmp_path, groups[0])
    assert (out.status, out.walk_calls, out.plural_calls) == ("collapsed", 3, 1)


def test_one_item_pages_still_collapse(tmp_path):
    groups, _ = _pgroups([_q("sources", "sourceId", "src_001", 1), _q("sources", "sourceId", "src_002", 1)])
    out = _prun(tmp_path, groups[0], mode="tiny-pages", base_mode="tiny-pages")
    assert (out.status, out.walk_calls, out.plural_calls) == ("collapsed", 2, 2)


def test_an_empty_walk_answered_right_is_collapsed_empty(tmp_path):
    groups, _ = _pgroups([_q("sources", "sourceId", "src_8", 0), _q("sources", "sourceId", "src_9", 0)])
    out = _prun(tmp_path, groups[0])
    assert out.status == "collapsed-empty"
    assert rc.exit_code_plural([out]) == 2  # nothing non-empty collapsed


def test_a_pre_change_base_is_reported_not_failed(tmp_path):
    out = _prun(tmp_path, _person_group(), base_mode="today")
    assert (out.status, out.base_correct) == ("collapsed", False)


def test_a_source_id_unstamped_group_is_counted_and_passes(tmp_path):
    unstamped = [dict(a, source_id=None) if a["id"] == "a_3" else a for a in P_STATE["assertions"]]
    calls = [_q("assertions", "sourceId", "src_001", 2), _q("assertions", "sourceId", "src_002", 1)]
    out = _unfaithful(tmp_path, "fx/run-1", {**P_STATE, "assertions": unstamped}, P_STATE, calls)
    assert (out.status, out.cause, out.fatal) == ("unfaithful", "source-id-unstamped", False)
    ok = _prun(tmp_path, _person_group())
    assert rc.exit_code_plural([ok, out]) == 0
    assert "unfaithful: source-id-unstamped 1" in rc.render_plural([], [ok, out], [], 0, 1)


def test_turns_come_from_aligned_message_ids_and_are_unknown_otherwise(tmp_path):
    calls = [_q("person_evidence", "personId", "I1", 2), _q("person_evidence", "personId", "I2", 1)]
    log = {"tool_calls": calls, "usage": {"timeline": [
        [1.0, "assistant", ["mcp__genealogy__research_query"], "t", "msg_a"],
        [1.1, "tool_result", ["mcp__genealogy__research_query"], "t", None],
        [2.0, "assistant", ["mcp__genealogy__research_query"], "t", "msg_b"],
    ]}}
    ids = rc.message_ids(log)
    assert ids == ["msg_a", "msg_b"]
    groups, _ = rc.find_plural_groups(calls, P_STATE, "fx/run-1", ids)
    out = _prun(tmp_path, groups[0])
    assert out.recorded_turns == 2
    assert "turns removed:   1 (over 1 of 1 groups; runs with message ids: 1 of 1)" in rc.render_plural(
        [], [out], [], 1, 1)
    unaligned = {"tool_calls": calls, "usage": {"timeline": log["usage"]["timeline"][:1]}}
    assert rc.message_ids(unaligned) is None
    renamed = {"tool_calls": calls, "usage": {"timeline": [
        [1.0, "assistant", ["wiki_read"], "t", "m"], [2.0, "assistant", ["research_query"], "t", "n"]]}}
    assert rc.message_ids(renamed) is None
    g2, _ = rc.find_plural_groups(calls, P_STATE, "fx/run-1", None)
    assert _prun(tmp_path, g2[0]).recorded_turns is None


def test_exit_codes_aggregate_across_rules():
    assert rc.aggregate_exit([0, 2]) == 0
    assert rc.aggregate_exit([2, 2]) == 2
    assert rc.aggregate_exit([0, 1]) == 1
    assert rc.aggregate_exit([1, 3]) == 3


def test_the_plan_log_rule_alone_still_reports_no_walk_groups_as_usage(monkeypatch):
    monkeypatch.setattr(rc, "select_runs", lambda t, tr: ([(Path("x"), {"tool_calls": []})], 0))
    assert rc.main(["--rule", "plan-log", "--base-build", "/tmp", "--candidate-build", "/tmp"]) == 2
    assert rc.main(["--rule", "plural-id", "--base-build", "/tmp", "--candidate-build", "/tmp"]) == 2


@pytest.mark.requires_engine_build
def test_the_real_engine_collapses_plural_walks(capsys):
    """Lower bounds pinned on 395f56677's dry run (5 tracked anders runs): runs
    only accrue, so the figures may grow. At a9d57123d (6 runs) they read
    collapsed 11 (26 -> 11), collapsed-empty 16 (40 -> 16), unfaithful 1. A new
    anders run with a LEDGER gap fails here on purpose: that is a capture
    regression to diagnose, not a figure to re-pin."""
    build = Path(__file__).resolve().parents[4] / "packages/engine/mcp-server/build"
    code = rc.main(["--rule", "plural-id", "--test", "anders-monsen-ancestry", "--tracked-only",
                    "--base-build", str(build), "--candidate-build", str(build)])
    out = capsys.readouterr().out
    assert code == 0, out
    statuses = dict(re.findall(r"(collapsed-empty|collapsed|unfaithful|wrong|spill) (\d+)",
                               re.search(r"groups found: .*", out).group(0)))
    assert int(statuses.get("collapsed", 0)) >= 8, out
    assert int(statuses.get("collapsed-empty", 0)) >= 14, out
    assert "wrong" not in statuses and "spill" not in statuses, out
    n, m = map(int, re.search(r"total: +N -> M = (\d+) -> (\d+)", out).groups())
    assert n >= 54 and m < n, out
    assert re.search(r"unfaithful: (?:.*, )?source-id-unstamped [1-9]\d*", out), out
    assert "ledger-missing-writes" not in out, out
    assert re.search(r"calls removed: +\d+", out) and re.search(r"turns removed: +-?\d+", out), out
