"""Direct tests for research's search-hit review validators (issue #3522).

`test_search_hit_review_spawns_one_agent_per_hit` (tag `reviews-search-hits`) and
`test_search_hit_review_yes_extracts_the_matches` (tag `extracts-reviewed-matches`).
`testpaths` excludes `validators/`, which is why these cases live here. Each call
record is in the shape `skill_runner.builtin_call_record` writes.

A failure case asserts the exception TYPE: both validators skip on an untagged
test, and a `pytest.raises(AssertionError)` around a validator that skipped would
skip the calling test rather than fail it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = next(q for q in Path(__file__).resolve().parents if (q / "eval/harness/validators").is_dir())
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from test_research import (  # noqa: E402
    test_search_hit_review_spawns_one_agent_per_hit as review,
    test_search_hit_review_yes_extracts_the_matches as extract,
)

G9GJ = REPO / "eval/fixtures/scenarios/g9gj-proof-update-after-later-search"

HITS = [
    "ark:/61903/3:1:3QSQ-G9WC-F61H",
    "ark:/61903/3:1:3QSQ-G9WC-K4WP",
    "ark:/61903/3:1:3QS7-99WC-FXVF",
    "ark:/61903/3:1:3QS7-99WC-KLYK",
    "ark:/61903/3:1:3QS7-89WC-KLMP",
    "ark:/61903/3:1:3Q9M-CSH3-QSQ3-K",
    "ark:/61903/3:1:3Q9M-C397-Y97K-P",
]


def _state(rows: list[dict] | None = None, log_id: str = "log_008") -> dict:
    rows = rows if rows is not None else [{"id": h, "textDocument": "DEED ..."} for h in HITS]
    sidecar = {"log_id": log_id, "tool": "fulltext_search", "payload": {"results": rows}}
    return {
        "research_json": {"project": {"subject_person_ids": ["I1"]}},
        "tree_gedcomx_json": {"persons": [{"id": "I1"}, {"id": "I2"}]},
        "files": {f"results/{log_id}.json": json.dumps(sidecar)},
    }


STATE = _state()
TEST = {
    "skill": "research",
    "tags": ["routing", "routes-to:evaluate-search-results", "reviews-search-hits", "reviews-hits:log_008:2,4,7"],
}


def _spawn(agent: str, prompt: str, **extra) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": agent, "prompt": prompt, "run_in_background": "False"}, **extra}


def _review_prompt(hit: str, target: str = "I1", log_id: str = "log_008") -> str:
    return f"projectPath: /work/p\nhitRef: results/{log_id}.json#{hit}\ntarget: {target}"


def _review_spawns(hits=("3QSQ-G9WC-K4WP", "3QS7-99WC-KLYK", "3Q9M-C397-Y97K-P"), **kw) -> list[dict]:
    return [_spawn("evaluate-search-results", _review_prompt(h, **kw)) for h in hits]


REPLY = (
    "Reading the hit list for that search.\n\n"
    "A Washington County deed that fits Iram Hyde.\n\n"
    "A Washington County deed that fits Iram Hyde.\n\n"
    "A Washington County deed that fits Iram Hyde.\n\n"
    "Continue with extracting the 3 Matches?"
)


def _fail(fn, *args) -> str:
    with pytest.raises(BaseException) as excinfo:
        fn(*args)
    assert excinfo.typename == "AssertionError", (
        f"expected the validator to FAIL, got {excinfo.typename}; a skip here passes vacuously"
    )
    return str(excinfo.value)


# ── the review turn ─────────────────────────────────────────────────────


def test_review_passes_one_spawn_per_requested_hit():
    review(TEST, _review_spawns(), STATE, REPLY)


@pytest.mark.parametrize(
    "prompt",
    [
        '{"projectPath": "/work/p", "hitRef": "results/log_008.json#3QSQ-G9WC-K4WP", "target": "I1"}',
        "**projectPath:** /work/p\n**hitRef:** `results/log_008.json#3QSQ-G9WC-K4WP`\n**target:** I1 (Iram Hyde)",
        "projectPath=/work/p hitRef=results/log_008.json#ark:/61903/3:1:3QSQ-G9WC-K4WP target=I1",
        "Evaluate this hit.\nprojectPath: /work/p\nhitRef: results/log_008.json#3QSQ-G9WC-K4WP.\ntarget: I1",
        "Evaluate results/log_008.json#3QSQ-G9WC-K4WP against target: I1. projectPath: /work/p.",
        "Evaluate results/log_008.json#3QSQ-G9WC-K4WP for Iram Hyde (target: I1), in (projectPath: /work/p).",
    ],
    ids=["json", "bold-and-backticks", "equals-and-ark-spelling", "trailing-full-stop", "prose-full-stop",
         "prose-parentheses"],
)
def test_review_accepts_every_markup_and_hit_spelling(prompt):
    spawns = [_spawn("evaluate-search-results", prompt)] + _review_spawns(hits=("3QS7-99WC-KLYK", "3Q9M-C397-Y97K-P"))
    review(TEST, spawns, STATE, REPLY)


@pytest.mark.parametrize(
    "last",
    [
        "Continue with `extracting the 3 Matches`?",
        "**Continue with extracting the three Matches?**",
        "continue with extracting 3 matches?",
    ],
    ids=["backticks", "bold-and-word", "lower-case-no-article"],
)
def test_review_accepts_every_spelling_of_the_offer(last):
    review(TEST, _review_spawns(), STATE, REPLY.rsplit("\n", 1)[0] + "\n" + last)


def test_review_reads_the_match_for_one_hit():
    test = dict(TEST, tags=["reviews-search-hits", "reviews-hits:log_008:4"])
    for last in ("Continue with extracting the Match?", "Continue with extracting the 1 Match?"):
        review(test, _review_spawns(hits=("3QS7-99WC-KLYK",)), STATE, "One hit.\n\n" + last)


def test_review_of_all_hits_skips_a_hit_with_no_transcript():
    rows = [{"id": h, "textDocument": "DEED"} for h in HITS[:3]] + [{"id": HITS[3], "textDocument": ""}]
    test = dict(TEST, tags=["reviews-search-hits", "reviews-hits:log_008:all"])
    spawns = _review_spawns(hits=("3QSQ-G9WC-F61H", "3QSQ-G9WC-K4WP", "3QS7-99WC-FXVF"))
    review(test, spawns, _state(rows), "Three hits.\n\nContinue with extracting the 3 Matches?")


def test_review_of_all_eleven_hits_of_g9gj_log_017():
    raw = (G9GJ / "results" / "log_017.json").read_text(encoding="utf-8")
    state = dict(_state(), files={"results/log_017.json": raw})
    test = dict(TEST, tags=["reviews-search-hits", "reviews-hits:log_017:all"])
    ids = [r["id"].rsplit(":", 1)[1] for r in json.loads(raw)["payload"]["results"]]
    assert len(ids) == 11
    spawns = _review_spawns(hits=ids, log_id="log_017")
    review(test, spawns, state, "Eleven hits.\n\nContinue with extracting the 11 Matches?")
    msg = _fail(review, test, spawns[:10], state, "Ten hits.\n\nContinue with extracting the 10 Matches?")
    assert "10 spawns for 11 hits" in msg


def test_review_ignores_a_spawn_made_inside_a_subagent():
    nested = _spawn("evaluate-search-results", _review_prompt("3QSQ-G9WC-F61H"), agent_id="a1")
    review(TEST, _review_spawns() + [nested], STATE, REPLY)


@pytest.mark.parametrize(
    "spawns, needle",
    [
        (_review_spawns()[:2], "2 spawns for 3 hits"),
        (_review_spawns() + _review_spawns()[:1], "more than once"),
        (_review_spawns(hits=("3QSQ-G9WC-K4WP", "3QSQ-G9WC-K4WP", "3Q9M-C397-Y97K-P")), "more than once"),
        (_review_spawns(hits=("3QSQ-G9WC-F61H", "3QS7-99WC-KLYK", "3Q9M-C397-Y97K-P")), "not asked for"),
        (_review_spawns(target=""), "no tree person as target"),
        (_review_spawns(target="Iram Hyde"), "no tree person as target"),
        (_review_spawns(target="I9"), "no tree person as target"),
        (_review_spawns(target="I9)."), "no tree person as target"),
        (_review_spawns(target="."), "no tree person as target"),
        (
            [_spawn("evaluate-search-results", p.replace("target: I1", "")) for p in
             (_review_prompt(h) for h in ("3QSQ-G9WC-K4WP", "3QS7-99WC-KLYK", "3Q9M-C397-Y97K-P"))],
            "no tree person as target",
        ),
        (
            [_spawn("evaluate-search-results", _review_prompt(h).replace("projectPath: /work/p\n", ""))
             for h in ("3QSQ-G9WC-K4WP", "3QS7-99WC-KLYK", "3Q9M-C397-Y97K-P")],
            "no projectPath",
        ),
        (
            [_spawn("evaluate-search-results",
                    _review_prompt("3QSQ-G9WC-K4WP") + "\nalso results/log_008.json#3QS7-99WC-KLYK")]
            + _review_spawns()[1:],
            "names 2 hit refs",
        ),
        (
            [_spawn("evaluate-search-results", "projectPath: /work/p\nhitRef: hits 2, 4 and 7 of log_008\ntarget: I1")],
            "names 0 hit refs",
        ),
    ],
    ids=[
        "too-few", "one-hit-twice-extra", "one-hit-twice-one-missing", "wrong-hit", "empty-target",
        "target-a-name", "target-not-in-tree", "target-not-in-tree-in-prose", "target-only-a-full-stop",
        "no-target", "no-project-path", "two-refs-in-one-spawn",
        "a-list-not-a-ref",
    ],
)
def test_review_fails_a_bad_fan_out(spawns, needle):
    assert needle in _fail(review, TEST, spawns, STATE, REPLY)


@pytest.mark.parametrize(
    "reply, needle",
    [
        (REPLY.replace("the 3 Matches", "the 2 Matches"), "counts 2 Matches for 3"),
        (REPLY.replace("the 3 Matches", "the Matches"), "counts None Matches for 3"),
        (REPLY.replace("the 3 Matches", "the Match"), "counts 1 Matches for 3"),
        (REPLY.replace("extracting the 3 Matches", "running the searches"), "does not offer"),
        (REPLY.replace("extracting the 3 Matches", "extracting the 0 Matches"), "does not offer"),
        (REPLY + "\n\nDelivered.", "does not offer"),
        (REPLY.rsplit("\n", 1)[0], "does not offer"),
        ("", "does not offer"),
    ],
    ids=["wrong-count", "no-count", "singular-for-three", "wrong-label", "zero", "offer-not-last", "no-offer",
         "no-reply"],
)
def test_review_fails_a_wrong_closing_line(reply, needle):
    assert needle in _fail(review, TEST, _review_spawns(), STATE, reply)


def test_review_fails_with_no_spawn_at_all():
    assert "No recorded spawn" in _fail(review, TEST, [_spawn("record-structurer", "x")], STATE, REPLY)


def test_review_fails_on_scenario_drift():
    assert "Scenario drift" in _fail(review, TEST, _review_spawns(), dict(STATE, files={}), REPLY)
    short = _state([{"id": h, "textDocument": "DEED"} for h in HITS[:5]])
    assert "holds 5 hits" in _fail(review, TEST, _review_spawns(), short, REPLY)


def test_review_skips_untagged():
    with pytest.raises(BaseException) as excinfo:
        review({"skill": "research", "tags": ["routing", "reviews-hits:log_008:2,4,7"]}, [], STATE, "")
    assert excinfo.typename == "Skipped"


# ── the yes ─────────────────────────────────────────────────────────────

REF = "results/log_017.json#3Q9M-CSK3-ZSLR"
YES = {
    "skill": "research",
    "tags": ["routing", "routes-to:record-structurer", "extracts-reviewed-matches", f"extracts-hit:{REF}"],
}


def _yes_prompt(record_id: str = "3Q9M-CSK3-ZSLR", ref: str = REF) -> str:
    return (
        "projectPath: /work/p\nquestionIds: [\"q_002\"]\n"
        f"sources:\n- recordId: {record_id}\n  resultsRef: {ref}"
    )


@pytest.mark.parametrize(
    "prompt",
    [
        _yes_prompt(),
        _yes_prompt(record_id="ark:/61903/3:1:3Q9M-CSK3-ZSLR"),
        _yes_prompt(record_id="https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSK3-ZSLR"),
        _yes_prompt(record_id="3:1:3Q9M-CSK3-ZSLR"),
        '{"projectPath": "/work/p", "questionIds": ["q_002"], "sources": '
        f'[{{"recordId": "3Q9M-CSK3-ZSLR", "resultsRef": "{REF}"}}]}}',
        f"projectPath: /work/p. Extract the Match, recordId: 3Q9M-CSK3-ZSLR, from resultsRef: {REF}.",
        f"projectPath: /work/p\nsources: the Match (recordId: ark:/61903/3:1:3Q9M-CSK3-ZSLR) at (resultsRef: {REF}).",
    ],
    ids=["bare", "ark", "resolver-url", "type-prefixed", "json", "prose-full-stop", "prose-parentheses"],
)
def test_yes_passes_one_source_per_match_in_either_spelling(prompt):
    extract(YES, [_spawn("record-structurer", prompt)])


@pytest.mark.parametrize(
    "spawns, needle",
    [
        ([_spawn("record-structurer", _yes_prompt(record_id="3Q9M-CSK3-ZSH4"))], "are not the Matches' hit ids"),
        ([_spawn("record-structurer", _yes_prompt(record_id="log_017"))], "are not the Matches' hit ids"),
        ([_spawn("record-structurer", _yes_prompt().replace("recordId", "record"))], "are not the Matches' hit ids"),
        (
            [_spawn("record-structurer", _yes_prompt(ref="results/log_017.json#ark:/61903/3:1:3Q9M-CSK3-ZSLR"))],
            "are not the hitRefs",
        ),
        ([_spawn("record-structurer", _yes_prompt(ref="results/log_017.json"))], "are not the hitRefs"),
        ([_spawn("record-structurer", _yes_prompt(ref="results/log_017.json)."))], "are not the hitRefs"),
        ([_spawn("record-structurer", _yes_prompt(record_id="3Q9M-CSK3-ZSH4)."))], "are not the Matches' hit ids"),
        (
            [_spawn("record-structurer", _yes_prompt() + "\n- recordId: 3Q9M-CSK3-ZSH4\n  resultsRef: "
                    "results/log_017.json#3Q9M-CSK3-ZSH4")],
            "are not the Matches' hit ids",
        ),
        ([_spawn("record-structurer", _yes_prompt())] * 2, "spawned 2 time(s)"),
        ([_spawn("evaluate-search-results", _review_prompt("3Q9M-CSK3-ZSLR", log_id="log_017"))], "spawned 0"),
    ],
    ids=["another-hit", "a-log-id", "no-record-id", "ref-respelled", "ref-without-hit", "ref-without-hit-in-prose",
         "another-hit-in-prose", "an-extra-source", "two-spawns", "re-evaluated-instead"],
)
def test_yes_fails_a_wrong_extraction(spawns, needle):
    assert needle in _fail(extract, YES, spawns)


def test_yes_skips_untagged():
    with pytest.raises(BaseException) as excinfo:
        extract({"skill": "research", "tags": [f"extracts-hit:{REF}"]}, [])
    assert excinfo.typename == "Skipped"
