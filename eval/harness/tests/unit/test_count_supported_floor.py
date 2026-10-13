"""count_supported_floor's op walk reads all of eval/runlogs/, so it must skip
`unit-pg/` — `--store pg` re-runs of tests the corpus already holds (U15) —
or each of their promote ops is counted twice."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "count_supported_floor.py"


def _load():
    spec = importlib.util.spec_from_file_location("count_supported_floor", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _log_with_one_promote() -> dict:
    return {"tests": [{"runs": [{"output": {"tool_calls": [{
        "tool": "mcp__genealogy__research_append",
        "args": {"ops": [{"section": "hypotheses", "op": "append", "entry": {"id": "h_001", "status": "supported"}}]},
        "response": {"ok": True},
    }]}}]}]}


def test_the_op_walk_skips_unit_pg(tmp_path, monkeypatch, capsys):
    mod = _load()
    for sub in ("unit/skill-a", "unit-pg/skill-a"):
        d = tmp_path / sub
        d.mkdir(parents=True)
        (d / "v1.json" if sub.startswith("unit/") else d / "scratch_2026-10-12_00-00-00.json").write_text(
            json.dumps(_log_with_one_promote()), encoding="utf-8"
        )
    monkeypatch.setattr(mod, "RUNLOGS", tmp_path)
    mod.run_ops(include_quarantine=False)
    out = capsys.readouterr().out
    assert "run logs scanned: 1" in out
    assert "ops setting status=supported: 1  in 1 run logs" in out
    assert mod.is_store_rerun(tmp_path / "unit-pg" / "x" / "y.json")
    assert not mod.is_store_rerun(tmp_path / "unit" / "unit-pg-lookalike" / "y.json")
