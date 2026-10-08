"""The eval mock refuses a staged ref the workspace does not hold, as production does.

`record_read` and `rank_search_matches` are fixture-backed, so before this check
a canned answer came back whatever ref the call carried: a mis-copied ref read as
a success in a unit run and a refusal in production (`search-records` v2,
`ut_search_records_nickname_bitsie_in_record`). The check runs the COMPILED
`readStagedResults`, so a near-copy resolves exactly as production resolves it.
"""

import asyncio
import json
from pathlib import Path

import pytest

from harness.mock_mcp import create_mock_server

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "mcp"
FIXTURE = "record-read-mary-flynn-9xkd-r7m"
GOOD = "results/.staging/5d2c3a10-7c1e-4d55-a1b2-9824099a7245.json"


def _read(tmp_path: Path, args: dict) -> dict:
    _server, _log, tools = create_mock_server([FIXTURE], FIXTURES_DIR, workspace=tmp_path)
    out = asyncio.run(tools["record_read"].handler(args))
    return json.loads(out["content"][0]["text"])


def _stage(tmp_path: Path) -> None:
    (tmp_path / "results" / ".staging").mkdir(parents=True)
    (tmp_path / GOOD).write_text(
        json.dumps({"tool": "record_search", "payload": {"results": [{"recordId": "~9XKD-R7M"}]}}),
        encoding="utf-8",
    )


@pytest.mark.requires_engine_build
def test_a_ref_to_nothing_is_refused_not_answered_from_the_fixture(tmp_path):
    _stage(tmp_path)
    out = _read(tmp_path, {
        "recordId": "~9XKD-R7M", "projectPath": str(tmp_path),
        "resultsRef": "results/.staging/00000000-0000-4000-8000-000000000000.json",
    })
    assert out["error"] == "staged_ref_not_found"
    assert "does not exist" in out["message"]


@pytest.mark.requires_engine_build
def test_a_near_copy_reads_through_as_production_resolves_it(tmp_path):
    _stage(tmp_path)
    out = _read(tmp_path, {
        "recordId": "~9XKD-R7M", "projectPath": str(tmp_path),
        "resultsRef": "results/.staging/5d2c3a10-7c1e-4d55-a1b2-9824097a7245.json",
    })
    assert "error" not in out


@pytest.mark.requires_engine_build
def test_a_call_with_no_ref_is_answered_from_the_fixture_as_before(tmp_path):
    out = _read(tmp_path, {"recordId": "~9XKD-R7M"})
    assert "error" not in out


def test_an_exact_ref_is_answered_without_running_node(tmp_path, monkeypatch):
    import harness.mock_mcp as mock

    calls = []
    real = mock._run_node_eval

    def counted(*a, **k):
        calls.append(a)
        return real(*a, **k)

    monkeypatch.setattr(mock, "_run_node_eval", counted)
    _stage(tmp_path)
    for ref in (GOOD, str(tmp_path / GOOD)):
        out = _read(tmp_path, {"recordId": "~9XKD-R7M", "projectPath": str(tmp_path), "resultsRef": ref})
        assert "error" not in out
    assert calls == []
