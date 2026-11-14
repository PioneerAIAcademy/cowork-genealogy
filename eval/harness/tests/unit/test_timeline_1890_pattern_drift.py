"""`test_us_1890_never_expected` (validators/test_timeline.py) replays the
engine's `timelineCensus1890Invariants` attribution with Python copies of its
regexes. This pins each copy to the TypeScript literal it mirrors, so an edit to
either side fails here instead of letting the two readings drift apart."""

import re
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS / "validators"))

import test_timeline as validator  # noqa: E402

_ENGINE = _HARNESS.parents[1] / "packages" / "engine" / "mcp-server" / "src" / "tools" / "research-append.ts"

# Python name -> the engine constant it mirrors.
PAIRS = {
    "_NAMES_US_RE": "TIMELINE_NAMES_US_RE",
    "_NAMES_US_ABBREV_RE": "TIMELINE_NAMES_US_ABBREV_RE",
    "_VETERAN_RE": "TIMELINE_VETERAN_RE",
    "_1890_RE": "TIMELINE_1890_RE",
    "_NAMES_OTHER_JURISDICTION_RE": "TIMELINE_NAMES_OTHER_JURISDICTION_RE",
}


def _ts_literal(source: str, name: str) -> tuple[str, str]:
    """The pattern and flags of `const NAME = /pattern/flags;` (the literal may
    start on the next line)."""
    m = re.search(rf"const {name} =\s*/(.+?)/([a-z]*);\s*$", source, re.MULTILINE)
    if not m:
        raise AssertionError(f"{name} is no longer a regex literal in {_ENGINE.name}")
    return m.group(1), m.group(2)


@pytest.mark.parametrize("py_name,ts_name", sorted(PAIRS.items()))
def test_python_copy_matches_the_engine_literal(py_name, ts_name):
    source = _ENGINE.read_text(encoding="utf-8")
    pattern, flags = _ts_literal(source, ts_name)
    py = getattr(validator, py_name)
    assert py.pattern == pattern, f"{py_name} drifted from {ts_name}:\n  python: {py.pattern}\n  engine: {pattern}"
    assert bool(py.flags & re.IGNORECASE) == ("i" in flags), f"{py_name} and {ts_name} disagree on case-insensitivity"


def test_the_drift_check_fails_on_a_changed_literal():
    source = _ENGINE.read_text(encoding="utf-8").replace("const TIMELINE_VETERAN_RE = /veteran/i;", "const TIMELINE_VETERAN_RE = /veterans?/i;")
    pattern, _ = _ts_literal(source, "TIMELINE_VETERAN_RE")
    assert pattern != validator._VETERAN_RE.pattern


def test_the_drift_check_reads_a_literal_split_across_lines():
    pattern, flags = _ts_literal("const X_RE =\n  /a|b/i;\n", "X_RE")
    assert (pattern, flags) == ("a|b", "i")
