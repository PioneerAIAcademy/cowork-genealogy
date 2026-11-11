"""Direct tests for research's `attached-records-setup` validator (issue #3516).

Nothing under `validators/` is collected by `make harness-test`, so the check is
proven here in both directions (CLAUDE.md, "A new lint must be proven to fail").
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_attached_records_setup_order as check  # noqa: E402

TAGGED = {"tags": ["routing", "attached-records-setup"]}


def _call(name, prefix="mcp__genealogy__", **args):
    return {"tool": f"{prefix}{name}", "args": args}


EXTRACT = _call("extraction_append", projectPath="/p", personId="I1")
BUILD = _call("timeline_build", projectPath="/p", personId="I1")
CONTEXT = _call("project_context", projectPath="/p")


@pytest.mark.parametrize("prefix", [
    "mcp__genealogy__",
    "mcp__remote-devices__Genealogy_Research__",
    "mcp__Genealogy_Research__",
])
def test_passes_extract_then_build_under_every_spelling(prefix):
    check([CONTEXT, _call("extraction_append", prefix, personId="I1"),
           _call("timeline_build", prefix, personId="I1")], TAGGED)


def test_passes_with_other_calls_between_and_a_rerun():
    check([CONTEXT, EXTRACT, CONTEXT, BUILD, BUILD], TAGGED)


@pytest.mark.parametrize("calls", [
    [CONTEXT],
    [CONTEXT, BUILD],
    [CONTEXT, EXTRACT],
    [CONTEXT, BUILD, EXTRACT],
    [CONTEXT, _call("extraction_append", recordIds=["ark:/61903/1:1:MM8C-43Q"]), BUILD],
    [CONTEXT, _call("extraction_append", personId="  "), BUILD],
    [CONTEXT, _call("not_extraction_append", personId="I1"), BUILD],
], ids=["neither", "no-extract", "no-build", "reversed", "recordIds-mode", "blank-personId", "lookalike-name"])
def test_fires(calls):
    with pytest.raises(AssertionError):
        check(calls, TAGGED)


def _pair(pid):
    return (_call("extraction_append", projectPath="/p", personId=pid),
            _call("timeline_build", projectPath="/p", personId=pid))


@pytest.mark.parametrize("order", ["interleaved", "parallel"])
def test_passes_two_subjects_each_set_up(order):
    (e1, b1), (e2, b2) = _pair("I1"), _pair("I2")
    calls = [e1, b1, e2, b2] if order == "interleaved" else [e1, e2, b1, b2]
    check([CONTEXT, *calls], TAGGED)


@pytest.mark.parametrize("calls", [
    [_pair("I1")[0], _pair("I2")[0], _pair("I1")[1]],
    [_pair("I1")[0], _pair("I2")[1]],
    [_pair("I1")[0], _pair("I1")[1], _pair("I2")[1], _pair("I2")[0]],
], ids=["second-subject-never-built", "build-names-another-person", "second-subject-built-before-extract"])
def test_fires_per_subject(calls):
    with pytest.raises(AssertionError):
        check([CONTEXT, *calls], TAGGED)


def test_skips_untagged():
    with pytest.raises(pytest.skip.Exception):
        check([], {"tags": ["routing"]})
