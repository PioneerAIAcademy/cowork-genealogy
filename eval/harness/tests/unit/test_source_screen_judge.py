"""source_screen_judge.py (issue #3408, step 2). No LLM: the runner is faked, and
the fixture tests drive the harness's real mock MCP handlers."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import source_screen_judge as judge
from harness.auth import AuthConfig
from harness.mock_mcp import create_mock_server

REPO_ROOT = Path(__file__).resolve().parents[4]
V2_LOG = REPO_ROOT / "eval/runlogs/unit/source-evaluation/v2.json"


def _w(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _record(persona_id: str, given: str = "John") -> dict[str, Any]:
    return {
        "persons": [{"id": "p_1", "ark": f"ark:/61903/1:1:{persona_id}", "names": [{"given": given, "surname": "Smith"}], "facts": []}],
        "sources": [{"id": "c", "resource_type": "Collection", "title": "A collection"}],
    }


def make_snapshot(
    root: Path,
    copy: str,
    subject: str,
    personas: list[str],
    *,
    others: list[str] = (),
    relationship_personas: list[str] = (),
    attachments: dict[str, list[str]] | None = None,
    plants: dict[str, Any] | None = None,
) -> Path:
    """A snapshot with one copy, shaped as source-screen.ts writes it."""
    d = root / "persons" / copy
    read = {
        "persons": [{"id": subject, "gender": "Male", "living": False, "names": [{"given": "John", "surname": "Smith"}], "sources": [{"ref": f"s_{p}"} for p in personas]}],
        "relationships": [],
        "sources": [{"id": f"s_{p}", "title": f"Record {p}", "url": f"https://www.familysearch.org/ark:/61903/1:1:{p}"} for p in personas],
    }
    _w(d / "person-read.json", read)
    _w(d / "tree.gedcomx.json", {"persons": read["persons"], "relationships": [], "sources": read["sources"]})
    entries = [{"key": f"ark:/61903/1:1:{p}", "ark": f"ark:/61903/1:1:{p}", "source_ids": [f"s_{p}"], "level": "subject", "class": "persona"} for p in personas]
    entries += [{"key": f"ark:/61903/1:1:{p}", "ark": f"ark:/61903/1:1:{p}", "source_ids": [f"r_{p}"], "level": "relationship", "class": "persona"} for p in relationship_personas]
    _w(d / "audit.json", {"subject_id": subject, "living": False, "entries": entries})
    for p in [*personas, *relationship_personas]:
        if not (root / "records" / f"{p}.json").exists():
            _w(root / "records" / f"{p}.json", _record(p))
    att = attachments or {p: [subject] for p in personas}
    _w(d / "attachments.json", {"attachments": {f"ark:/61903/1:1:{k}": [{"personId": v, "tags": []} for v in vs] for k, vs in att.items()}, "unattached": []})
    for o in others:
        _w(d / "others" / f"{o}.json", {"persons": [{"id": o, "gender": "Male", "living": False, "names": [{"given": "Other", "surname": "Smith"}]}], "relationships": [], "sources": []})
    _w(d / "quality.json", {"personId": subject, "issues": [], "detail": {"facts": [], "conflicts": []}})
    _w(d / "meta.json", {"input_pid": subject, "copy_key": copy, "attempts": 1})
    run_path = root / "run.json"
    run = json.loads(run_path.read_text(encoding="utf-8")) if run_path.exists() else {"map": {}, "plants": {}}
    if plants is None:
        run["map"][subject] = copy
    else:
        run["plants"][copy] = plants
    _w(run_path, run)
    return root


def _handlers(snapshot: Path, copy: str, tmp: Path):
    names, _facts = judge.generate_fixtures(snapshot, copy, tmp / "fixtures")
    ws = tmp / "ws"
    ws.mkdir(exist_ok=True)
    (ws / "tree.gedcomx.json").write_text((snapshot / "persons" / copy / "tree.gedcomx.json").read_text(encoding="utf-8"), encoding="utf-8")
    _server, call_log, tools = create_mock_server(names, tmp / "fixtures", workspace=ws)
    return call_log, tools, ws


def _call(tools, name: str, args: dict[str, Any]) -> Any:
    return asyncio.run(tools[name].handler(args))


def _recorded_runs() -> list[list[dict[str, Any]]]:
    log = json.loads(V2_LOG.read_text(encoding="utf-8"))
    runs = []
    for t in log["tests"]:
        for run in t["runs"]:
            calls = [{"tool": c["tool"].split("__")[-1], "args": c.get("args") or {}} for c in (run.get("output") or {}).get("tool_calls") or []]
            if any(c["tool"] == "person_quality" for c in calls):
                runs.append(calls)
    return runs


def test_generated_fixtures_answer_the_call_shapes_recorded_in_the_v2_run_log(tmp_path):
    runs = _recorded_runs()
    assert runs, "the v2 run log holds no run with a person_quality call"
    shapes = set()
    for i, calls in enumerate(runs):
        subject = next(c["args"]["personId"] for c in calls if c["tool"] == "person_quality")
        personas = sorted({judge.bare_id(c["args"]["recordId"]) for c in calls if c["tool"] == "record_read"})
        personas += sorted({judge.bare_id(u) for c in calls if c["tool"] == "source_attachments" for u in c["args"]["uris"]} - set(personas))
        others = sorted({c["args"]["personId"] for c in calls if c["tool"] == "person_read"} - {subject})
        snap = make_snapshot(tmp_path / f"s{i}", subject, subject, personas, others=others)
        call_log, tools, ws = _handlers(snap, subject, tmp_path / f"t{i}")
        replay = []
        for c in calls:
            args = dict(c["args"])
            if "projectPath" in args:
                args["projectPath"] = str(ws)
            replay.append((c["tool"], args))
            shapes.add((c["tool"], tuple(sorted(args))))
            if c["tool"] == "record_read":
                replay.append(("record_read", {"recordId": f"https://familysearch.org/{judge.to_ark(args['recordId'])}"}))
            if c["tool"] == "source_attachments":
                replay.append(("source_attachments", {"uris": [f"https://familysearch.org/{judge.to_ark(u)}" for u in args["uris"]]}))
        for tool, args in replay:
            if tool in tools:
                _call(tools, tool, args)
        unmatched = [(e["tool"], e["args"]) for e in call_log if (e.get("matched") or {}).get("kind") == "none"]
        assert unmatched == [], f"run {i}: calls the generated fixtures did not answer: {unmatched}"
    assert ("source_attachments", ("uris",)) in shapes
    assert ("person_read", ("personId", "projectPath")) in shapes
    assert ("person_quality", ("detail", "personId")) in shapes


def test_exact_predicates_would_miss_the_https_spelling(tmp_path):
    """The `~` predicates are what answer a rewritten URL: an exact one does not."""
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"])
    names, _ = judge.generate_fixtures(snap, "KWCB-QZ3", tmp_path / "fx")
    path = tmp_path / "fx" / (next(n for n in names if "record-read" in n) + ".json")
    fx = json.loads(path.read_text(encoding="utf-8"))
    fx["args"]["recordId"] = "ark:/61903/1:1:AAAA-111"
    path.write_text(json.dumps(fx), encoding="utf-8")
    _server, call_log, tools = create_mock_server(names, tmp_path / "fx", workspace=tmp_path)
    _call(tools, "record_read", {"recordId": "https://familysearch.org/ark:/61903/1:1:AAAA-111"})
    assert call_log[-1]["matched"]["kind"] == "none"


class FakeRunner:
    """Stands in for run_skill: drives the real mock with the given calls, returns text."""

    def __init__(self, calls: list[tuple[str, dict[str, Any]]], text: str, aborted: str | None = None):
        self.calls, self.text, self.aborted = calls, text, aborted
        self.seen: dict[str, Any] = {}

    async def __call__(self, **kw):
        self.seen = kw
        _server, call_log, tools = create_mock_server(kw["fixture_names"], kw["fixtures_dir"], workspace=kw["workspace"])
        for tool, args in self.calls:
            await tools[tool].handler(args)
        return SimpleNamespace(
            text_response="",
            agent_returns=[{"subagent_type": "source-evaluation", "text": self.text}],
            tool_calls=call_log,
            usage={"num_turns": 3, "input_tokens": 10},
            aborted_reason=self.aborted,
        )


def _judge(snap: Path, copy: str, runner, quota: str = "quota_exhausted"):
    return asyncio.run(
        judge.judge_copy(
            snap,
            copy,
            auth=AuthConfig(skill_runner_mode="subscription", api_key=None, detail="t"),
            run_skill=runner,
            model="m",
            max_tool_calls=10,
            max_wall_clock_seconds=10,
            build_workspace=lambda *a, **k: None,
            cleanup_session_store=lambda ws: None,
            direct_dispatch_prompt=lambda agent, d: f"{agent}: {d}",
            agent_return_text=lambda returns, agent: "\n".join(r["text"] for r in returns or [] if r["subagent_type"] == agent),
            quota_reason=quota,
        )
    )


FINDINGS = 'Report.\n```json\n[{"source_url": "https://www.familysearch.org/ark:/61903/1:1:AAAA-111", "kind": "misattributed", "fact": "birth"}]\n```'


def test_a_run_that_reads_another_attached_person_is_not_marked_harness_miss(tmp_path):
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"], others=["KWCB-QZ9"], attachments={"AAAA-111": ["KWCB-QZ3", "KWCB-QZ9"]})
    runner = FakeRunner(
        [
            ("person_read", {"personId": "KWCB-QZ3"}),
            ("record_read", {"recordId": "ark:/61903/1:1:AAAA-111"}),
            ("source_attachments", {"uris": ["ark:/61903/1:1:AAAA-111"]}),
            ("person_read", {"personId": "KWCB-QZ9"}),
        ],
        FINDINGS,
    )
    rec = _judge(snap, "KWCB-QZ3", runner)
    assert rec["harness_miss"] is False
    assert rec["calls"]["person_read"] == {"predicate": 2}
    assert "KWCB-QZ3" in runner.seen["user_message"] and judge.FINDINGS_INSTRUCTION in runner.seen["user_message"]
    assert (snap / "judge" / "KWCB-QZ3.json").exists()


def test_marks_harness_miss_when_a_call_matched_no_fixture(tmp_path):
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"])
    rec = _judge(snap, "KWCB-QZ3", FakeRunner([("record_read", {"recordId": "ark:/61903/1:1:ZZZZ-999"})], FINDINGS))
    assert rec["harness_miss"] is True
    assert rec["calls"]["record_read"] == {"none": 1}


def test_the_record_read_fixture_for_an_indexing_plant_copy_serves_its_own_records_copy(tmp_path):
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3.unplanted", "KWCB-QZ3", ["AAAA-111"], plants={"host": "KWCB-QZ3"})
    make_snapshot(snap, "fx_i", "KWCB-QZ3", ["AAAA-111"], plants={"fixture_id": "fx_i", "host": "KWCB-QZ3", "type": "indexing_error"})
    _w(snap / "persons" / "fx_i" / "records" / "AAAA-111.json", _record("AAAA-111", given="Jonathan"))
    served = {}
    for copy in ("fx_i", "KWCB-QZ3.unplanted"):
        call_log, tools, _ws = _handlers(snap, copy, tmp_path / copy)
        _call(tools, "record_read", {"recordId": "ark:/61903/1:1:AAAA-111"})
        served[copy] = call_log[-1]["response"]["persons"][0]["names"][0]["given"]
    assert served == {"fx_i": "Jonathan", "KWCB-QZ3.unplanted": "John"}


def test_refuses_to_run_under_api_key_auth(tmp_path, monkeypatch):
    with pytest.raises(judge.JudgeError, match="subscription"):
        judge.require_subscription(AuthConfig(skill_runner_mode="api_key", api_key="k", detail="t"))
    judge.require_subscription(AuthConfig(skill_runner_mode="subscription", api_key=None, detail="t"), environ={})
    for var in judge.OFF_SUBSCRIPTION_ENV:
        with pytest.raises(judge.JudgeError, match=var):
            judge.require_subscription(AuthConfig(skill_runner_mode="subscription", api_key=None, detail="t"), environ={var: "1"})
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"])
    import harness.auth

    monkeypatch.setattr(harness.auth, "resolve_auth", lambda: AuthConfig(skill_runner_mode="api_key", api_key="k", detail="t"))
    with pytest.raises(judge.JudgeError, match="subscription"):
        judge.main(["--snapshot", str(snap)])
    assert not (snap / "judge").exists()


def test_parses_the_closing_json_block_and_records_a_malformed_one_as_a_parse_failure(tmp_path):
    found, err, rejected = judge.parse_findings('```json\n[1]\n```\nlater\n' + FINDINGS)
    assert err is None and rejected == [] and found == [{"source_url": "https://www.familysearch.org/ark:/61903/1:1:AAAA-111", "kind": "misattributed", "fact": "birth"}]
    assert judge.parse_findings("no block")[1]
    assert judge.parse_findings("```json\n[{\"kind\": \"misattributed\"\n```")[1]
    found, err, rejected = judge.parse_findings(
        '```json\n[{"source_url": "x", "kind": "wrong"}, {"source_url": null, "kind": "unchecked", "fact": "a book"}, {"source_url": "ark:/61903/1:1:B", "kind": "indexing"}]\n```'
    )
    assert err is None and len(found) == 2 and rejected == [{"source_url": "x", "kind": "wrong"}]
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"])
    rec = _judge(snap, "KWCB-QZ3", FakeRunner([], "report without a block"))
    assert rec["parse_error"] and rec["findings"] == []


def test_an_empty_agent_return_is_a_parse_failure_not_the_dispatcher_text(tmp_path):
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"])
    runner = FakeRunner([], "")
    rec = _judge(snap, "KWCB-QZ3", runner)
    assert rec["parse_error"] == "the agent returned no text" and rec["findings"] == []


def test_skips_a_finished_copy_and_retries_an_aborted_one(tmp_path):
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"])
    make_snapshot(snap, "KWCB-QZ4", "KWCB-QZ4", ["BBBB-111"])
    make_snapshot(snap, "KWCB-QZ5", "KWCB-QZ5", ["CCCC-111"])
    _judge(snap, "KWCB-QZ3", FakeRunner([], FINDINGS))
    rec = _judge(snap, "KWCB-QZ4", FakeRunner([], "", aborted="max_wall_clock_seconds"))
    assert rec["aborted_reason"] and (snap / "judge" / "KWCB-QZ4.aborted.json").exists()
    assert judge.pending_copies(snap) == ["KWCB-QZ4", "KWCB-QZ5"]
    with pytest.raises(judge.QuotaStop):
        _judge(snap, "KWCB-QZ5", FakeRunner([], "", aborted="quota_exhausted"))
    _judge(snap, "KWCB-QZ4", FakeRunner([], FINDINGS))
    assert not (snap / "judge" / "KWCB-QZ4.aborted.json").exists()
    assert judge.pending_copies(snap) == ["KWCB-QZ5"]


def test_refuses_snapshot_paths_inside_the_repo_and_accepts_them_outside(tmp_path):
    with pytest.raises(judge.JudgeError, match="inside the repo"):
        judge.guard_path(REPO_ROOT / "eval" / "snap")
    with pytest.raises(judge.JudgeError, match="inside the repo"):
        judge.guard_path(REPO_ROOT)
    assert judge.guard_path(tmp_path / "snap") == (tmp_path / "snap").resolve()


def test_judge_jsonl_refuses_mixed_agent_body_hashes(tmp_path):
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"])
    make_snapshot(snap, "KWCB-QZ4", "KWCB-QZ4", ["BBBB-111"])
    _judge(snap, "KWCB-QZ3", FakeRunner([], FINDINGS))
    _judge(snap, "KWCB-QZ4", FakeRunner([], FINDINGS))
    assert judge.write_judge_jsonl(snap) == 2
    row = json.loads((snap / "judge.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert row == {"copy_key": "KWCB-QZ3", "ark": "ark:/61903/1:1:AAAA-111", "source_url": "https://www.familysearch.org/ark:/61903/1:1:AAAA-111", "kind": "misattributed", "fact": "birth", "signal": "judge"}
    p = snap / "judge" / "KWCB-QZ4.json"
    j = json.loads(p.read_text(encoding="utf-8"))
    j["agent_sha256"] = "different"
    p.write_text(json.dumps(j), encoding="utf-8")
    with pytest.raises(judge.JudgeError, match="source-evaluation.md versions"):
        judge.write_judge_jsonl(snap)


def test_relationship_level_sources_are_counted_not_audited(tmp_path):
    snap = make_snapshot(tmp_path / "s", "KWCB-QZ3", "KWCB-QZ3", ["AAAA-111"], relationship_personas=["EDGE-111", "EDGE-222"])
    _names, facts = judge.generate_fixtures(snap, "KWCB-QZ3", tmp_path / "fx")
    assert facts["not_audited"] == 2
