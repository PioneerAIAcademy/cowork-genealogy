"""Direct tests for the research validators of issue #4791's three stops.

Each validator is pinned against the shape it exists to catch and against the
legitimate variants it must still accept.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(next(
    q / "eval/harness/validators" for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)))

from test_research import (  # noqa: E402
    test_broad_verify_audits_and_removes_nothing as broad_verify,
    test_job_setup_stops_after_init_project as setup_stop,
    test_no_project_from_a_name_search as no_name_search,
    test_plan_turn_relays_both_summaries as relays_both,
    test_plan_turn_runs_locality_guide_then_research_plan as plan_turn,
    test_question_selection_carries_the_researcher_reply as reply_carries,
    test_reply_adds_nothing_after_the_relay as relays_only,
    test_verify_reply_forgets_then_selects as verify,
)


def _spawn(name, prompt="projectPath: /p"):
    return {"tool": "Agent", "args": {"subagent_type": name, "prompt": prompt}}


def _mcp(name, **args):
    return {"tool": f"mcp__genealogy__{name}", "args": args}


# ── setup-stop ──────────────────────────────────────────────────────────────

SETUP = {"skill": "research", "tags": ["setup-stop"]}
SETUP_REPLY = (
    "The project for Jean Baptiste Moreau is set up. He was born 12 March 1821 in Bastogne.\n\n"
    'Jean Baptiste Moreau, "Belgium, Luxembourg Province, Civil Registration, 1796-1910"\n'
    'Jean Baptiste Moreau, "Belgium, Luxembourg Province, Church Records, 1601-1948"\n'
    'Jean Baptiste Moreau, "Belgium, Census Records, 1846-1900"\n\n'
    "What do you want to verify or research? Is anything here you think is wrong, or do you "
    "know or have anything that isn't here? If not,\n\nContinue with `choosing the question`?"
)


def _setup(names=("init-project",), calls=None, text=SETUP_REPLY, attempted=()):
    setup_stop(
        skills_invoked=["research"],
        builtin_tool_calls=[_spawn(n) for n in names],
        tool_calls=calls if calls is not None else [_mcp("tree_query", personIds=["MRQ1-JBM"], includeSources=True)],
        attempted_mcp_calls=list(attempted),
        text_response=text,
        test=SETUP,
    )


def test_setup_stop_passes_on_init_project_alone():
    _setup()
    _setup(text=SETUP_REPLY.replace("Jean Baptiste Moreau, ", "- **").replace('"\n', '"**\n'))
    _setup(text=SETUP_REPLY.replace('"Belgium', "\u201cBelgium").replace('0"', "0\u201d").replace(", 1796", ",\n1796"))


def test_setup_stop_fails_when_question_selection_follows():
    with pytest.raises(AssertionError, match="init-project alone"):
        _setup(names=("init-project", "question-selection"))


def test_setup_stop_fails_when_an_attached_record_is_read():
    calls = [_mcp("tree_query", includeSources=True), _mcp("extraction_append", personId="I1")]
    with pytest.raises(AssertionError, match="read attached records"):
        _setup(calls=calls)


def test_setup_stop_fails_without_the_sources_the_ask_or_the_offer():
    with pytest.raises(AssertionError, match="by title"):
        _setup(text=SETUP_REPLY.replace("Census Records", "census"))
    with pytest.raises(AssertionError, match="by title"):
        _setup(text=SETUP_REPLY.split("Jean Baptiste Moreau, \"")[0] + "He has three sources.\n\nWhat do you want to verify or research? Continue with `choosing the question`?")
    with pytest.raises(AssertionError, match="verify or research"):
        _setup(text=SETUP_REPLY.replace("What do you want to verify or research?", ""))
    with pytest.raises(AssertionError, match="choosing the question"):
        _setup(text=SETUP_REPLY.replace("choosing the question", "planning the searches"))


def test_skip_without_the_tag():
    with pytest.raises(pytest.skip.Exception):
        setup_stop(skills_invoked=[], builtin_tool_calls=[], tool_calls=[], attempted_mcp_calls=[],
                   text_response="", test={"skill": "research", "tags": []})


# ── verify-forget-then-select ──────────────────────────────────────────────

VERIFY = {"skill": "research", "tags": ["verify-forget-then-select"]}
BEFORE = {"research_json": {"project": {"subject_person_ids": ["I1"]}}}
SKILL_CALL = {"tool": "Skill", "args": {"skill": "forget-and-rederive", "args": "mode: verify. Verify his parents."}}
QS = _spawn("question-selection", "projectPath: /p\nstatedQuestion: Who were the parents of Anton Vogt?")


def _verify(builtins=None, calls=None):
    verify(
        skills_invoked=["research"],
        builtin_tool_calls=builtins if builtins is not None else [SKILL_CALL, QS],
        tool_calls=calls if calls is not None else [
            _mcp("tree_forget", forget=[{"selector": "parents-of", "personId": "I1"}], cleanSlate=True),
            _mcp("extraction_append", personId="I1"),
            _mcp("timeline_build", personId="I1"),
        ],
        before_state=BEFORE,
        test=VERIFY,
    )


def test_verify_passes_in_order():
    _verify()


def test_verify_fails_without_clean_slate_or_on_a_dry_run():
    with pytest.raises(AssertionError, match="cleanSlate"):
        _verify(calls=[_mcp("tree_forget", forget=[{"selector": "parents-of", "personId": "I1"}]),
                       _mcp("extraction_append", personId="I1")])
    with pytest.raises(AssertionError, match="dry run"):
        _verify(calls=[
            _mcp("tree_forget", forget=[{"selector": "parents-of", "personId": "I1"}], cleanSlate=True, dryRun=True),
            _mcp("tree_forget", forget=[{"selector": "parents-of", "personId": "I1"}], cleanSlate=True),
            _mcp("extraction_append", personId="I1"),
        ])


def test_verify_fails_when_the_baseline_runs_first():
    with pytest.raises(AssertionError, match="must follow the forget"):
        _verify(calls=[
            _mcp("extraction_append", personId="I1"),
            _mcp("tree_forget", forget=[{"selector": "parents-of", "personId": "I1"}], cleanSlate=True),
        ])


def test_verify_fails_without_the_forget_or_the_stated_question():
    with pytest.raises(AssertionError, match="no hand-off to forget-and-rederive"):
        _verify(builtins=[QS])
    with pytest.raises(AssertionError, match="statedQuestion"):
        _verify(builtins=[SKILL_CALL, _spawn("question-selection", "projectPath: /p")])
    with pytest.raises(AssertionError, match="verify mode"):
        _verify(builtins=[{"tool": "Skill", "args": {"skill": "forget-and-rederive"}}, QS])


# ── qs-reply-carries ────────────────────────────────────────────────────────

REPLY = {"skill": "research", "tags": ["qs-reply-carries:Reno, Nevada"]}


def test_reply_carries_passes_and_fails():
    reply_carries(test=REPLY, builtin_tool_calls=[_spawn(
        "question-selection",
        "projectPath: /p\nresearcherReply: You offered `choosing the question`. He died in Reno,\n  Nevada, not San Bernardino.",
    )])
    with pytest.raises(AssertionError, match="researcherReply"):
        reply_carries(test=REPLY, builtin_tool_calls=[_spawn("question-selection", "projectPath: /p\nHe died in Reno, Nevada.")])
    with pytest.raises(AssertionError, match="no question-selection spawn"):
        reply_carries(test=REPLY, builtin_tool_calls=[])


# ── plan-turn-locality-then-plan ────────────────────────────────────────────

PLAN = {"skill": "research", "tags": ["plan-turn-locality-then-plan"]}


def test_plan_turn_passes_and_fails():
    plan_turn(skills_invoked=["research"], test=PLAN,
              builtin_tool_calls=[_spawn("locality-guide"), _spawn("research-plan")])
    with pytest.raises(AssertionError, match="got \\['locality-guide'\\]"):
        plan_turn(skills_invoked=["research"], test=PLAN, builtin_tool_calls=[_spawn("locality-guide")])
    with pytest.raises(AssertionError, match="search-records"):
        plan_turn(skills_invoked=["research"], test=PLAN, builtin_tool_calls=[
            _spawn("locality-guide"), _spawn("research-plan"), _spawn("search-records")])


# ── relays-both-plan-summaries ──────────────────────────────────────────────

RELAY = {
    "skill": "research",
    "tags": ["relays-both-plan-summaries"],
    "execution": {"stub_skills": [
        {"skill": "locality-guide", "response": "caller lines\n---\nBastogne's civil records start in 1796."},
        {"skill": "research-plan", "response": "caller lines\n---\nThe plan searches the 1821 birth register first."},
    ]},
}
BOTH = ("Bastogne's civil records start in 1796.\n\nThe plan searches the **1821** birth register first.\n\n"
        "Continue with `running the searches`?")


def test_relays_both_passes_and_fails():
    relays_both(test=RELAY, text_response=BOTH)
    with pytest.raises(AssertionError, match="research-plan's summary"):
        relays_both(test=RELAY, text_response=BOTH.replace("birth register first", "register"))
    with pytest.raises(AssertionError, match="locality-guide's summary"):
        relays_both(test=RELAY, text_response=BOTH.replace("start in 1796", "are good"))
    with pytest.raises(AssertionError, match="running the searches"):
        relays_both(test=RELAY, text_response=BOTH.replace("running the searches", "linking the records"))


# ── no-name-search ──────────────────────────────────────────────────────────

NAME = {"skill": "research", "tags": ["no-name-search"]}


def _name(calls=(), attempted=(), names=("init-project",), after=None, reply="Send me his FamilySearch person ID."):
    no_name_search(skills_invoked=["research"], builtin_tool_calls=[_spawn(n) for n in names],
                   tool_calls=list(calls), attempted_mcp_calls=list(attempted),
                   after_state=after or {"research_json": None}, test=NAME, text_response=reply)


def test_no_name_search_passes_and_fails():
    _name(calls=[_mcp("project_context", projectPath="/p")])
    with pytest.raises(AssertionError, match="person_search was called"):
        _name(attempted=[_mcp("person_search", surname="Hagell")])
    with pytest.raises(AssertionError, match="person_search was called"):
        _name(calls=[_mcp("person_search", surname="Hagell")])
    with pytest.raises(AssertionError, match="a project was created"):
        _name(after={"research_json": {"project": {}}})
    with pytest.raises(AssertionError, match="init-project alone"):
        _name(names=("tree-survey",))
    # The router may ask for the ID itself, with no hand-off, so long as it asks.
    _name(names=())
    with pytest.raises(AssertionError, match="does not ask for the FamilySearch person ID"):
        _name(names=(), reply="I could not find him.")


# ── relays-only ─────────────────────────────────────────────────────────────

ONLY = {
    "skill": "research",
    "tags": ["relays-only:proof-conclusion"],
    "execution": {"stub_skills": [
        {"skill": "proof-conclusion", "response": "ps_001 written.\n---\nThe parentage is not proved.\n\nA baptism would advance it."},
    ]},
}


def test_relays_only_passes_on_the_relay_and_a_closing_line():
    relays_only(test=ONLY, text_response="Writing the conclusion.\n\nThe parentage is not proved.\n\nA baptism would advance it.")
    relays_only(test=ONLY, text_response="The parentage is **not proved**.\n\nA baptism would advance it.\n\nContinue with `planning the searches`? https://example.test/p")
    # An id in the router's own words before the spawn is the narration's to grade, not this check's.
    relays_only(test=ONLY, text_response="Concluding q_001 now.\n\nThe parentage is not proved.\n\nA baptism would advance it.")


def test_relays_only_fails_on_a_summary_of_its_own_or_a_leaked_id():
    with pytest.raises(AssertionError, match="adds its own text"):
        relays_only(test=ONLY, text_response="The parentage is not proved.\n\nA baptism would advance it.\n\nIn short: no parents yet.")
    with pytest.raises(AssertionError, match="ps_001"):
        relays_only(test=ONLY, text_response="The parentage is not proved.\n\nA baptism would advance it.\n\nContinue with `planning the searches`? (ps_001)")
    with pytest.raises(AssertionError, match="verbatim"):
        relays_only(test=ONLY, text_response="Not proved; try a baptism.")


# ── broad-verify-audits ─────────────────────────────────────────────────────

BROAD = {"skill": "research", "tags": ["broad-verify-audits"]}


def _broad(names=("source-evaluation", "check-warnings"), calls=(), text="Two findings. Start a new project for each."):
    broad_verify(skills_invoked=["research"], builtin_tool_calls=[_spawn(n) for n in names],
                 tool_calls=list(calls), attempted_mcp_calls=[], text_response=text, test=BROAD)


def test_broad_verify_passes_and_fails():
    _broad(calls=[_mcp("project_context", projectPath="/p"), _mcp("extraction_append", personId="I1")])
    with pytest.raises(AssertionError, match="nothing else"):
        _broad(names=("source-evaluation", "check-warnings", "question-selection"))
    with pytest.raises(AssertionError, match="nothing else"):
        _broad(names=("forget-and-rederive",))
    with pytest.raises(AssertionError, match="tree_forget"):
        _broad(calls=[_mcp("tree_forget", forget=[{"selector": "parents-of", "personId": "I1"}], cleanSlate=True)])
    with pytest.raises(AssertionError, match="no \"Continue with"):
        _broad(text="Two findings.\n\nContinue with `choosing the question`?")
    # On a first message the audit follows init-project in the same turn.
    _broad(names=("init-project", "source-evaluation", "check-warnings"))
    with pytest.raises(AssertionError, match="nothing else"):
        _broad(names=("init-project",))
