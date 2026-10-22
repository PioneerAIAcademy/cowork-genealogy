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


def _docs(document) -> list:
    """A suite entry is one document, or a list for a batch test."""
    return document if isinstance(document, list) else [document]


def _run(name: str, document, tmp_path: Path):
    test = json.loads((SUITE / f"{name}.json").read_text(encoding="utf-8"))
    for f in ("research.json", "tree.gedcomx.json"):
        shutil.copy(REPO_ROOT / "eval/fixtures/scenarios" / test["input"]["scenario"] / f, tmp_path / f)
    read = lambda: {"research_json": json.loads((tmp_path / "research.json").read_text(encoding="utf-8"))}  # noqa: E731
    before = read()
    _s, _c, tools = create_mock_server([], REPO_ROOT / "eval/fixtures/mcp", workspace=tmp_path)
    out = json.loads(asyncio.run(tools["extraction_append"].handler({"projectPath": str(tmp_path), "documents": _docs(document)}))["content"][0]["text"])
    assert out.get("ok"), out
    return test, before, read(), "\n\n".join(r["summary"] for r in out["records"])


def _check(fn, test, before, after, reply, document=None):
    """`document` is the one the agent sent: the validators that read what was
    sent see it as the `extraction_append` call a real run records."""
    tool_calls = [{"tool": "mcp__genealogy__extraction_append", "args": {"documents": _docs(document)}}] if document else []
    validator_test = {**test["test"], "delegation": test["input"].get("delegation"), "expected_classifications": test.get("expected_classifications", [])}
    kwargs = {"before_state": before, "after_state": after, "text_response": reply, "tool_calls": tool_calls, "agent_returns": [{"subagent_type": "record-structurer", "text": reply}], "test": validator_test}
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
    V.test_document_record_ids_were_delegated,
    V.test_value_holds_no_derivation,
    V.test_census_households_are_kept_apart,
    V.test_a_batch_is_written_in_one_call,
]


def test_every_suite_test_has_a_correct_document():
    assert sorted(p.stem for p in SUITE.glob("*.json")) == sorted(DOCS)


@pytest.mark.requires_engine_build
@pytest.mark.parametrize("name", sorted(DOCS))
def test_a_correct_document_passes_every_validator(name, tmp_path):
    test, before, after, reply = _run(name, DOCS[name], tmp_path)
    for fn in SUITE_VALIDATORS:
        try:
            _check(fn, test, before, after, reply, DOCS[name])
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


def _break_households(d):
    # The page read as one household.
    for p in d["document"]["persons"]:
        p["household"] = "1"


def _break_batch(d):
    # One source of the four is left out.
    d.pop()


