"""Unit tests for the validate-schema script's results/ sidecar checks.

Covers validate_project.validate_results — the Part 1 additions from
docs/plan/research-log-result-retention.md: results_ref existence, the
log_id / filename match, D2 intra-payload consistency (returned_count vs
actual results length, the truncated-courier check), orphan sidecar
detection, and D5 record_persona_id resolution.

validate_project.py is a plugin skill script, not a harness module, so it
is loaded by path rather than imported as a package.
"""

import importlib.util
import json
import sys
from pathlib import Path

# Loading validate_project.py by path must not drop a __pycache__ into the
# plugin source tree (it ships in the packaged plugin) — suppress bytecode.
sys.dont_write_bytecode = True

_REPO = Path(__file__).resolve().parents[4]
_VP_PATH = _REPO / "plugin/skills/validate-schema/scripts/validate_project.py"
_spec = importlib.util.spec_from_file_location("validate_project", _VP_PATH)
validate_project = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(validate_project)


def _run(research, research_dir):
    """Run validate_results and return the list of error strings."""
    report = validate_project.ValidationReport()
    validate_project.validate_results(research, Path(research_dir), report)
    return report.errors


def _sidecar(log_id, returned_count, n_results, *, inner_log_id=None,
             tool="fulltext_search", persons=None):
    """Build a sidecar dict. persons, when given, is a list (per result) of
    person-id lists, attached as record_search-style gedcomx."""
    results = []
    for i in range(n_results):
        r = {"id": f"rec_{i}"}
        if persons is not None and i < len(persons):
            r["gedcomx"] = {"persons": [{"id": p} for p in persons[i]]}
        results.append(r)
    return {
        "log_id": log_id if inner_log_id is None else inner_log_id,
        "tool": tool,
        "retrieved": "2026-05-21T00:00:00Z",
        "returned_count": returned_count,
        "payload": {"results": results},
    }


def _write(results_dir, filename, sidecar):
    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / filename).write_text(json.dumps(sidecar))


def _log_entry(log_id, results_ref):
    return {"id": log_id, "results_ref": results_ref}


# --- happy path ---------------------------------------------------------


def test_well_formed_sidecar_passes(tmp_path):
    _write(tmp_path / "results", "log_001.json", _sidecar("log_001", 3, 3))
    research = {"log": [_log_entry("log_001", "results/log_001.json")],
                "assertions": []}
    assert _run(research, tmp_path) == []


def test_no_results_dir_is_clean(tmp_path):
    """A project that has done no payload searches validates fine — the
    results/ directory is simply absent."""
    research = {"log": [{"id": "log_001", "results_ref": None}],
                "assertions": []}
    assert _run(research, tmp_path) == []


# --- results_ref existence ----------------------------------------------


def test_dangling_results_ref_is_an_error(tmp_path):
    research = {"log": [_log_entry("log_001", "results/log_001.json")],
                "assertions": []}
    errors = _run(research, tmp_path)
    assert any("does not exist" in e for e in errors)


# --- D2 intra-payload consistency ---------------------------------------


def test_truncated_sidecar_is_caught(tmp_path):
    """returned_count 12 but only 9 results in payload — a truncated
    courier write. This is the D2 check exercised against a crafted bad
    fixture (the fidelity-failure path cannot be induced for real)."""
    _write(tmp_path / "results", "log_001.json", _sidecar("log_001", 12, 9))
    research = {"log": [_log_entry("log_001", "results/log_001.json")],
                "assertions": []}
    errors = _run(research, tmp_path)
    assert any("returned_count" in e and "truncated" in e for e in errors)


# --- log_id / filename match --------------------------------------------


def test_log_id_filename_mismatch_is_caught(tmp_path):
    _write(tmp_path / "results", "log_001.json",
           _sidecar("log_001", 1, 1, inner_log_id="log_999"))
    research = {"log": [_log_entry("log_001", "results/log_001.json")],
                "assertions": []}
    errors = _run(research, tmp_path)
    assert any("does not match" in e for e in errors)


# --- orphan sidecars ----------------------------------------------------


def test_orphan_sidecar_is_caught(tmp_path):
    """A results/ file that no log entry points at."""
    _write(tmp_path / "results", "log_888.json", _sidecar("log_888", 1, 1))
    research = {"log": [], "assertions": []}
    errors = _run(research, tmp_path)
    assert any("orphan" in e for e in errors)


# --- D5 record_persona_id resolution ------------------------------------


def test_record_persona_id_resolves(tmp_path):
    _write(tmp_path / "results", "log_001.json",
           _sidecar("log_001", 1, 1, tool="record_search",
                    persons=[["p_1", "p_2"]]))
    research = {
        "log": [_log_entry("log_001", "results/log_001.json")],
        "assertions": [{"id": "a_1", "log_entry_id": "log_001",
                        "record_persona_id": "p_1"}],
    }
    assert _run(research, tmp_path) == []


def test_dangling_record_persona_id_is_caught(tmp_path):
    _write(tmp_path / "results", "log_001.json",
           _sidecar("log_001", 1, 1, tool="record_search",
                    persons=[["p_1"]]))
    research = {
        "log": [_log_entry("log_001", "results/log_001.json")],
        "assertions": [{"id": "a_1", "log_entry_id": "log_001",
                        "record_persona_id": "p_NOPE"}],
    }
    errors = _run(research, tmp_path)
    assert any("does not resolve" in e for e in errors)


def test_record_persona_id_without_log_entry_is_caught(tmp_path):
    research = {
        "log": [],
        "assertions": [{"id": "a_1", "log_entry_id": None,
                        "record_persona_id": "p_1"}],
    }
    errors = _run(research, tmp_path)
    assert any("no log_entry_id" in e for e in errors)
