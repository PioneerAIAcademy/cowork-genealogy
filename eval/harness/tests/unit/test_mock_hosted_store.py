"""A test that serves a hosted `project_list` answer gets a hosted store: project tools
refuse any `projectPath` the listing does not name, and `project_context` at a listed
project carries that project's `projectUrl` (`mock_mcp._hosted_store`)."""
import asyncio
import json
import shutil
from pathlib import Path

import pytest

from harness import mock_mcp

REPO = Path(__file__).resolve().parents[4]
LISTING = json.loads((REPO / "eval/fixtures/mcp/project-list-hosted-flynn.json").read_text(encoding="utf-8"))
SCENARIO = REPO / "eval/fixtures/scenarios/empty-project-just-created"
LISTED = LISTING["response"]["projects"][0]

pytestmark = pytest.mark.skipif(
    not (mock_mcp._MCP_BUILD / "tools" / "project-context.js").exists(),
    reason="needs the compiled engine (make engine-build)",
)


def _call(tmp_path, manifest, path):
    for name in ("research.json", "tree.gedcomx.json"):
        shutil.copy(SCENARIO / name, tmp_path / name)
    log: list = []
    handler = mock_mcp._make_live_handler("project_context", tmp_path, log, manifest)
    asyncio.run(handler({"projectPath": path}))
    return log[-1]["response"]


def _hosted():
    return {"project_list": {"predicated": [({}, LISTING["response"], "project-list-hosted-flynn")]}}


def test_a_listed_path_reads_the_project_and_carries_its_link(tmp_path):
    response = _call(tmp_path, _hosted(), LISTED["projectPath"])
    assert response.get("objective") == LISTED["objective"]
    assert response.get("projectUrl") == LISTED["projectUrl"]


def test_an_unlisted_path_is_refused_as_the_hosted_store_refuses_it(tmp_path):
    response = _call(tmp_path, _hosted(), str(tmp_path))
    assert response.get("ok") is False
    assert "is not this store's project" in response["errors"][0]
    assert "projectUrl" not in response


def test_the_new_project_path_is_served(tmp_path):
    response = _call(tmp_path, _hosted(), LISTING["response"]["newProjectPath"])
    assert "is not this store's project" not in json.dumps(response)
    assert "projectUrl" not in response


def test_a_folder_test_serves_any_path_and_adds_no_link(tmp_path):
    response = _call(tmp_path, {}, "/anything")
    assert response.get("objective") == LISTED["objective"]
    assert "projectUrl" not in response
