"""`dev/carry_cost.py` (#3512): the carry figure on synthetic bundles worked by hand.

Every call is claude-sonnet-4-6: $3 per million input tokens, $3.75 cache write, $0.30 cache
read, $15 output. The worked session's baseline is 40,000 tokens, so a 5,000-token seed makes
the fresh start 45,000."""
from __future__ import annotations

import itertools
import json
from datetime import datetime, timedelta, timezone

import pytest

from dev import carry_cost

_T0 = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)
_ids = itertools.count()


def _row(sid: str, minute: float, **fields) -> dict:
    return {"uuid": f"r{next(_ids)}", "parentUuid": "prev", "sessionId": sid,
            "timestamp": (_T0 + timedelta(minutes=minute)).isoformat().replace("+00:00", "Z"),
            **fields}


def person(sid, minute, text, **fields):
    return _row(sid, minute, type="user", message={"role": "user", "content": text},
                **{"promptSource": "sdk", **fields})


def tool_result(sid, minute):
    return _row(sid, minute, type="user", message={"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t", "content": "ok"}]})


def compaction(sid, minute):
    return _row(sid, minute, type="user", isCompactSummary=True, message={
        "role": "user", "content": "This session is being continued from a previous conversation."})


def call(sid, minute, mid, *, cw=0, cr=0, inp=0, out=10, text="", model="claude-sonnet-4-6", **fields):
    content = [{"type": "text", "text": text}] if text else [{"type": "tool_use", "id": "t", "name": "x", "input": {}}]
    return _row(sid, minute, type="assistant", message={
        "id": mid, "model": model, "content": content,
        "usage": {"input_tokens": inp, "cache_creation_input_tokens": cw,
                  "cache_read_input_tokens": cr, "output_tokens": out}}, **fields)


def bundle(root, name, project, logs, subagents=None, **meta):
    """Write one bundle: `logs` maps a path under `_feedback/` to its rows."""
    fb = root / name / "_feedback"
    fb.mkdir(parents=True)
    (fb / "feedback.json").write_text(json.dumps({"project_folder_path": project, **meta}), encoding="utf-8")
    for rel, rows in {**logs, **{f"subagents/{k}": v for k, v in (subagents or {}).items()}}.items():
        path = fb / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return name, root / name


def _worked_rows():
    s = "s-worked"
    opener = person(s, 0, "Start a new research project.")
    opener["parentUuid"] = None
    return [
        opener,
        call(s, 1, "m1", cw=40_000, out=100),                       # baseline 40,000
        tool_result(s, 2),
        call(s, 3, "m1b", cw=0, cr=40_000, out=5),                  # one message, two entries,
        tool_result(s, 4),                                          # split by a tool result:
        call(s, 5, "m1b", cw=0, cr=40_000, out=50),                 # the last one is priced
        person(s, 10, "Look for his parents."),                     # message 2
        call(s, 11, "m3", cw=60_000),                               # first call: excess 15,000
        call(s, 12, "m4", cw=2_000, cr=60_000),
        compaction(s, 13),                                          # carry stops here
        call(s, 14, "m5", cw=30_000),
        call(s, 15, "m6", cw=100, cr=30_000, text="Found it.\nNext: search records. Continue?"),
        person(s, 16, "Yes."),                                      # answers the hand-back
        call(s, 17, "m7", cw=200, cr=30_000),
        person(s, 30, "Now check the census."),                     # message 3
        compaction(s, 31),                                          # before its first call
        call(s, 32, "err", model="<synthetic>", isApiErrorMessage=True),
        call(s, 33, "m9", cw=50_000),                               # first call: excess 5,000
        call(s, 34, "m10", cr=50_000),
        person(s, 40, "Thanks."),                                   # no call follows: not counted
    ]


