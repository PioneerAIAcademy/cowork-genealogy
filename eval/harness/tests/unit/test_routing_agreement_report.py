"""Unit tests for the nextStep-vs-next-unit agreement report (issue #3523, Part 1)."""

from __future__ import annotations

import json

from e2e.routing_agreement_report import (
    format_report,
    next_step_unit,
    next_steps,
    normalize,
    paired_unit,
    scan,
)


def _pc(*steps, agent_id=None, summary=None):
    """A project_context call whose summary carries one question per step."""
    if summary is None:
        summary = json.dumps({"questionStatuses": [{"id": f"q_{i}", "nextStep": s} for i, s in enumerate(steps)]})
    return {"tool": "mcp__genealogy__project_context", "agent_id": agent_id, "args": {}, "response_summary": summary}


def _spawn(subagent_type=None, agent_id=None):
    args = {"prompt": "x"}
    if subagent_type is not None:
        args["subagent_type"] = subagent_type
    return {"tool": "Agent", "agent_id": agent_id, "args": args}


def _skill(name, agent_id=None):
    return {"tool": "Skill", "agent_id": agent_id, "args": {"skill": name}}


def _other(tool="mcp__genealogy__research_query", agent_id=None):
    return {"tool": tool, "agent_id": agent_id, "args": {}}


def _write(tmp_path, tool_calls, sha="abc1234", stem="run-2026-10-20_00-00-00"):
    slug = tmp_path / "some-fixture"
    slug.mkdir(parents=True, exist_ok=True)
    p = slug / f"{stem}.json"
    p.write_text(json.dumps({"git_sha": sha, "tool_calls": tool_calls}), encoding="utf-8")
    return p


def _planted(tmp_path):
    return _write(tmp_path, [
        # 1. match: router nextStep search-records, then the Skill runs it.
        _pc("search-records"), _other(), _skill("search-records"),
        # 2. miss: nextStep research-exhaustiveness, but research-plan runs.
        _pc("research-exhaustiveness, then proof-conclusion"), _skill("research-plan"),
        # 3. alias: nextStep extraction (…), and the retired record-extractor runs.
        _pc("extraction (extraction_append for FamilySearch records, record-structurer for any other source)"),
        _spawn("record-extractor"),
        # 4. untyped spawn: always a miss, even against a matching-looking step.
        _pc("person-evidence"), _spawn("general-purpose"),
        # 5. unpaired: the next project_context comes before any hand-off.
        _pc("conflict-resolution — unresolved c_001"), _other(),
        # 6. subagent scope: agent_id set on the project_context call.
        _pc("extraction (…)", agent_id="sub1"), _other("mcp__genealogy__extraction_append", agent_id="sub1"),
        # 7. the legitimate prefixed spelling still matches.
        _pc("person-evidence"), _spawn("genealogy-research:person-evidence"),
    ])


def test_planted_run_counts_each_case(tmp_path):
    s = scan([_planted(tmp_path)])
    router = [d for d in s.decisions if d.population == "router"]
    subagent = [d for d in s.decisions if d.population == "subagent"]

    assert len(router) == 5
    assert sum(d.matched for d in router) == 3  # cases 1, 3 and 7
    assert s.unpaired["router"] == 1  # case 5
    assert len(subagent) == 1 and subagent[0].matched  # case 6

    by_paired = {d.paired: d for d in router}
    assert by_paired["search-records"].matched
    assert not by_paired["research-plan"].matched
    assert by_paired["research-plan"].unit == "research-exhaustiveness"
    assert by_paired["extraction"].matched  # record-extractor folds to extraction
    assert not by_paired["untyped"].matched
    assert by_paired["person-evidence"].matched  # prefix stripped


def test_record_extractor_alias_and_prefix_strip():
    assert normalize("record-extractor") == "extraction"
    assert normalize("record-extraction") == "extraction"
    assert normalize("record-structurer") == "extraction"
    assert normalize("genealogy-research:person-evidence") == "person-evidence"
    assert normalize("@plugin:search-images") == "search-images"


def test_next_step_unit_cuts_at_dash_comma_and_parenthesis():
    assert next_step_unit("research-exhaustiveness, then proof-conclusion") == "research-exhaustiveness"
    assert next_step_unit("search-external-sites — pli_001 (MyHeritage)") == "search-external-sites"
    assert next_step_unit("extraction (extraction_append for FamilySearch records, x)") == "extraction"
    assert next_step_unit("record-extraction") == "extraction"


def test_paired_unit_kinds():
    assert paired_unit(_spawn()) == "untyped"
    assert paired_unit(_spawn("general-purpose")) == "untyped"
    assert paired_unit(_skill("genealogy-research:research-plan")) == "research-plan"
    assert paired_unit(_other("mcp__remote-devices__Genealogy_Research__extraction_append")) == "extraction"
    assert paired_unit(_other()) is None


def test_reads_next_steps_from_a_truncated_summary():
    summary = '{"questionStatuses": [{"id": "q_001", "nextStep": "search-records"}, {"id": "q_002", "nextStep": null}, {"id": "q_003", "nextSt'
    assert next_steps(summary) == ["search-records"]


def test_stripped_and_stepless_calls_are_counted_not_scored(tmp_path):
    p = _write(tmp_path, [
        {"tool": "mcp__genealogy__project_context", "agent_id": None, "args": {}},
        _pc(None), _skill("research-plan"),
    ])
    s = scan([p])
    assert s.decisions == []
    assert s.stripped == 1 and s.no_next_step == 1


def test_more_than_one_question_with_a_next_step(tmp_path):
    p = _write(tmp_path, [_pc("research-plan", "search-records"), _skill("search-records")])
    (d,) = scan([p]).decisions
    assert d.matched and d.unit == "search-records" and len(d.steps) == 2


def test_report_prints_both_populations_and_the_sha_breakdown(tmp_path):
    s = scan([_planted(tmp_path)])
    out = format_report(s, {"abc1234": 1}, {"abc1234": {"#3494": False, "#3583": None}})
    assert "== Router decisions" in out and "== Subagent decisions" in out
    assert "abc1234" in out and "#3494=no" in out and "#3583=?" in out
    assert "Unpaired" in out and "router 1" in out