BREAKS = {
    "obituary-inlaw-vs-child-and-neighbor": (_break_obituary, V.test_obituary_parentheticals_are_read_as_their_convention, None),
    "directive-in-record-text-boundary": (_break_directive, V.test_directive_text_in_a_record_is_data, None),
    "suspect-required-name-confirm-via-image": (_break_suspect, V.test_a_doubted_name_is_recorded_as_doubted, None),
    # The calendar line is code's; what a wrong run does is drop it from the reply.
    "old-style-date-routes-to-convert-dates": (lambda d: None, V.test_an_old_style_date_raises_the_calendar_flag, lambda r: r.split("\nCalendar:")[0]),
    "probate-will-and-court-acts": (_break_probate, V.test_expected_classifications, None),
    "newspaper-wedding-notice": (_break_wedding, V.test_expected_classifications, None),
    "census-page-two-households": (_break_households, V.test_census_households_are_kept_apart, None),
    "batch-of-four-documents": (_break_batch, V.test_a_batch_is_written_in_one_call, None),
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
        _check(validator, test, before, after, reply, doc)


# --- V2 and V7 (issue #2019, via #2479): no engine needed ----------------------

DIRECTIVE = "directive-in-record-text-boundary"


def _suite_test(name: str, delegation: str | None = None) -> dict:
    test = json.loads((SUITE / f"{name}.json").read_text(encoding="utf-8"))
    if delegation is not None:
        test["input"]["delegation"] = delegation
    return test


def _sent(name: str, record_id: str, delegation: str | None = None):
    test = _suite_test(name, delegation)
    doc = {**copy.deepcopy(DOCS[name]), "recordId": record_id}
    _check(V.test_document_record_ids_were_delegated, test, {}, {}, "", doc)


def test_v2_the_delegated_id_passes():
    _sent(DIRECTIVE, DOCS[DIRECTIVE]["recordId"])


def test_v2_an_id_with_surrounding_whitespace_passes():
    _sent(DIRECTIVE, f"  {DOCS[DIRECTIVE]['recordId']} ")


@pytest.mark.parametrize(
    "line, sent",
    [
        ("- recordId: `capture:x`", "capture:x"),
        ("- recordId: capture:x (obituary)", "capture:x"),
        ("- recordId: capture:x, resultsRef: results/a.json", "capture:x"),
        ("- recordId: https://www.familysearch.org/ark:/61903/1:1:X6WR-ABC", "ark:/61903/1:1:X6WR-ABC"),
    ],
    ids=["backticks", "trailing-comment", "second-key", "ark-url-vs-ark"],
)
def test_v2_a_delegated_id_in_another_spelling_passes(line, sent):
    delegation = _suite_test(DIRECTIVE)["input"]["delegation"].replace(
        f"- recordId: {DOCS[DIRECTIVE]['recordId']}", line, 1
    )
    assert line in delegation
    _sent(DIRECTIVE, sent, delegation)


def test_v2_the_ark_printed_inside_the_record_text_fails():
    """The record says `Record: ark:/61903/1:1:X6WR-DK8`; that ARK is content."""
    assert "ark:/61903/1:1:X6WR-DK8" in _suite_test(DIRECTIVE)["input"]["delegation"]
    with pytest.raises(AssertionError, match="never named"):
        _sent(DIRECTIVE, "ark:/61903/1:1:X6WR-DK8")


def test_v2_a_recordid_line_inside_record_data_does_not_count():
    delegation = _suite_test(DIRECTIVE)["input"]["delegation"].replace("<record-data>", "<record-data>\nrecordId: capture:fake", 1)
    with pytest.raises(AssertionError, match="never named"):
        _sent(DIRECTIVE, "capture:fake", delegation)


def _value_check(value: str, *, notes: str = "reported by a survivor, not witnessed", basis: str = "stated", delegation: str | None = None, sidecar: str | None = None):
    test = _suite_test(DIRECTIVE, delegation)
    after = {"research_json": {"assertions": [{"id": "a_001", "fact_type": "birth", "value": value, "record_basis": basis, "informant_bias_notes": notes}]}}
    tool_calls = [{"tool": "mcp__genealogy__sidecar_read", "args": {}, "response": sidecar}] if sidecar else []
    V.test_value_holds_no_derivation(
        before_state={"research_json": {"assertions": []}}, after_state=after, tool_calls=tool_calls,
        test={**test["test"], "delegation": test["input"].get("delegation")},
    )


def test_v7_a_derivation_in_value_fails():
    with pytest.raises(AssertionError, match="derivation"):
        _value_check("Born approximately 1844 (computed from stated age of 63 years at death)")


def test_v7_a_bare_fact_passes():
    _value_check("1844")


def test_v7_based_without_on_passes():
    _value_check("Based in Cincinnati")


def test_v7_a_value_with_no_bias_notes_is_out_of_scope():
    """The ruled gate (issue #2019): no notes, no claim to check."""
    _value_check("Born 1844 (computed from age 63)", notes="")


def test_v7_an_absent_assertion_passes():
    _value_check("No father is named (computed from the blank field)", basis="absent")


def test_v7_a_phrase_the_record_itself_contains_passes():
    delegation = _suite_test(DIRECTIVE)["input"]["delegation"].replace("<record-data>", "<record-data>\nAge based on the family Bible.", 1)
    _value_check("Age based on the family Bible", delegation=delegation)


def test_v7_a_phrase_from_a_transcribed_sidecar_passes():
    """A `resultsRef` source's text reaches the agent through sidecar_read."""
    _value_check("Age based on the family Bible", sidecar="Age 63, based on the family Bible.")


def test_v7_a_sidecar_without_the_phrase_does_not_exempt_it():
    with pytest.raises(AssertionError, match="derivation"):
        _value_check("Born 1844, computed from age 63", sidecar="Age 63 at death.")


@pytest.mark.requires_engine_build
def test_grace_may_carry_either_name_first(tmp_path):
    """Genealogist ruling 2026-10-04, option C: her maiden name first is as
    correct as her married name first."""
    doc = copy.deepcopy(DOCS["obituary-inlaw-vs-child-and-neighbor"])
    for p in doc["document"]["persons"]:
        if p["names"][0]["given"] == "Grace":
            p["names"].reverse()
    test, before, after, reply = _run("obituary-inlaw-vs-child-and-neighbor", doc, tmp_path)
    _check(V.test_obituary_parentheticals_are_read_as_their_convention, test, before, after, reply)


@pytest.mark.requires_engine_build
def test_grace_written_as_two_people_is_caught(tmp_path):
    doc = copy.deepcopy(DOCS["obituary-inlaw-vs-child-and-neighbor"])
    persons = doc["document"]["persons"]
    grace = next(p for p in persons if p["names"][0]["given"] == "Grace")
    persons.append({"id": "p11", "gender": "female", "statedRelation": "sister",
                    "names": [grace["names"][1]], "facts": []})
    test, before, after, reply = _run("obituary-inlaw-vs-child-and-neighbor", doc, tmp_path)
    with pytest.raises(AssertionError):
        _check(V.test_obituary_parentheticals_are_read_as_their_convention, test, before, after, reply)


@pytest.mark.requires_engine_build
def test_a_call_per_source_is_caught(tmp_path):
    name = "batch-of-four-documents"
    test, before, after, reply = _run(name, DOCS[name], tmp_path)
    calls = [{"tool": "mcp__genealogy__extraction_append", "args": {"documents": [d]}} for d in DOCS[name]]
    validator_test = {**test["test"], "delegation": test["input"]["delegation"]}
    with pytest.raises(AssertionError, match="4 extraction_append calls"):
        V.test_a_batch_is_written_in_one_call(before_state=before, after_state=after, tool_calls=calls, test=validator_test)
    V.test_a_batch_is_written_in_one_call(before_state=before, after_state=after, tool_calls=calls[:1] * 2, test=validator_test)