@pytest.fixture
def worked(tmp_path):
    rows = _worked_rows()
    s = rows[0]["sessionId"]
    agent = [
        call(s, 20, "sub1", cw=10_000, out=1, isSidechain=True),
        tool_result(s, 21) | {"isSidechain": True},
        call(s, 22, "sub1", cw=10_000, out=1_000, isSidechain=True),   # last entry wins
    ]
    early = bundle(tmp_path, "b-early", "prj_worked", {"session-log.jsonl": rows[:8]})
    late = bundle(tmp_path, "b-late", "prj_worked", {"session-log.jsonl": rows},
                  subagents={"agent-a1.jsonl": agent})
    [project] = carry_cost.analyze([early, late])
    return project


def test_the_worked_session_by_hand(worked):
    """Message 2 carries 15,000 tokens through m3 (all written, $3.75) and m4 (60,000 read,
    2,000 written), then stops at the compaction. Message 3 starts after a compaction and
    still carries its own 5,000 through m9 (written) and m10 (read).

    Blended: m3 15,000 x 3.75 = $0.05625; m4 15,000 x (2,000 x 3.75 + 60,000 x 0.30)/62,000
    = $0.00616935; m9 5,000 x 3.75 = $0.01875; m10 5,000 x 0.30 = $0.0015. Total $0.08266935.
    Positional: m4's carried span (45,000-60,000) lies inside its 60,000 read tokens, so it is
    15,000 x 0.30 = $0.0045, the rest as blended. Total $0.081."""
    assert worked.excluded is None and worked.bundles == ["b-early", "b-late"]
    assert worked.baseline == 40_000
    messages = worked.messages[True]
    assert [m.first_context for m in messages] == [40_000, 60_000, 50_000]
    assert [m.excess(45_000) for m in messages] == [0, 15_000, 5_000]
    assert [len(m.carrying) for m in messages] == [2, 2, 2]
    assert [m.folded for m in messages] == [0, 1, 0]
    assert worked.excess_cost(5_000, positional=False) == pytest.approx(0.08266935, abs=1e-8)
    assert worked.excess_cost(5_000, positional=True) == pytest.approx(0.081, abs=1e-9)


def test_the_cost_counts_every_call_once_at_its_last_entry(worked):
    """Main thread: m1 (40,000 written, 100 out), m1b (40,000 read, 50 out: its LAST entry),
    m3, m4, m5, m6, m7, m9, m10, and no `<synthetic>` placeholder. The agent run adds sub1 at
    its last entry: 10,000 written and 1,000 out."""
    main = [(0, 40_000, 0, 100), (0, 0, 40_000, 50), (0, 60_000, 0, 10), (0, 2_000, 60_000, 10),
            (0, 30_000, 0, 10), (0, 100, 30_000, 10), (0, 200, 30_000, 10), (0, 50_000, 0, 10),
            (0, 0, 50_000, 10)]
    rate = (3.0, 3.75, 0.30, 15.0)
    price = lambda t: sum(n * r for n, r in zip(t, rate)) / 1e6  # noqa: E731
    assert [c.tokens for c in worked.main_calls] == main
    assert worked.cost(main_only=True) == pytest.approx(sum(price(t) for t in main))
    assert worked.cost() == pytest.approx(sum(price(t) for t in main) + price((0, 10_000, 0, 1_000)))


def test_a_hand_back_yes_is_folded_into_the_message_it_answers(worked):
    folded, unfolded = worked.messages[True], worked.messages[False]
    assert len(folded) == 3 and len(unfolded) == 4
    assert unfolded[2].first_context == 30_200 and unfolded[2].excess(45_000) == 0


def test_a_resumed_sdk_session_is_measured_from_the_projects_first_call(tmp_path):
    """The resume starts a new SDK session whose first call carries the whole conversation:
    its own first call would make that look like a fresh start."""
    first = [person("s1", 0, "Start."), call("s1", 1, "a", cw=40_000)]
    first[0]["parentUuid"] = None
    resumed = [person("s2", 60, "Go on."), call("s2", 61, "b", cw=0, cr=90_000)]
    b = bundle(tmp_path, "b", "prj_resumed", {"sessions/s1/session-log.jsonl": first,
                                              "session-log.jsonl": resumed})
    [project] = carry_cost.analyze([b])
    assert project.excluded is None and sorted(project.sessions) == ["s1", "s2"]
    assert project.baseline == 40_000
    assert [m.excess(45_000) for m in project.messages[True]] == [0, 45_000]


