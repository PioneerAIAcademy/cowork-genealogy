"""Direct tests for the evaluate-search-results validators (issue #3522).

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected by `make harness-test`; without these, a validator's real pass/fail
set would only appear inside a paid per-skill run. Each check is shown failing
on planted defects and passing on legitimate variants (CLAUDE.md, "a new lint
must be proven to fail").

The last block reads the committed suite against its scenarios: every
hit-verdict test names a hit its scenario holds, and the tags that the writer
tool would refuse together never meet.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

REPO = next(q for q in Path(__file__).resolve().parents if (q / "eval/harness/validators").is_dir())
sys.path.insert(0, str(REPO / "eval/harness/validators"))

import test_evaluate_search_results as v  # noqa: E402
from validators_lib import bare_ark_id  # noqa: E402


def _strict(check):
    """A validator that skipped asserted nothing, and a skip inside a test here
    skips that test rather than failing it. So a case written to run the check
    fails on a skip: a renamed gate tag cannot pass by skipping."""
    def run(*args):
        try:
            return check(*args)
        except pytest.skip.Exception as skip:
            pytest.fail(f"{check.__name__} skipped instead of running: {skip}")
    return run


check_extracted = _strict(v.test_already_extracted_line_is_the_gold)
check_hand_back = _strict(v.test_hand_back_writes_nothing)
check_flag = _strict(v.test_new_vital_info_is_the_gold_flag)
check_tree_query = _strict(v.test_one_tree_query_on_the_target_with_every_fact_type)
check_row = _strict(v.test_one_verdict_row_on_the_delegated_hit)
check_reads = _strict(v.test_reads_only_the_delegated_hit)
check_lines = _strict(v.test_return_lines_carry_the_row)
check_verdict = _strict(v.test_verdict_is_the_gold_label)
check_writes = _strict(v.test_writes_nothing_but_the_verdict)

SUITE = REPO / "eval/tests/unit/evaluate-search-results"
SCENARIOS = REPO / "eval/fixtures/scenarios"
REF = "results/log_017.json#3Q9M-CSK3-ZSLR"
STORED = "ark:/61903/3:1:3Q9M-CSK3-ZSLR"
DELEGATION = f"Evaluate this full-text search hit.\n\nprojectPath: <workspace>\nhitRef: {REF}\ntarget: I1"


def _test(*tags, delegation=DELEGATION):
    return {"skill": "evaluate-search-results", "type": "positive", "tags": ["direct-arm", *tags], "delegation": delegation}


VERDICT = _test("hit-verdict")


def _call(name, prefix="mcp__genealogy__", **args):
    return {"tool": f"{prefix}{name}", "args": args}


def _returns(text):
    return [{"subagent_type": "evaluate-search-results", "text": text}]


BEFORE = {
    "research_json": {
        "project": {"subject_person_ids": ["I1"]},
        "log": [{"id": "log_017", "tool": "fulltext_search", "results_ref": "results/log_017.json"}],
        "assertions": [{"id": "a_001", "record_id": "https://www.familysearch.org/ark:/61903/1:1:MZM9-GG4"}],
    },
    "tree_gedcomx_json": {"persons": [{"id": "I1"}, {"id": "I2"}, {"id": "I3"}]},
}
ROW = {
    "id": "hv_001",
    "log_id": "log_017",
    "hit_id": STORED,
    "target_person_id": "I1",
    "verdict": "match",
    "new_vital_info": True,
    "rationale": "Parents Mary Robertson and Hiram Hy[de] in Jackson; the child is on no edge.",
    "created": "2026-10-30",
}


def _after(*rows, research=None, tree=None):
    state = copy.deepcopy(BEFORE)
    state["research_json"]["hit_verdicts"] = [dict(r) for r in rows]
    if research:
        state["research_json"].update(research)
    if tree is not None:
        state["tree_gedcomx_json"] = tree
    return state


AFTER = _after(ROW)
CALLS = [
    _call("project_context", projectPath="/w"),
    _call("sidecar_read", projectPath="/w", ref=REF),
    _call("tree_query", projectPath="/w", personIds=["I1", "I2", "I3"]),
    _call("research_append", projectPath="/w", section="hit_verdicts", op="append", entry={}),
]
GOOD = (
    f"hitRef: {REF}\nverdict: match\nnewVitalInfo: true\nalreadyExtracted: false\n---\n"
    "A 1834 baptism in the Jackson church names Mary Robertson and Hiram Hyde as parents, "
    "so it is him; it names a child his tree does not have."
)


# --- one row on the delegated hit ----------------------------------------

def test_row_passes_on_one_row_in_either_id_spelling():
    check_row(BEFORE, AFTER, VERDICT)
    check_row(BEFORE, _after({**ROW, "hit_id": "3Q9M-CSK3-ZSLR"}), VERDICT)
    check_row(BEFORE, _after({**ROW, "hit_id": "https://www.familysearch.org/" + STORED}), VERDICT)


def test_row_fails_on_no_row_two_rows_another_hit_or_another_target():
    with pytest.raises(AssertionError, match="exactly one new"):
        check_row(BEFORE, _after(), VERDICT)
    with pytest.raises(AssertionError, match="exactly one new"):
        check_row(BEFORE, _after(ROW, {**ROW, "id": "hv_002", "target_person_id": "I2"}), VERDICT)
    with pytest.raises(AssertionError, match="not the delegated hit"):
        check_row(BEFORE, _after({**ROW, "hit_id": "ark:/61903/3:1:3Q9M-CSK3-ZSH4"}), VERDICT)
    with pytest.raises(AssertionError, match="not the delegated hit"):
        check_row(BEFORE, _after({**ROW, "log_id": "log_008"}), VERDICT)
    with pytest.raises(AssertionError, match="the target is 'I1'"):
        check_row(BEFORE, _after({**ROW, "target_person_id": "I2"}), VERDICT)


def test_row_target_defaults_to_the_first_subject():
    no_target = _test("hit-verdict", delegation=DELEGATION.replace("\ntarget: I1", ""))
    check_row(BEFORE, AFTER, no_target)
    before = copy.deepcopy(BEFORE)
    before["research_json"]["project"]["subject_person_ids"] = ["I3"]
    with pytest.raises(AssertionError, match="the target is 'I3'"):
        check_row(before, AFTER, no_target)


def test_row_counts_only_new_rows():
    before = _after({**ROW, "id": "hv_001", "hit_id": "ark:/61903/3:1:3Q9M-CSK3-ZSH4"})
    after = _after(before["research_json"]["hit_verdicts"][0], {**ROW, "id": "hv_002"})
    check_row(before, after, VERDICT)


def test_row_names_a_delegation_without_a_hit_ref_as_drift():
    with pytest.raises(AssertionError, match="Test drift"):
        check_row(BEFORE, AFTER, _test("hit-verdict", delegation="Evaluate all hits of log_017."))


def test_row_skips_off_its_gate():
    with pytest.raises(pytest.skip.Exception):
        v.test_one_verdict_row_on_the_delegated_hit(BEFORE, _after(), _test("hand-back"))


# --- no other writes -------------------------------------------------------

def test_writes_passes_on_the_verdict_alone():
    check_writes(BEFORE, AFTER, CALLS, VERDICT)
    batch = _call("research_append", ops=json.dumps([{"section": "hit_verdicts", "op": "append", "entry": {}}]))
    check_writes(BEFORE, AFTER, [batch], VERDICT)


def test_writes_fails_on_another_section_the_tree_or_an_off_lane_append():
    with pytest.raises(AssertionError, match=r"\['assertions'\]"):
        check_writes(BEFORE, _after(ROW, research={"assertions": []}), CALLS, VERDICT)
    with pytest.raises(AssertionError, match=r"\['sources'\]"):
        check_writes(BEFORE, _after(ROW, research={"sources": [{"id": "src_001"}]}), CALLS, VERDICT)
    with pytest.raises(AssertionError, match="tree.gedcomx.json changed"):
        check_writes(BEFORE, _after(ROW, tree={"persons": [{"id": "I1"}]}), CALLS, VERDICT)
    with pytest.raises(AssertionError, match="person_evidence"):
        check_writes(BEFORE, AFTER, CALLS + [_call("research_append", section="person_evidence")], VERDICT)
    with pytest.raises(AssertionError, match="sources"):
        batch = _call("research_append", ops=[{"section": "hit_verdicts"}, {"section": "sources"}])
        check_writes(BEFORE, AFTER, [batch], VERDICT)


# --- one read of the hit ---------------------------------------------------

def test_reads_passes_on_one_read_in_any_spelling_and_on_paging():
    check_reads(CALLS, VERDICT)
    check_reads([_call("sidecar_read", ref=f"results/log_017.json#{STORED}")], VERDICT)
    check_reads([_call("sidecar_read", refs=[REF])], VERDICT)
    check_reads([_call("sidecar_read", ref=REF), _call("sidecar_read", ref=REF, offset=40000)], VERDICT)
    check_reads([_call("sidecar_read", prefix="mcp__remote-devices__Genealogy_Research__", ref=REF)], VERDICT)


def test_reads_fails_on_the_hits_list_another_hit_no_read_or_a_reread():
    with pytest.raises(AssertionError, match="never"):
        check_reads(CALLS + [_call("sidecar_read", ref="results/log_017.json#hits")], VERDICT)
    with pytest.raises(AssertionError, match="never"):
        check_reads([_call("sidecar_read", refs=[REF, "results/log_017.json#3Q9M-CSK3-ZSH4"])], VERDICT)
    with pytest.raises(AssertionError, match="never"):
        check_reads([_call("sidecar_read", ref="results/log_008.json#3Q9M-CSK3-ZSLR")], VERDICT)
    with pytest.raises(AssertionError, match="never called"):
        check_reads([c for c in CALLS if "sidecar_read" not in c["tool"]], VERDICT)
    with pytest.raises(AssertionError, match="2 times"):
        check_reads([_call("sidecar_read", ref=REF), _call("sidecar_read", ref=REF, offset=0)], VERDICT)


# --- one tree_query, every fact type ---------------------------------------

def test_tree_query_passes_on_the_target_and_family_with_no_filter():
    check_tree_query(BEFORE, CALLS, VERDICT)
    check_tree_query(BEFORE, [_call("tree_query", personIds='["I1"]')], VERDICT)
    check_tree_query(BEFORE, [_call("tree_query", personIds=["I1", "I2"], factTypes=[])], VERDICT)


def test_tree_query_fails_on_a_filter_a_missing_target_or_a_second_call():
    with pytest.raises(AssertionError, match="factTypes"):
        check_tree_query(BEFORE, [_call("tree_query", personIds=["I1"], factTypes=["Birth", "Death"])], VERDICT)
    with pytest.raises(AssertionError, match="factTypes"):
        check_tree_query(BEFORE, [_call("tree_query", personIds=["I1"], factTypes='["Marriage"]')], VERDICT)
    with pytest.raises(AssertionError, match="do not include the target"):
        check_tree_query(BEFORE, [_call("tree_query", personIds=["I2", "I3"])], VERDICT)
    with pytest.raises(AssertionError, match="do not include the target"):
        check_tree_query(BEFORE, [_call("tree_query")], VERDICT)
    with pytest.raises(AssertionError, match="2 times"):
        check_tree_query(BEFORE, CALLS + [_call("tree_query", personIds=["I1"])], VERDICT)
    with pytest.raises(AssertionError, match="0 times"):
        check_tree_query(BEFORE, CALLS[:2], VERDICT)


# --- gold labels -------------------------------------------------------------

@pytest.mark.parametrize(
    "tag,verdict",
    [("expect-match", "match"), ("expect-possible-match", "possible_match"), ("expect-not-a-match", "not_a_match")],
)
def test_verdict_passes_on_its_gold_and_fails_on_the_others(tag, verdict):
    t = _test("hit-verdict", tag)
    check_verdict(BEFORE, _after({**ROW, "verdict": verdict, "new_vital_info": False}), t)
    for other in {"match", "possible_match", "not_a_match"} - {verdict}:
        with pytest.raises(AssertionError, match=f"gold verdict {verdict}"):
            check_verdict(BEFORE, _after({**ROW, "verdict": other}), t)
    with pytest.raises(AssertionError, match="no new"):
        check_verdict(BEFORE, _after(), t)


def test_flag_passes_on_its_gold_and_fails_on_the_other():
    check_flag(BEFORE, AFTER, _test("new-vital"))
    check_flag(BEFORE, _after({**ROW, "new_vital_info": False}), _test("no-new-vital"))
    with pytest.raises(AssertionError, match="gold new_vital_info False"):
        check_flag(BEFORE, AFTER, _test("no-new-vital"))
    with pytest.raises(AssertionError, match="gold new_vital_info True"):
        check_flag(BEFORE, _after({**ROW, "new_vital_info": False}), _test("new-vital"))
    with pytest.raises(AssertionError, match="gold new_vital_info True"):
        check_flag(BEFORE, _after({**ROW, "new_vital_info": "true"}), _test("new-vital"))


def test_gold_checks_skip_untagged_and_name_two_golds_as_drift():
    for check in (v.test_verdict_is_the_gold_label, v.test_new_vital_info_is_the_gold_flag):
        with pytest.raises(pytest.skip.Exception):
            check(BEFORE, AFTER, VERDICT)
    with pytest.raises(pytest.skip.Exception):
        v.test_already_extracted_line_is_the_gold(_returns(GOOD), "", VERDICT)
    with pytest.raises(AssertionError, match="Test drift"):
        check_verdict(BEFORE, AFTER, _test("expect-match", "expect-not-a-match"))


def test_extracted_line_passes_on_its_gold_in_any_markup():
    check_extracted(_returns(GOOD), "", _test("not-extracted"))
    check_extracted(_returns(GOOD.replace("alreadyExtracted: false", "**alreadyExtracted:** `true`")), "",
                    _test("already-extracted"))
    check_extracted(_returns(GOOD.replace("alreadyExtracted: false", "- alreadyExtracted: True")), "",
                    _test("already-extracted"))


def test_extracted_line_fails_on_the_wrong_value_or_no_line():
    with pytest.raises(AssertionError, match="gold alreadyExtracted true"):
        check_extracted(_returns(GOOD), "", _test("already-extracted"))
    with pytest.raises(AssertionError, match="no `alreadyExtracted:` line"):
        check_extracted(_returns(GOOD.replace("alreadyExtracted: false\n", "")), "", _test("not-extracted"))
    with pytest.raises(AssertionError, match="no `alreadyExtracted:` line"):
        below = GOOD.replace("alreadyExtracted: false\n", "") + "\nalreadyExtracted: false"
        check_extracted(_returns(below), "", _test("not-extracted"))
    with pytest.raises(AssertionError, match="no `alreadyExtracted:` line"):
        check_extracted([], GOOD, _test("not-extracted"))


# --- the contract lines repeat the row ----------------------------------------

def test_lines_pass_on_the_contract_in_either_spelling_and_markup():
    check_lines(BEFORE, AFTER, _returns(GOOD), "", VERDICT)
    check_lines(BEFORE, AFTER, _returns(GOOD.replace(REF, f"results/log_017.json#{STORED}")), "", VERDICT)
    bold = "**hitRef:** `%s`\n**verdict:** Match\n**newVitalInfo:** true\n**alreadyExtracted:** false\n---\nx" % REF
    check_lines(BEFORE, AFTER, _returns(bold), "", VERDICT)
    possible = _after({**ROW, "verdict": "possible_match"})
    check_lines(BEFORE, possible, _returns(GOOD.replace("verdict: match", "verdict: possible match")), "", VERDICT)
    check_lines(BEFORE, AFTER, _returns(GOOD.replace(f"hitRef: {REF}", f"hitRef: {REF}.")), "", VERDICT)
    check_lines(BEFORE, AFTER, _returns(GOOD.replace(f"hitRef: {REF}", f"hitRef: {REF} (hit 9)")), "", VERDICT)


def test_lines_fail_on_a_missing_line_another_hit_or_a_disagreement():
    with pytest.raises(AssertionError, match=r"\['verdict'\]"):
        check_lines(BEFORE, AFTER, _returns(GOOD.replace("verdict: match\n", "")), "", VERDICT)
    with pytest.raises(AssertionError, match="not the delegated hit"):
        check_lines(BEFORE, AFTER, _returns(GOOD.replace("ZSLR\n", "ZSH4\n", 1)), "", VERDICT)
    with pytest.raises(AssertionError, match="the row says 'match'"):
        check_lines(BEFORE, AFTER, _returns(GOOD.replace("verdict: match", "verdict: possible_match")), "", VERDICT)
    with pytest.raises(AssertionError, match="newVitalInfo"):
        check_lines(BEFORE, AFTER, _returns(GOOD.replace("newVitalInfo: true", "newVitalInfo: false")), "", VERDICT)
    with pytest.raises(AssertionError, match="contract lines"):
        check_lines(BEFORE, AFTER, [], GOOD, VERDICT)


# --- a hand-back writes nothing -----------------------------------------------

def test_hand_back_passes_on_an_untouched_project():
    t = _test("hand-back")
    check_hand_back(BEFORE, copy.deepcopy(BEFORE), [], t)
    with pytest.raises(pytest.skip.Exception):
        v.test_hand_back_writes_nothing(BEFORE, AFTER, CALLS, VERDICT)


def test_hand_back_fails_on_an_append_a_row_or_a_tree_edit():
    t = _test("hand-back")
    with pytest.raises(AssertionError, match="research_append"):
        check_hand_back(BEFORE, copy.deepcopy(BEFORE), CALLS, t)
    with pytest.raises(AssertionError, match="research.json"):
        check_hand_back(BEFORE, AFTER, [], t)
    with pytest.raises(AssertionError, match="tree.gedcomx.json"):
        check_hand_back(BEFORE, _after(tree={"persons": []}) | {"research_json": BEFORE["research_json"]}, [], t)


# --- the committed suite against its scenarios --------------------------------

def _suite_tests() -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(SUITE.glob("*.json"))]


def test_every_hit_verdict_test_names_a_hit_its_scenario_holds():
    """The delegated hit is in its scenario's sidecar, carries a transcript, and
    its `already-extracted`/`not-extracted` tag agrees with the scenario's
    assertions, the record-level test research_append applies."""
    tests = [t for t in _suite_tests() if "hit-verdict" in t["test"]["tags"]]
    assert len(tests) >= 7, f"expected the 7 hit-verdict tests PLAN §4 names, found {len(tests)}"
    for t in tests:
        tags, name = t["test"]["tags"], t["test"]["id"]
        delegation = t["input"]["delegation"]
        ref = next(line.split(":", 1)[1].strip() for line in delegation.splitlines() if line.startswith("hitRef:"))
        base, _, hit = ref.partition("#")
        scenario = SCENARIOS / t["input"]["scenario"]
        rows = json.loads((scenario / base).read_text(encoding="utf-8"))["payload"]["results"]
        row = next((r for r in rows if bare_ark_id(r["id"]) == bare_ark_id(hit)), None)
        assert row and row.get("textDocument"), f"{name}: {ref} is not a hit with a transcript in {scenario.name}"
        research = json.loads((scenario / "research.json").read_text(encoding="utf-8"))
        extracted = any(bare_ark_id(a.get("record_id") or "") == bare_ark_id(hit) for a in research["assertions"])
        assert ("already-extracted" in tags) is extracted and ("not-extracted" in tags) is not extracted, (
            f"{name}: {hit} is {'extracted' if extracted else 'not extracted'} in {scenario.name}, but tagged {tags}"
        )
        if "new-vital" in tags:
            assert "expect-not-a-match" not in tags and not extracted, (
                f"{name}: research_append refuses new_vital_info true on a not_a_match or an extracted hit"
            )


def test_every_hand_back_is_graded_on_its_invariant_and_writes_nothing():
    tests = [t for t in _suite_tests() if "hand-back" in t["test"]["tags"]]
    assert len(tests) >= 2, f"expected the 2 hand-back tests PLAN §4 names, found {len(tests)}"
    for t in tests:
        assert t["test"]["type"] == "negative" and t["negative"]["grade_on_invariant"] is True, t["test"]["id"]
        assert "hit-verdict" not in t["test"]["tags"], t["test"]["id"]
