"""A test that serves a hosted `project_list` answer gets a hosted store: project tools
refuse any `projectPath` the listing does not name, `project_context` at a listed
project carries that project's `uploadUrl` (`mock_mcp._hosted_store`), and `show_project`,
a connector-only tool, is served there and nowhere else."""
import asyncio
import json
import shutil
from pathlib import Path

import pytest

from harness import mock_mcp

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "mcp"

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
    project = dict(LISTED) | links
    listing = {**LISTING["response"], "projects": [project]}
    return {"project_list": {"predicated": [({}, listing, "throwaway")]}}


def test_a_listed_path_reads_the_project_and_adds_no_project_link(tmp_path):
    response = _call(tmp_path, _hosted(), LISTED["projectPath"])
    assert response.get("objective") == LISTED["objective"]
    assert "projectUrl" not in response


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
    response = _call(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), LISTED["projectPath"])
    assert response.get("uploadUrl") == UPLOAD_URL


def _with_uploads(tmp_path):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    for name in ("census.pdf", "census.pdf.txt", "page.png", "notes.txt"):
        (uploads / name).write_text("x", encoding="utf-8")


def test_a_hosted_project_says_its_uploads_are_stored_and_how_to_read_each(tmp_path):
    """The compiled tool ran on the file store and answered "files"; the mock adds
    the hosted link afterwards and must restate the read plan to match it."""
    _with_uploads(tmp_path)
    response = _call(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), LISTED["projectPath"])
    assert response.get("uploadsAre") == "stored"
    assert {u["name"]: (u.get("readWith"), u.get("ref")) for u in response["uploads"]} == {
        "census.pdf": ("sidecar_read", "uploads/census.pdf.txt"),
        "page.png": ("image_transcribe", None),
        "notes.txt": ("sidecar_read", "uploads/notes.txt"),
    }


def test_a_project_with_no_upload_link_says_its_uploads_are_files(tmp_path):
    _with_uploads(tmp_path)
    response = _call(tmp_path, _hosted(), LISTED["projectPath"])
    assert response.get("uploadsAre") == "files"
    assert all("readWith" not in u for u in response["uploads"])


def test_a_listed_path_with_no_upload_link_carries_none(tmp_path):
    response = _call(tmp_path, _hosted(), LISTED["projectPath"])
    assert response.get("ok") is True
    assert "uploadUrl" not in response


def test_the_upload_link_does_not_wait_on_an_objective(tmp_path):
    shutil.copy(SCENARIO / "tree.gedcomx.json", tmp_path / "tree.gedcomx.json")
    research = json.loads((SCENARIO / "research.json").read_text(encoding="utf-8"))
    research["project"]["objective"] = ""
    (tmp_path / "research.json").write_bytes(json.dumps(research).encode("utf-8"))
    response = _read(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), LISTED["projectPath"])
    assert response.get("ok") is True
    assert not response.get("objective")
    assert response.get("uploadUrl") == UPLOAD_URL


def test_an_unlisted_path_gets_no_upload_link(tmp_path):
    response = _call(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), str(tmp_path))
    assert response.get("ok") is False
    assert "uploadUrl" not in response


def test_a_listed_path_holding_no_project_gets_no_upload_link(tmp_path):
    response = _read(tmp_path, _hosted_with(uploadUrl=UPLOAD_URL), LISTED["projectPath"])
    assert response.get("ok") is False
    assert response.get("reason") == "no_project"
    assert "uploadUrl" not in response


def _tools(fixtures, tmp_path):
    _server, log, tools = mock_mcp.create_mock_server(fixtures, FIXTURES, workspace=tmp_path)
    return log, tools


def _show(tools, args):
    result = asyncio.run(tools["show_project"].handler(args))
    return result["content"][0]["text"], bool(result.get("is_error"))


def test_show_project_is_served_on_a_hosted_test_only(tmp_path):
    _log, hosted = _tools(["project-list-hosted-flynn"], tmp_path)
    assert "show_project" in hosted
    _log, folder = _tools([], tmp_path)
    assert "show_project" not in folder


def test_show_project_draws_a_listed_card_at_a_listed_path(tmp_path):
    log, tools = _tools(["project-list-hosted-flynn"], tmp_path)
    for show in ("setup", "question", "plan", "assess", "latest", "file"):
        text, is_error = _show(tools, {"projectPath": LISTED["projectPath"], "show": show, "questionId": "q_001"})
        assert (text, is_error) == (f"The researcher sees the {show} card; do not restate it.", False)
    assert log[-1]["tool"] == "mcp__genealogy__show_project"


def test_show_project_refuses_what_the_connector_refuses(tmp_path):
    _log, tools = _tools(["project-list-hosted-flynn"], tmp_path)
    path = LISTED["projectPath"]
    text, is_error = _show(tools, {"projectPath": path, "show": "timeline"})
    assert is_error and text.startswith("show must be one of: setup, question, plan,")
    text, is_error = _show(tools, {"projectPath": path, "show": "file", "page": "nowhere"})
    assert is_error and text.startswith("page must be one of:")
    text, is_error = _show(tools, {"projectPath": path, "show": "setup", "colour": "red"})
    assert is_error and text.startswith("show_project has no argument colour.")
    text, is_error = _show(tools, {"projectPath": path, "show": "setup", "questionId": 1})
    assert (text, is_error) == ("questionId must be a string.", True)
    text, is_error = _show(tools, {"show": "setup"})
    assert is_error and text.startswith("This call named no project.")
    text, is_error = _show(tools, {"projectPath": "/proj_0000000000000000", "show": "setup"})
    assert is_error and text.startswith("No project is saved at this projectPath.")
