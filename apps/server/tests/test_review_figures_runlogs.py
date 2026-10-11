"""U22: dev/review_figures_runlogs.py counts the report's figures by its written rules.

Synthetic run logs only; the recorded figures themselves are reproduced against the
committed corpus at their commits (the script's docstring says how).
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("review_figures_runlogs", SERVER / "dev" / "review_figures_runlogs.py")
rf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rf)


def _write(root: Path, fixture: str, ts: str, log: dict) -> None:
    d = root / "eval" / "runlogs" / "e2e" / fixture
    d.mkdir(parents=True, exist_ok=True)
    (d / f"run-{ts}.json").write_text(json.dumps(log), encoding="utf-8")


def _runs(tmp_path: Path, *logs: dict):
    for i, log in enumerate(logs):
        _write(tmp_path, f"fx{i}", f"2026-09-0{i + 1}_00-00-00", log)
    # Sidecars beside a run log are not run logs.
    _write(tmp_path, "fx0", "2026-09-01_00-00-00.ann", {"tool_calls": [{"tool": "Read", "args": {}}]})
    return rf.load_runs(str(tmp_path))


def test_checkpoint_pairs_fifo_and_segments_start_on_launch_rows_only(tmp_path):
    tl = [
        [0.0, "system:init", []],
        [10.0, "assistant", ["Skill:research-plan"]],
        [10.1, "tool_result", ["Skill:research-plan"]],
        [20.0, "assistant", ["record_read"]],
        [21.0, "assistant", ["record_read"]],
        [25.0, "tool_result", ["record_read"]],
        [2000.0, "tool_result", ["record_read"]],
        [2100.0, "assistant", ["Agent"]],
        [2500.0, "tool_result", ["Agent"]],
        [2600.0, "assistant", []],
    ]
    two_element = {"usage": {"timeline": [[0.0, "assistant"], [9999.0, "tool_result"]]}}
    r = rf.checkpoint(_runs(tmp_path, {"usage": {"timeline": tl}}, two_element))

    assert (r["runs"], r["fixtures"], r["instrumented"]) == (2, 2, 1)
    assert (r["calls"], r["unpaired_results"]) == (4, 0)
    # FIFO: 25-20=5 and 2000-21=1979. LIFO would give 4 and 1980.
    assert r["calls_over"] == 1 and r["longest_call"] == (1979.0, "record_read")
    assert r["longest_delegation"] == (400.0, "Agent")
    # Starts at 10 (Skill) and 2100 (Agent) only, not at their tool_result rows;
    # the last segment ends at the last timeline event (2600).
    assert r["segments"] == 2 and r["seg_over"] == [2090.0] and r["seg_max"] == 2090.0
    assert r["seg_median"] == 500.0  # 2100 -> 2600, the run's last event


def test_nearest_rank_percentile():
    vals = list(range(1, 101))
    assert rf.nearest_rank(vals, 0.99) == 99 and rf.nearest_rank(vals, 0.5) == 50
    assert rf.nearest_rank([7.0], 0.99) == 7.0
    # Where the methods split: floor-index gives 9, linear interpolation 9.55.
    assert rf.nearest_rank(list(range(1, 11)), 0.95) == 10


def test_external_counts_the_named_set_under_any_server_spelling(tmp_path):
    calls = [
        {"tool": "mcp__genealogy__record_read"},
        {"tool": "mcp__remote-devices__Genealogy_Research__image_transcribe"},
        {"tool": "mcp__genealogy__collections_search"},  # FamilySearch-curated: not external
        {"tool": "mcp__genealogy__research_append"},
        {"tool": "wiki_place_page"},  # no server prefix: never reached the server
        {"tool": "WebFetch"},
        {"tool": "Read"},
    ]
    r = rf.external(_runs(tmp_path, {"tool_calls": calls}))
    assert (r["calls"], r["mcp_calls"], r["external"], r["external_mcp"]) == (7, 4, 3, 2)
    assert dict(r["per_tool"]) == {"record_read": 1, "image_transcribe": 1, "WebFetch": 1}


def test_spill_normalises_separators_and_counts_fs_ops(tmp_path):
    spill_win = r"C:\Users\x\.claude\projects\k\s\tool-results\abc.txt"
    calls = [
        {"tool": "Read", "args": {"file_path": "/home/x/.claude/projects/k/s/tool-results/a.txt"}},
        {"tool": "Read", "args": {"file_path": spill_win}},
        {"tool": "Read", "args": {"file_path": "/p/research.json"}},
        {"tool": "Grep", "args": {"path": "/home/x/.claude/projects/k/s/tool-results/a.txt"}},  # an op, not a read
        {"tool": "Glob", "args": {}},
        {"tool": "Write", "args": {}},
        {"tool": "Edit", "args": {}},
        {"tool": "Bash", "args": {"command": "cat /tmp/claude-resume-1/x"}},  # not an fs op
    ]
    r = rf.spill(_runs(tmp_path, {"tool_calls": calls}, {"tool_calls": [{"tool": "Read", "args": {"file_path": "/a"}}]}))
    assert (r["fs_ops"], r["reads"], r["spill_reads"], r["spill_reads_posix_only"]) == (8, 4, 2, 1)
    assert (r["runs"], r["runs_with_spill"], r["claude_resume_paths"]) == (2, 1, 1)
