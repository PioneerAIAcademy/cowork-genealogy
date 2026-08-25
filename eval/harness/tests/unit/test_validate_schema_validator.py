"""Direct tests for the validate-schema read-only-files validator.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test` and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

What it guards: `validate-schema` is read-only for EVERY file. The existing
`test_does_not_modify_project_files` covers research.json and tree.gedcomx.json;
`test_does_not_modify_sidecars_or_other_files` covers the `files` map —
`results/*.json` sidecars and anything else — which that check never inspects
(e.g. the skill "fixing" the bad sidecar in ut_validate_schema_009 instead of
reporting it).
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_validate_schema import (  # noqa: E402
    test_does_not_modify_sidecars_or_other_files as check,
)

POSITIVE = {"type": "positive"}
NEGATIVE = {"type": "negative"}


def state(files):
    """A snapshot-shaped state whose `files` map is {rel_path: content}."""
    return {"research_json": {}, "tree_gedcomx_json": None, "files": files}


def test_unchanged_files_pass():
    """Read-only run: the files map is identical before and after."""
    files = {"results/log_001.json": '{"returned_count": 2}', "notes.md": "x"}
    check(state(files), state(dict(files)), POSITIVE)


def test_modified_sidecar_fails():
    """The skill 'fixed' a results/ sidecar instead of reporting the error."""
    before = state({"results/log_001.json": '{"returned_count": 5}'})
    after = state({"results/log_001.json": '{"returned_count": 2}'})
    with pytest.raises(AssertionError) as e:
        check(before, after, POSITIVE)
    assert "modified" in str(e.value)


def test_added_file_fails():
    """The skill wrote a new file."""
    before = state({})
    after = state({"results/log_002.json": "{}"})
    with pytest.raises(AssertionError) as e:
        check(before, after, POSITIVE)
    assert "added" in str(e.value)


def test_removed_file_fails():
    """The skill deleted a file."""
    before = state({"notes.md": "x"})
    after = state({})
    with pytest.raises(AssertionError) as e:
        check(before, after, POSITIVE)
    assert "removed" in str(e.value)


def test_negative_test_skips():
    """Negative tests don't run the skill body — the check is not applicable
    and must skip rather than fail on unrelated state."""
    before = state({"results/log_001.json": "a"})
    after = state({"results/log_001.json": "b"})  # would fail if not skipped
    with pytest.raises(pytest.skip.Exception):
        check(before, after, NEGATIVE)


def test_main_json_edits_are_not_this_validators_job():
    """research.json / tree.gedcomx.json live in their own snapshot keys, not
    the `files` map, so this validator ignores them — that protection stays
    with `test_does_not_modify_project_files`, unweakened."""
    before = state({})
    before["research_json"] = {"a": 1}
    after = state({})
    after["research_json"] = {"a": 2}  # a main-file edit
    check(before, after, POSITIVE)  # passes here; the other validator catches it