@pytest.mark.parametrize("shape, reason", [
    ("truncated", "log truncated"),
    ("headless", "does not open with a person prompt"),
    ("unmarked opener", "does not open with a person prompt"),
])
def test_a_session_the_bundle_cannot_show_whole_is_left_out(tmp_path, shape, reason):
    """An unmarked opener: the log marks its later prompts "sdk", so its first row is no
    person's prompt even though it has text."""
    rows = [person("s", 0, "Start."), call("s", 1, "a", cw=40_000)]
    rows[0]["parentUuid"] = None
    if shape == "truncated":
        rows.insert(0, {"type": "_truncation_note", "note": "older rows dropped"})
    elif shape == "headless":
        rows[0]["parentUuid"] = "an-earlier-row"
    else:
        del rows[0]["promptSource"]
        rows += [person("s", 2, "Go on."), call("s", 3, "b", cr=40_000)]
    [project] = carry_cost.analyze([bundle(tmp_path, "b", "prj", {"session-log.jsonl": rows})])
    assert project.excluded == reason


@pytest.mark.parametrize("marked", [True, False], ids=["sdk-marked log", "unmarked log"])
def test_meta_rows_tool_results_and_interrupts_are_not_messages(tmp_path, marked):
    """In a log with no `promptSource` the text rule decides alone, so each of these rows must
    be turned away by its own check. A tool result can carry a text block beside the result."""
    rows = [person("s", 0, "Start."), call("s", 1, "a", cw=40_000),
            _row("s", 2, type="user", isMeta=True, message={
                "role": "user", "content": "Base directory for this skill: /opt/x"}),
            call("s", 3, "b", cr=40_000),
            _row("s", 4, type="user", message={"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t", "content": "ok"},
                {"type": "text", "text": "A note added beside the result."}]}),
            call("s", 5, "c", cr=40_000),
            _row("s", 6, type="user", message={"role": "user", "content": [
                {"type": "text", "text": "[Request interrupted by user]"}]}),
            call("s", 7, "d", cr=40_000)]
    rows[0]["parentUuid"] = None
    if not marked:
        del rows[0]["promptSource"]
    [project] = carry_cost.analyze([bundle(tmp_path, "b", "prj", {"session-log.jsonl": rows})])
    assert len(project.messages[True]) == 1 and project.disagree == 0


def test_importing_the_script_leaves_eval_harness_off_the_path():
    """`eval/harness/tests` is a regular package: left on the path, it shadows
    `apps/server/tests` and every later `from tests... import` in the server suite fails."""
    import sys

    assert not any(p.rstrip("/").endswith("eval/harness") for p in sys.path), sys.path


def test_a_typed_yes_after_a_turn_with_no_hand_back_is_its_own_message(tmp_path):
    """The hand-back closed message 1, but message 2 is a turn of its own with no text, so a
    later "Yes." answers nothing the runner or the Continue button could have sent."""
    rows = [person("s", 0, "Start."), call("s", 1, "a", cw=40_000, text="Next: search. Continue?"),
            person("s", 2, "Search anyway."), call("s", 3, "b", cr=40_000),
            person("s", 4, "Yes."), call("s", 5, "c", cr=40_000)]
    rows[0]["parentUuid"] = None
    [project] = carry_cost.analyze([bundle(tmp_path, "b", "prj", {"session-log.jsonl": rows})])
    assert len(project.messages[True]) == 3


