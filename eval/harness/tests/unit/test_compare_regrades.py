"""`scripts/compare_regrades.py` lines up judge scores across scratch passes."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import compare_regrades  # noqa: E402


def _pass(root: Path, name: str, score: int, *, extra: bool = False) -> Path:
    dims = [{"source": "base", "name": "Correctness", "score": score}]
    if extra:
        dims.append({"source": "rubric", "name": "Depth", "score": 3})
    log = {
        "skill": "demo",
        "tests": [{"test_id": "ut_demo_001", "runs": [{"run_index": 0, "judge": {"dimensions": dims}}]}],
    }
    d = root / name / "demo"
    d.mkdir(parents=True)
    (d / "v1.json").write_text(json.dumps(log), encoding="utf-8")
    return root / name


def test_compare_marks_a_moved_score_and_a_missing_dimension(tmp_path: Path) -> None:
    a = _pass(tmp_path, "readme-1", 3, extra=True)
    b = _pass(tmp_path, "brief-1", 2)
    names, rows = compare_regrades.compare([a, b])
    assert names == ["readme-1", "brief-1"]
    by_dim = {k[4]: scores for k, scores in rows}
    assert by_dim["Correctness"] == [3, 2]
    assert by_dim["Depth"] == [3, "-"]


def test_main_prints_only_differing_rows_by_default(tmp_path: Path, capsys) -> None:
    a = _pass(tmp_path, "readme-1", 3)
    b = _pass(tmp_path, "brief-1", 3)
    assert compare_regrades.main([str(a), str(b)]) == 0
    out = capsys.readouterr().out
    assert "0 of 1 dimension row(s) differ across 2 pass(es)." in out
    assert "ut_demo_001" not in out
