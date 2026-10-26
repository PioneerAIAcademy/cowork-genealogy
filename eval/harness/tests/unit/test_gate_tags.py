"""harness.gate_tags: which tags gate which validators (#3691 item 2)."""

from __future__ import annotations

import ast
from pathlib import Path

from harness.gate_tags import _gate_tags_in, file_gate_tags, validator_gate_tags

VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"

SOURCE = '''
import pytest

def _requires_trap(test):
    if "trap" not in (test.get("tags") or []):
        pytest.skip("no trap")

def test_plain(test):
    if "plain" not in test.get("tags", []):
        pytest.skip("x")

def test_compound(test):
    if test.get("type") != "positive" and "compound" not in test.get("tags", []):
        pytest.skip("x")

def test_exclusion(test):
    if "excluded" in test.get("tags", []):
        pytest.skip("x")

def test_ungated(test):
    assert True

def test_via_helper(test):
    _requires_trap(test)

def report_only(test):
    if "reported" not in test.get("tags", []):
        pytest.skip("x")
'''


def test_per_validator_map():
    assert validator_gate_tags(SOURCE) == {
        "test_plain": {"plain"},
        "test_compound": {"compound"},
        "test_exclusion": set(),
        "test_ungated": set(),
        "test_via_helper": {"trap"},
    }


def test_file_view_counts_every_gate_including_report_functions():
    assert file_gate_tags(SOURCE) == {"plain", "compound", "trap", "reported"}


def test_star_import_resolves_through_the_sibling_callback():
    sibling = {"shared": 'import pytest\ndef test_shared(test):\n    if "s" not in test.get("tags", []):\n        pytest.skip("x")\n'}
    source = "from shared import *\nfrom missing import *\ndef test_local(test):\n    pass\n"
    assert validator_gate_tags(source, sibling=sibling.get) == {
        "test_shared": {"s"},
        "test_local": set(),
    }


def test_unparseable_or_absent_source_is_empty():
    assert validator_gate_tags("def (") == {}
    assert validator_gate_tags(None) == {}
    assert file_gate_tags("def (") == set()
    assert file_gate_tags(None) == set()


def test_per_validator_view_covers_every_file_tag_but_report_only_ones():
    """Rule 11 reads the per-validator view; the runnability gate reads the
    file view. A gate shape the per-validator view cannot attribute must fail
    here, not silently shrink what rule 11 checks."""
    def sibling(name):
        path = VALIDATORS_DIR / f"{name}.py"
        return path.read_text(encoding="utf-8") if path.is_file() else None

    files = sorted(VALIDATORS_DIR.glob("test_*.py"))
    assert len(files) > 20
    gaps = {}
    for path in files:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        report_only = set()
        elsewhere = set()
        for stmt in tree.body:
            is_report = isinstance(stmt, ast.FunctionDef) and stmt.name.startswith("report_")
            (report_only if is_report else elsewhere).update(_gate_tags_in(stmt))
        expected = file_gate_tags(source) - (report_only - elsewhere)
        mapped = set().union(*validator_gate_tags(source, sibling=sibling).values())
        if expected - mapped:
            gaps[path.name] = sorted(expected - mapped)
    assert not gaps, gaps