@pytest.mark.parametrize("between", ["interrupt", "API error", "API error with no text"])
def test_a_yes_after_an_interrupted_or_failed_hand_back_is_its_own_message(tmp_path, between):
    """The runner never answers a hand-back the person interrupted or an error followed, so a
    "Yes." after either was typed. An error clears the hand-back even with no text of its own."""
    if between == "interrupt":
        stop = _row("s", 2, type="user", message={"role": "user", "content": [
            {"type": "text", "text": "[Request interrupted by user]"}]})
    else:
        stop = call("s", 2, "err", model="<synthetic>", text="API Error: Connection closed mid-response.",
                    isApiErrorMessage=True)
        if between == "API error with no text":
            stop["message"]["content"] = []
    rows = [person("s", 0, "Start."),
            call("s", 1, "a", cw=40_000, text="Found it.\nNext: search records. Continue?"),
            stop, person("s", 3, "Yes."), call("s", 4, "b", cr=40_000)]
    rows[0]["parentUuid"] = None
    [project] = carry_cost.analyze([bundle(tmp_path, "b", "prj", {"session-log.jsonl": rows})])
    assert len(project.messages[True]) == 2


def test_the_command_measures_only_the_hosted_web_apps_bundles(tmp_path, capsys):
    """The feedback folder also holds desktop bundles. A bundle with no platform is not the
    web app's either, since the app has always written one."""
    def log(sid):
        rows = [person(sid, 0, "Start."), call(sid, 1, f"{sid}-a", cw=40_000)]
        rows[0]["parentUuid"] = None
        return {"session-log.jsonl": rows}

    paths = [bundle(tmp_path, "b-web", "prj_web", log("s1"), platform="web")[1],
             bundle(tmp_path, "b-win", "prj_win", log("s2"), platform="win32")[1],
             bundle(tmp_path, "b-none", "prj_none", log("s3"))[1]]
    carry_cost.main([str(p) for p in paths])
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "Skipped 2 bundles not from the hosted web app (platform: none 1, win32 1)."
    assert lines[1].startswith("1 web bundles hold 1 hosted sessions (projects);")


def test_a_call_never_carries_more_than_it_holds():
    """51,000 tokens of context against a 45,000 fresh start can carry 6,000, not 15,000."""
    c = carry_cost.Call("claude-sonnet-4-6", (0, 51_000, 0, 0))
    assert c.carry_cost(15_000, 45_000, positional=False) == pytest.approx(6_000 * 3.75 / 1e6)
    assert c.carry_cost(15_000, 45_000, positional=True) == pytest.approx(6_000 * 3.75 / 1e6)


def test_an_agent_launch_no_transcript_answers_leaves_the_session_out(tmp_path):
    launch = call("s", 1, "a", cw=40_000)
    launch["message"]["content"] = [{"type": "tool_use", "id": "toolu_1", "name": "Agent",
                                     "input": {"subagent_type": "locality-guide", "prompt": "x"}}]
    rows = [person("s", 0, "Start."), launch]
    rows[0]["parentUuid"] = None
    [project] = carry_cost.analyze([bundle(tmp_path, "b", "prj", {"session-log.jsonl": rows})])
    assert project.excluded == "agent transcripts missing"


def test_a_prompt_the_two_rules_read_differently_is_counted(tmp_path):
    """Both ways: a queued prompt has text but no "sdk" mark, and a meta row marked "sdk" fails
    the text rule. Neither is a message."""
    rows = [person("s", 0, "Start."), call("s", 1, "a", cw=40_000),
            person("s", 2, "Queued while busy.", promptSource="queue"), call("s", 3, "b", cr=40_000),
            person("s", 4, "Base directory for this skill: /opt/x", isMeta=True),
            call("s", 5, "c", cr=40_000)]
    rows[0]["parentUuid"] = None
    [project] = carry_cost.analyze([bundle(tmp_path, "b", "prj", {"session-log.jsonl": rows})])
    assert len(project.messages[True]) == 1 and project.disagree == 2
