"""The mock's `locality_survey` (issue #4602): the compiled survey run over the test's
own per-tool fixtures, logged once."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest

from harness.mock_mcp import _MCP_BUILD, create_mock_server

_EVAL = Path(__file__).resolve().parents[3]
_FIXTURES = _EVAL / "fixtures" / "mcp"
_SCENARIO = _EVAL / "fixtures" / "scenarios" / "empty-project-just-created"
_YORKSHIRE = json.loads(
    (_EVAL / "tests" / "unit" / "locality-guide" / "yorkshire-1851-death-collection.json").read_text(encoding="utf-8")
)

pytestmark = pytest.mark.skipif(
    not (_MCP_BUILD / "tools" / "locality-survey.js").exists(), reason="engine build has no locality-survey.js"
)


def _survey(tmp_path, args):
    for name in ("research.json", "tree.gedcomx.json"):
        if (_SCENARIO / name).exists():
            shutil.copy(_SCENARIO / name, tmp_path / name)
    _, log, tools = create_mock_server(_YORKSHIRE["mcp_fixtures"], _FIXTURES, workspace=tmp_path)
    out = asyncio.run(tools["locality_survey"].handler(args))
    return json.loads(out["content"][0]["text"]), log


def test_survey_is_served_from_the_tests_own_fixtures_and_logged_once(tmp_path):
    body, log = _survey(
        tmp_path, {"standardPlace": "Yorkshire, England, United Kingdom", "startYear": 1845, "endYear": 1855}
    )
    assert [e["tool"] for e in log] == ["mcp__genealogy__locality_survey"]
    matched = {p["matched"] for p in log[0]["survey_parts"]}
    assert "collections-search-yorkshire" in matched
    assert "external-links-search-yorkshire" in matched
    assert len(json.dumps(body)) <= 40_000
    assert [p["section"] for p in body["pagesRead"]] == ["home", "getting_started", "online_records", "research_tips"]


def test_a_catch_all_read_is_no_page_so_the_ladder_reaches_civil_registration(tmp_path):
    body, log = _survey(tmp_path, {"standardPlace": "Yorkshire, England, United Kingdom"})
    assert body["vitalRecords"]["url"].endswith("/England_Civil_Registration")
    reads = [p for p in log[0]["survey_parts"] if p["tool"] == "wiki_read"]
    assert reads[0]["args"]["url"].endswith("/England_Vital_Records")
    assert "catch-all" in reads[0]["matched"]


def test_with_a_project_the_answer_is_staged_and_the_links_stored(tmp_path):
    body, _ = _survey(tmp_path, {"standardPlace": "Yorkshire, England, United Kingdom", "projectPath": "/anything"})
    ref = body["staged"]["resultsRef"]
    assert (tmp_path / ref).exists()
    stored = json.loads((tmp_path / "external-collections.json").read_text(encoding="utf-8"))
    assert "Yorkshire, England, United Kingdom" in stored["places"]


def test_without_a_project_nothing_is_written(tmp_path):
    body, _ = _survey(tmp_path, {"standardPlace": "Yorkshire, England, United Kingdom"})
    assert "staged" not in body
    assert not (tmp_path / "external-collections.json").exists()
