"""Offline tests for the D14/D17 prep: proto/audit.py's classification of tool_calls rows
(acceptance criteria 3 and 4) and proto/seed.py's fixture resolution and file plan. No
Postgres, no stack, no model."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from proto import audit, seed


def row(tool: str, decision: str = "allow", path: str | None = None, ms: int | None = None) -> dict:
    return {"turn_id": "t", "agent_type": None, "tool_name": tool, "input_path": path,
            "decision": decision, "duration_ms": ms}


# ── audit ─────────────────────────────────────────────────────────────────────────


def test_audit_passes_a_clean_session_and_reports_its_durations():
    a = audit.audit([
        row("mcp__genealogy__place_search", ms=310),
        row("Read", path="/opt/genealogy/plugin/skills/x/references/y.md", ms=5),
        row("Task", ms=90_000),
        row("mcp__genealogy__record_read"),  # in flight at a kill: no duration, not a failure
    ], anchor="/project")
    assert a.criterion_3_ok and a.rows == 4
    assert a.completed == 3 and a.without_duration == 1
    assert a.longest == ("Task", 90_000) and a.p50_ms == 310 and a.denied == {}


def test_audit_fails_on_an_executed_bash_or_an_allowed_project_read():
    assert not audit.audit([row("Bash", ms=3)], anchor="/project").criterion_3_ok
    assert not audit.audit([row("Read", path="/project/research.json", ms=3)], anchor="/project").criterion_3_ok
    assert not audit.audit([row("Grep", path="/project/results/x.json")], anchor="/project").criterion_3_ok
    assert not audit.audit([row("Glob", path="/project")], anchor="/project").criterion_3_ok


def test_audit_counts_denied_attempts_separately_and_reads_beside_the_anchor_as_ordinary():
    a = audit.audit([
        row("Read", "deny", "/project/research.json"),
        row("Bash", "deny"),
        row("Read", path="/projects/other.json", ms=1),  # a sibling path, not under /project
    ], anchor="/project")
    assert a.criterion_3_ok and a.project_reads_allowed == 0 and a.bash_executed == 0
    assert a.denied == {"Read": 1, "Bash": 1}


def test_audit_report_names_the_verdict_and_the_ceiling():
    text = audit.report(audit.audit([row("Bash", ms=3)], anchor="/project"), ceiling_s=1800, session_id="s")
    assert "FAIL" in text and "session s" in text
    text = audit.report(audit.audit([row("Task", ms=2_000_000)], anchor="/project"), ceiling_s=1800, session_id=None)
    assert "PASS" in text and "reached the ceiling" in text and "every session" in text
    assert "no completed call" in audit.report(audit.audit([], anchor="/project"), ceiling_s=1800, session_id=None)


# ── seed ──────────────────────────────────────────────────────────────────────────


def _e2e_fixture(root: Path) -> Path:
    d = root / "e2e" / "fx"
    d.mkdir(parents=True)
    for name in ("starting-research.json", "starting-tree.gedcomx.json", "unstripped-tree.gedcomx.json",
                 "expected-findings.json"):
        (d / name).write_text("{}", encoding="utf-8")
    (d / "fixture.json").write_text(json.dumps({"name": "Fx", "researcher_question": "Who?"}), encoding="utf-8")
    (d / "README.md").write_text("notes", encoding="utf-8")
    return d


def test_plan_files_maps_an_e2e_fixture_to_the_two_project_documents(tmp_path):
    d = _e2e_fixture(tmp_path)
    plan = seed.plan_files(d)
    assert [ref for ref, _ in plan] == ["research.json", "tree.gedcomx.json"]
    assert plan[0][1] == d / "starting-research.json"
    assert seed.fixture_meta(d) == {"name": "Fx", "researcher_question": "Who?"}


def test_plan_files_takes_a_scenario_whole_but_for_its_readme_and_dotfiles(tmp_path):
    d = tmp_path / "sc"
    (d / "results").mkdir(parents=True)
    (d / ".hidden").mkdir()
    for name in ("research.json", "tree.gedcomx.json", "results/log_1.json", "README.md", ".hidden/x"):
        (d / name).write_text("{}", encoding="utf-8")
    assert [ref for ref, _ in seed.plan_files(d)] == ["research.json", "results/log_1.json", "tree.gedcomx.json"]
    assert seed.fixture_meta(d) == {}


def test_plan_files_refuses_a_directory_with_no_research_document(tmp_path):
    (tmp_path / "x.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="research.json"):
        seed.plan_files(tmp_path)


def test_resolve_fixture_tries_a_directory_then_e2e_then_scenarios(tmp_path):
    e2e, sc = tmp_path / "e2e", tmp_path / "sc"
    (e2e / "a").mkdir(parents=True)
    (sc / "b").mkdir(parents=True)
    assert seed.resolve_fixture("a", e2e_dir=e2e, scenario_dir=sc) == (e2e / "a").resolve()
    assert seed.resolve_fixture("b", e2e_dir=e2e, scenario_dir=sc) == (sc / "b").resolve()
    assert seed.resolve_fixture(str(sc / "b"), e2e_dir=e2e, scenario_dir=sc) == (sc / "b").resolve()
    with pytest.raises(FileNotFoundError, match="no fixture 'c'"):
        seed.resolve_fixture("c", e2e_dir=e2e, scenario_dir=sc)


def test_default_project_id_is_a_valid_store_key(tmp_path):
    d = tmp_path / "bagley-father 1884"
    d.mkdir()
    pid = seed.default_project_id(d)
    assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", pid) and pid.startswith("proj_bagley-father-1884_")


def test_the_repos_own_fixtures_plan_in_both_layouts():
    e2e = seed.plan_files(seed.resolve_fixture("bagley-father-1884"))
    assert [ref for ref, _ in e2e] == ["research.json", "tree.gedcomx.json"]
    assert seed.fixture_meta(seed.resolve_fixture("bagley-father-1884"))["researcher_question"].startswith("Who was the father")
    scenario = dict(seed.plan_files(seed.resolve_fixture("flynn-first-plan")))
    assert "research.json" in scenario and "tree.gedcomx.json" in scenario and "README.md" not in scenario
