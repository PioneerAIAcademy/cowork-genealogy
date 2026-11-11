"""A test that serves a hosted `project_list` answer gets a hosted store: project tools
refuse any `projectPath` the listing does not name, and `project_context` at a listed
project carries that project's `projectUrl` and `uploadUrl` (`mock_mcp._hosted_store`)."""
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
    return _read(tmp_path, manifest, path)


def _read(tmp_path, manifest, path):
    log: list = []
    handler = mock_mcp._make_live_handler("project_context", tmp_path, log, manifest)
    asyncio.run(handler({"projectPath": path}))
    return log[-1]["response"]


def _hosted():
    return {"project_list": {"predicated": [({}, LISTING["response"], "project-list-hosted-flynn")]}}


UPLOAD_URL = "https://genealogy.example.org/#/p/proj_3f9a1c2e7b4d6a80/upload"


def _hosted_with(**links):
    """The Flynn listing with its project's links replaced by `links`."""
    project = {k: v for k, v in LISTED.items() if k != "projectUrl"} | links
    listing = {**LISTING["response"], "projects": [project]}
    return {"project_list": {"predicated": [({}, listing, "throwaway")]}}


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


def test_a_listed_path_with_an_upload_link_carries_it(tmp_path):
    manifest = _hosted_with(projectUrl=LISTED["projectUrl"], uploadUrl=UPLOAD_URL)
    response = _call(tmp_path, manifest, LISTED["projectPath"])
    assert response.get("uploadUrl") == UPLOAD_URL
    assert response.get("projectUrl") == LISTED["projectUrl"]


def test_a_listed_path_with_no_upload_link_carries_none(tmp_path):
    response = _call(tmp_path, _hosted(), LISTED["projectPath"])
    assert response.get("ok") is True
    assert "uploadUrl" not in response


def test_a_listing_with_only_an_upload_link_adds_no_project_link(tmp_path):
    response = _call(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), LISTED["projectPath"])
    assert response.get("uploadUrl") == UPLOAD_URL
    assert "projectUrl" not in response


def test_the_upload_link_does_not_wait_on_an_objective(tmp_path):
    shutil.copy(SCENARIO / "tree.gedcomx.json", tmp_path / "tree.gedcomx.json")
    research = json.loads((SCENARIO / "research.json").read_text(encoding="utf-8"))
    research["project"]["objective"] = ""
    (tmp_path / "research.json").write_bytes(json.dumps(research).encode("utf-8"))
    manifest = _hosted_with(projectUrl=LISTED["projectUrl"], uploadUrl=UPLOAD_URL)
    response = _read(tmp_path, manifest, LISTED["projectPath"])
    assert response.get("ok") is True
    assert not response.get("objective")
    assert response.get("uploadUrl") == UPLOAD_URL
    assert "projectUrl" not in response


def test_an_unlisted_path_gets_no_upload_link(tmp_path):
    response = _call(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), str(tmp_path))
    assert response.get("ok") is False
    assert "uploadUrl" not in response


def test_a_listed_path_holding_no_project_gets_no_upload_link(tmp_path):
    response = _read(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), LISTED["projectPath"])
    assert response.get("ok") is False
    assert response.get("reason") == "no_project"
    assert "uploadUrl" not in response
