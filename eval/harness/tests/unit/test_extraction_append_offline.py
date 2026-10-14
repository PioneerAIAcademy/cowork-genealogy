"""Every extraction-append test, graded offline: no model, the real code path.

The suite's skill makes one `extraction_append` call with the record ids the
message names, and everything after that is code. So the classification
verdict a paid run reaches is reachable here for free: serve the test's
`record_read` fixtures through the mock, call the tool the way the skill does,
and apply the same `test_expected_classifications` validator the run applies.

A red here means the extraction table and the test's expected rows disagree,
which is a genealogy question, not a prompt one. It is also what a paid run
would have reported, minus the cost.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import sys
from pathlib import Path

import pytest

from harness.mock_mcp import create_mock_server

REPO_ROOT = Path(__file__).resolve().parents[4]
SUITE = REPO_ROOT / "eval/tests/unit/extraction-append"
FIXTURES_DIR = REPO_ROOT / "eval/fixtures/mcp"
SCENARIOS_DIR = REPO_ROOT / "eval/fixtures/scenarios"

sys.path.insert(0, str(REPO_ROOT / "eval/harness/validators"))
from extraction_validators import test_expected_classifications as check_classifications  # noqa: E402


def _tests() -> list[Path]:
    return sorted(p for p in SUITE.glob("*.json")) if SUITE.is_dir() else []


def _record_ids(test: dict) -> list[str]:
    ids = []
    for name in test.get("mcp_fixtures") or []:
        fx = json.loads((FIXTURES_DIR / f"{name}.json").read_text(encoding="utf-8"))
        if fx.get("tool") == "record_read":
            ids.append(fx["args"]["recordId"].lstrip("~"))
    return ids


def _call(test: dict, workspace: Path) -> dict:
    args = {"projectPath": str(workspace), "recordIds": _record_ids(test)}
    _s, _c, tools = create_mock_server(test.get("mcp_fixtures") or [], FIXTURES_DIR, workspace=workspace)
    out = asyncio.run(tools["extraction_append"].handler(args))
    return json.loads(out["content"][0]["text"])


def test_the_suite_is_not_empty_once_it_exists():
    if SUITE.is_dir():
        assert _tests(), f"{SUITE} holds no tests, so every case below is vacuous"


@pytest.mark.requires_engine_build
@pytest.mark.parametrize("path", _tests(), ids=lambda p: p.stem)
def test_expected_classifications_hold_offline(path: Path, tmp_path: Path):
    test = json.loads(path.read_text(encoding="utf-8"))
    if not _record_ids(test):
        pytest.skip("no record_read fixture: this test does not extract a record")
    for name in ("research.json", "tree.gedcomx.json"):
        shutil.copy(SCENARIOS_DIR / test["input"]["scenario"] / name, tmp_path / name)
    before = {"research_json": json.loads((tmp_path / "research.json").read_text(encoding="utf-8"))}

    out = _call(test, tmp_path)
    assert out.get("ok"), out
    assert all(r["status"] == "extracted" for r in out["records"]), out["records"]

    after = {"research_json": json.loads((tmp_path / "research.json").read_text(encoding="utf-8"))}
    if not test.get("expected_classifications"):
        pytest.skip("no expected_classifications to check")
    check_classifications(before, after, {**test["test"], "expected_classifications": test["expected_classifications"]})
