"""Test-only skills (lead, 2026-09-30): `eval/skills/<name>/`, staged for their
own suite's unit runs and never shipped.

The lead's design for the indexed-record suite is a thin test-only skill,
`extraction-append`, that calls `extraction_append` once and returns its
summary, with the harness serving each record from the test's `record_read`
fixtures. These tests pin the four places that has to hold: staging (only for
its own suite), the run-log snapshot, the frontmatter the validators read, and
the mock's `extraction_append` seam.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest

from harness.allowed_tools import load_suite_frontmatter, suite_body_path
from harness.mock_mcp import create_mock_server
from harness.snapshot import build_snapshot
from harness.workspace import DEFAULT_PLUGIN_SKILLS, TEST_ONLY_SKILLS, build_workspace

REPO_ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = REPO_ROOT / "eval" / "fixtures" / "scenarios"
FIXTURES = REPO_ROOT / "eval" / "fixtures" / "mcp"
SKILL = "extraction-append"


def test_the_test_only_skill_lives_outside_the_plugin():
    assert (TEST_ONLY_SKILLS / SKILL / "SKILL.md").is_file()
    assert not (DEFAULT_PLUGIN_SKILLS / SKILL).exists(), (
        "a test-only skill must never sit under packages/engine/plugin/skills/: the "
        "hosted control plane and the e2e harness load that folder directly"
    )


def test_it_is_staged_for_its_own_suite(tmp_path):
    build_workspace(None, SCENARIOS, DEFAULT_PLUGIN_SKILLS, tmp_path, suite=SKILL)
    assert (tmp_path / ".claude" / "skills" / SKILL / "SKILL.md").is_file()


def test_it_is_not_staged_for_any_other_suite(tmp_path):
    """The other direction: staged everywhere, every other suite's tests would run
    with a skill production lacks."""
    build_workspace(None, SCENARIOS, DEFAULT_PLUGIN_SKILLS, tmp_path, suite="search-records")
    assert not (tmp_path / ".claude" / "skills" / SKILL).exists()
    assert (tmp_path / ".claude" / "skills" / "search-records" / "SKILL.md").is_file()


def test_its_body_is_in_its_suites_snapshot():
    snap = build_snapshot(skill=SKILL, repo_root=REPO_ROOT)
    assert f"eval/skills/{SKILL}/SKILL.md" in snap


def test_its_frontmatter_resolves_for_the_validators():
    assert suite_body_path(SKILL, DEFAULT_PLUGIN_SKILLS) == TEST_ONLY_SKILLS / SKILL / "SKILL.md"
    fm = load_suite_frontmatter(SKILL, DEFAULT_PLUGIN_SKILLS)
    assert fm.get("name") == SKILL
    assert "extraction_append" in (fm.get("allowed-tools") or [])


def test_a_plugin_skill_still_wins_over_a_test_only_one_of_the_same_name(tmp_path):
    fake_plugin = tmp_path / "skills"
    (fake_plugin / SKILL).mkdir(parents=True)
    (fake_plugin / SKILL / "SKILL.md").write_text("---\nname: plugin-copy\n---\n", encoding="utf-8")
    assert suite_body_path(SKILL, fake_plugin) == fake_plugin / SKILL / "SKILL.md"


# ─── the mock's extraction_append seam (PLAN acceptance check 5) ────────────


def _invoke(tools_by_name, name, args):
    result = asyncio.run(tools_by_name[name].handler(args))
    return json.loads(result["content"][0]["text"])


def _copy_scenario(dst: Path):
    for name in ("research.json", "tree.gedcomx.json"):
        shutil.copy(SCENARIOS / "empty-project-just-created" / name, dst / name)


@pytest.mark.requires_engine_build
def test_recordIds_reads_the_record_read_fixture_and_extracts_in_code(tmp_path):
    _copy_scenario(tmp_path)
    _s, _c, tools = create_mock_server(["record-read-mxhy-tp4-flynn-1850"], FIXTURES, workspace=tmp_path)
    out = _invoke(tools, "extraction_append", {"projectPath": str(tmp_path), "recordIds": ["ark:/61903/1:1:MXHY-TP4"]})
    assert out["ok"] is True, out
    [rec] = out["records"]
    assert rec["status"] == "extracted"
    assert "Thomas Flynn (head_of_household)" in rec["summary"]
    research = json.loads((tmp_path / "research.json").read_text(encoding="utf-8"))
    assert [e["tool"] for e in research["log"]] == ["record_read"]
    assert research["log"][0]["results_ref"]


@pytest.mark.requires_engine_build
def test_an_id_with_no_fixture_is_reported_not_fetched(tmp_path):
    """The harness is hermetic: an unmatched id is a read failure naming the
    missing fixture, never a FamilySearch request."""
    _copy_scenario(tmp_path)
    _s, _c, tools = create_mock_server(["record-read-mxhy-tp4-flynn-1850"], FIXTURES, workspace=tmp_path)
    out = _invoke(tools, "extraction_append", {"projectPath": str(tmp_path), "recordIds": ["ZZZZ-999"]})
    [rec] = out["records"]
    assert rec["status"] == "read_failed"
    assert "no record_read fixture" in rec["summary"]
