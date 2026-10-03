"""The record-structurer suite's validators, proven in both directions offline.

For each test, `data/record_structurer_documents.json` holds the document a
correct agent sends. Run through the real `documents` path, with the summary as
the reply (a correct agent returns it verbatim), every validator in
`test_record_structurer.py` and the test's `expected_classifications` must pass.
Then each document is broken the way its test guards against, and that test's
own validator must fail. A validator a correct run cannot pass, or a wrong one
cannot fail, grades nothing.
"""

from __future__ import annotations

import asyncio
import copy
import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

from harness.mock_mcp import create_mock_server

REPO_ROOT = Path(__file__).resolve().parents[4]
SUITE = REPO_ROOT / "eval/tests/unit/record-structurer"
VALIDATORS = REPO_ROOT / "eval/harness/validators"
DOCS = json.loads((Path(__file__).parent / "data/record_structurer_documents.json").read_text(encoding="utf-8"))


def _module():
    sys.path.insert(0, str(VALIDATORS))
    spec = importlib.util.spec_from_file_location("rs_validators", VALIDATORS / "test_record_structurer.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


V = _module()


def _run(name: str, document: dict, tmp_path: Path):
    test = json.loads((SUITE / f"{name}.json").read_text(encoding="utf-8"))
    for f in ("research.json", "tree.gedcomx.json"):
        shutil.copy(REPO_ROOT / "eval/fixtures/scenarios" / test["input"]["scenario"] / f, tmp_path / f)
    read = lambda: {"research_json": json.loads((tmp_path / "research.json").read_text(encoding="utf-8"))}  # noqa: E731
    before = read()
    _s, _c, tools = create_mock_server([], REPO_ROOT / "eval/fixtures/mcp", workspace=tmp_path)
    out = json.loads(asyncio.run(tools["extraction_append"].handler({"projectPath": str(tmp_path), "documents": [document]}))["content"][0]["text"])
    assert out.get("ok"), out
    return test, before, read(), "\n\n".join(r["summary"] for r in out["records"])


def _check(fn, test, before, after, reply):
    kwargs = {"before_state": before, "after_state": after, "text_response": reply, "test": {**test["test"], "expected_classifications": test.get("expected_classifications", [])}}
    import inspect

    fn(**{k: v for k, v in kwargs.items() if k in inspect.signature(fn).parameters})


SUITE_VALIDATORS = [
    V.test_obituary_parentheticals_are_read_as_their_convention,
    V.test_directive_text_in_a_record_is_data,
    V.test_a_doubted_name_is_recorded_as_doubted,
    V.test_an_old_style_date_raises_the_calendar_flag,
    V.test_expected_classifications,
    V.test_new_assertions_have_required_classification,
    V.test_name_value_is_a_bare_name,
]


def test_every_suite_test_has_a_correct_document():
    assert sorted(p.stem for p in SUITE.glob("*.json")) == sorted(DOCS)


@pytest.mark.requires_engine_build
@pytest.mark.parametrize("name", sorted(DOCS))
def test_a_correct_document_passes_every_validator(name, tmp_path):
    test, before, after, reply = _run(name, DOCS[name], tmp_path)
    for fn in SUITE_VALIDATORS:
        try:
            _check(fn, test, before, after, reply)
        except pytest.skip.Exception:
            pass


def _break_obituary(d):
    for p in d["document"]["persons"]:
        if p["names"][0]["given"] == "Linda" and p["names"][0]["surname"] == "Whitaker":
            p["statedRelation"] = "daughter"


def _break_directive(d):
    for f in d["document"]["persons"][0]["facts"]:
        f.pop("note", None)


def _break_suspect(d):
    father = d["document"]["persons"][1]["names"][0]
    father["surname"] = "Nadnesen"
    father.pop("note", None)
    father.pop("uncertain", None)


def _break_probate(d):
    # The court's proof is left out: the clerk's row has nothing to land on.
    p1 = d["document"]["persons"][0]
    p1["facts"] = [f for f in p1["facts"] if f["type"] != "probate"]


def _break_wedding(d):
    # The parent links are left out, so neither father is named by side.
    d["document"]["relationships"] = [r for r in d["document"]["relationships"] if r["type"] != "parent_child"]


BREAKS = {
    "obituary-inlaw-vs-child-and-neighbor": (_break_obituary, V.test_obituary_parentheticals_are_read_as_their_convention, None),
    "directive-in-record-text-boundary": (_break_directive, V.test_directive_text_in_a_record_is_data, None),
    "suspect-required-name-confirm-via-image": (_break_suspect, V.test_a_doubted_name_is_recorded_as_doubted, None),
    # The calendar line is code's; what a wrong run does is drop it from the reply.
    "old-style-date-routes-to-convert-dates": (lambda d: None, V.test_an_old_style_date_raises_the_calendar_flag, lambda r: r.split("\nCalendar:")[0]),
    "probate-will-and-court-acts": (_break_probate, V.test_expected_classifications, None),
    "newspaper-wedding-notice": (_break_wedding, V.test_expected_classifications, None),
}


@pytest.mark.requires_engine_build
@pytest.mark.parametrize("name", sorted(BREAKS))
def test_the_failure_each_test_guards_against_is_caught(name, tmp_path):
    breaker, validator, reply_edit = BREAKS[name]
    doc = copy.deepcopy(DOCS[name])
    breaker(doc)
    test, before, after, reply = _run(name, doc, tmp_path)
    if reply_edit:
        reply = reply_edit(reply)
    with pytest.raises(AssertionError):
        _check(validator, test, before, after, reply)
