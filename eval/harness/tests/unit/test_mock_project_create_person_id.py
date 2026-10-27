"""The live project_create reads its person from the test's own person_read
fixtures (#3384).

With `personId`, production's project_create reads FamilySearch itself. The mock
matches the id against the loaded `person_read` fixtures and serves the canned
read through the compiled `runProjectCreate`'s injected reader, so every step
after the read is production code and nothing reaches the network.
"""

import asyncio
import json
from pathlib import Path

import pytest

from harness.mock_mcp import _mock_memory_kinds, create_mock_server

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "mcp"


def _create(tmp_path: Path, fixtures: list[str], args: dict) -> tuple[dict, list, Path]:
    workspace = tmp_path / "project"
    workspace.mkdir()
    _server, log, tools = create_mock_server(fixtures, FIXTURES_DIR, workspace=workspace)
    out = asyncio.run(tools["project_create"].handler({"projectPath": str(workspace), "objective": "x", **args}))
    return json.loads(out["content"][0]["text"]), log, workspace


@pytest.mark.requires_engine_build
def test_person_id_is_served_from_the_fixture_and_the_read_is_recorded(tmp_path):
    result, log, workspace = _create(tmp_path, ["person-read-flynn-family"], {"personId": "LZNY-BRF"})
    assert result["ok"] is True, result
    assert result["subject"] == {
        "id": "I1", "familySearchId": "LZNY-BRF", "name": "Patrick Flynn", "birth": "~1845, Ireland",
        "death": "1908, Schuylkill County, Pennsylvania, United States",
    }
    assert "idMap" not in result
    research = json.loads((workspace / "research.json").read_text(encoding="utf-8"))
    assert [s["citation_detail"]["where_within"] for s in research["sources"]] == ["memory 228755097"]
    assert research["sources"][0]["source_classification"] == "authored"
    entry = next(e for e in log if e["tool"] == "mcp__genealogy__project_create")
    assert entry["served_read"]["fixture"] == "person-read-flynn-family"
    assert entry["served_read"]["response"]["persons"][0]["id"] == "LZNY-BRF"


@pytest.mark.requires_engine_build
def test_a_person_id_with_no_fixture_fails_the_read_and_writes_nothing(tmp_path):
    result, log, workspace = _create(tmp_path, ["person-read-flynn-family"], {"personId": "ZZZZ-999"})
    assert result["ok"] is False
    assert "no person_read fixture for ZZZZ-999" in " ".join(result["errors"])
    assert not (workspace / "research.json").exists()
    entry = next(e for e in log if e["tool"] == "mcp__genealogy__project_create")
    assert "served_read" not in entry


def test_memory_kinds_follow_the_mock_rule():
    """A canned read carries no media type, so the shape decides: a memory is a
    source with `artifact_url`; a story when it came back with text and no
    retained scan, a document otherwise. A tree source is no memory at all."""
    read = {
        "sources": [
            {"id": "TREE-1", "title": "1850 census"},
            {"id": "STORY", "title": "s", "artifact_url": "https://x/1", "text": "Patrick came over"},
            {"id": "SCAN", "title": "d", "artifact_url": "https://x/2", "text": "IN MEMORY", "image_ref": "images/SCAN.jpg"},
            {"id": "UNREAD", "title": "u", "artifact_url": "https://x/3", "notes": ["Not transcribed"]},
        ]
    }
    assert _mock_memory_kinds(read) == {"STORY": "story", "SCAN": "document", "UNREAD": "document"}
