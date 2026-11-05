"""The step boundary predicate, and the coverage test that keeps its table honest.

`step_boundary.py` ships in `packages/engine/plugin/hooks/` as a LIBRARY: the
prototype worker and both harnesses load it with `importlib`, the way
`context_policy.py` loads `guard_project_files.py`. It is not registered as a
hook anywhere (lead, 2026-10-21), so nothing but these tests and its callers
exercise it.

The coverage test is the load-bearing one. A new agent that is in no group would
otherwise be silently denied as a follower of every step, which reads as the
agent being broken rather than as a missing decision.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[4]
_PLUGIN = _REPO / "packages" / "engine" / "plugin"
_MODULE_PATH = _PLUGIN / "hooks" / "step_boundary.py"


def _load():
    spec = importlib.util.spec_from_file_location("_genealogy_step_boundary", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load the step boundary at {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sb = _load()


def _shipped_names() -> set[str]:
    """Every agent and skill the router can spawn, from the plugin folder."""
    names = {p.stem for p in (_PLUGIN / "agents").glob("*.md")}
    names |= {p.name for p in (_PLUGIN / "skills").iterdir() if p.is_dir()}
    return names


# ---------------------------------------------------------------------------
# Coverage: the reason this file exists
# ---------------------------------------------------------------------------


def test_every_shipped_agent_and_skill_has_a_group():
    """Fails when a shipped agent or skill is in no group.

    Proven to fail by dropping an unlisted `.md` into `agents/` (see the PR
    body): a new agent cannot ship without a decision about what may follow it
    in a turn. The router is exempt by name -- it is what spawns steps, never a
    step itself.
    """
    grouped = {member for members in sb.GROUPS.values() for member in members}
    ungrouped = sorted(_shipped_names() - grouped - {sb.ROUTER})
    assert not ungrouped, (
        f"these ship in the plugin but are in no step group: {ungrouped}. "
        "Add each to a group in `step_boundary.GROUPS` -- which decides what may "
        "follow it inside one turn -- or to the one-member list if it admits only itself."
    )


def test_no_group_names_something_that_does_not_ship():
    """The other direction: a table entry for a deleted agent is dead weight."""
    shipped = _shipped_names()
    grouped = {member for members in sb.GROUPS.values() for member in members}
    stale = sorted(grouped - shipped)
    assert not stale, f"grouped but not shipped (deleted or renamed?): {stale}"


def test_every_group_has_a_label():
    """`deny_reason` renders "Continue with <label>?" for whatever it denies."""
    missing = sorted(g for g in sb.GROUPS if g not in sb.STEP_LABELS)
    assert not missing, f"groups with no entry in STEP_LABELS: {missing}"
    assert "wrap-up" in sb.STEP_LABELS


# ---------------------------------------------------------------------------
# The predicate
# ---------------------------------------------------------------------------


def test_the_turns_first_step_is_always_allowed():
    assert sb.step_allowed([], "research-plan") is True
    assert sb.step_allowed([], "proof-conclusion") is True


def test_the_router_is_never_a_step():
    assert sb.step_allowed(["proof-conclusion"], "research") is True


def test_a_step_may_repeat_itself_so_the_search_step_fans_out():
    assert sb.step_allowed(["search-records"], "search-records") is True


def test_a_group_member_may_follow():
    assert sb.step_allowed(["search-records"], "search-images") is True
    assert sb.step_allowed(["search-records"], "record-structurer") is True


def test_a_step_outside_the_group_is_denied():
    assert sb.step_allowed(["search-records"], "proof-conclusion") is False
    assert sb.step_allowed(["research-plan"], "research-exhaustiveness") is False


def test_a_step_that_opens_a_turn_uses_its_home_group():
    # research-plan opens a PLAN step, not an assess one, so locality-guide may
    # follow it and research-exhaustiveness may not.
    assert sb.step_allowed(["research-plan"], "locality-guide") is True
    assert sb.step_allowed(["research-plan"], "research-exhaustiveness") is False
    # record-structurer opens a SEARCH step, not a forget one.
    assert sb.step_allowed(["record-structurer"], "search-records") is True
    assert sb.step_allowed(["record-structurer"], "forget-and-rederive") is False


def test_research_plan_after_exhaustiveness_needs_an_open_item():
    """Dispose's precondition. A decline turn cannot start a new plan."""
    opened = ["research-exhaustiveness"]
    assert sb.step_allowed(opened, "research-plan", ctx={"open_items": True}) is True
    assert sb.step_allowed(opened, "research-plan", ctx={"open_items": False}) is False


def test_a_host_that_cannot_read_research_json_denies_the_gated_follower():
    """One needless pause, never an unasked plan."""
    assert sb.step_allowed(["research-exhaustiveness"], "research-plan", ctx=None) is False


def test_search_hints_follows_a_search_step_but_opens_a_turn_alone():
    assert sb.step_allowed(["search-records"], "search-hints") is True
    # A turn search-hints opens -- a verdict on a hint -- admits no search.
    assert sb.step_allowed(["search-hints"], "search-records") is False


def test_a_search_hit_review_repeats_itself_but_follows_no_search():
    """The per-hit verdicts fan out as repeats of one step, and a turn that ran the
    search cannot also judge its hits: the review labels, then offers (#3522)."""
    review = "evaluate-search-results"
    assert sb.step_allowed([review], review) is True
    assert sb.step_allowed(["search-full-text"], review) is False
    assert sb.step_allowed([review], "record-structurer") is False


def test_names_are_compared_after_the_last_colon():
    assert sb.step_allowed([], "genealogy-research:research-plan") is True
    assert sb.step_allowed(["genealogy-research:search-records"], "search-images") is True


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("keep going.", "job"),
        ("Keep going!", "job"),
        ("  KEEP GOING  ", "job"),
        ("wrap it up.", "wrapup"),
        ("Wrap it up", "wrapup"),
        ("continue.", "step"),
        ("keep going a bit", "step"),
        ("", "step"),
        (None, "step"),
    ],
)
def test_step_mode_is_exact_phrase_only(text, expected):
    assert sb.step_mode(text) == expected


def test_job_mode_allows_every_step():
    assert sb.step_allowed(["search-records"], "proof-conclusion", mode="job") is True


def test_wrapup_allows_its_members_in_order():
    ctx = {"open_items": True}
    assert sb.step_allowed([], "research-plan", mode="wrapup", ctx=ctx) is True
    assert sb.step_allowed(["research-plan"], "person-evidence", mode="wrapup", ctx=ctx) is True
    # Skipping ahead is allowed; the router prose says when a member is skipped.
    assert sb.step_allowed(["person-evidence"], "proof-conclusion", mode="wrapup", ctx=ctx) is True


def test_wrapup_allows_a_member_to_repeat():
    # person-evidence links several records in one wrap-up; a repeat is not
    # going back. The order check is `>=`, and `>` would forbid exactly this
    # while every other step test stayed green.
    ctx = {"open_items": True}
    assert sb.step_allowed(["research-plan", "person-evidence"], "person-evidence",
                           mode="wrapup", ctx=ctx) is True


def test_wrapup_refuses_going_back_and_refuses_a_non_member():
    ctx = {"open_items": True}
    assert sb.step_allowed(["research-exhaustiveness"], "person-evidence", mode="wrapup", ctx=ctx) is False
    assert sb.step_allowed([], "search-records", mode="wrapup", ctx=ctx) is False


def test_wrapup_dispose_still_needs_an_open_item():
    assert sb.step_allowed([], "research-plan", mode="wrapup", ctx={"open_items": False}) is False


# ---------------------------------------------------------------------------
# ctx
# ---------------------------------------------------------------------------


def _research(*, question_status="open", item_status="planned", log=None, item_id="pli_001"):
    return {
        "questions": [{"id": "q_001", "status": question_status}],
        "plans": [
            {
                "id": "pl_001",
                "question_id": "q_001",
                "status": "active",
                "items": [{"id": item_id, "status": item_status}],
            }
        ],
        "log": log or [],
    }


def test_current_question_is_the_last_unresolved_entry():
    research = {
        "questions": [
            {"id": "q_001", "status": "resolved"},
            {"id": "q_002", "status": "open"},
            {"id": "q_003", "status": "resolved"},
        ]
    }
    assert sb.current_question(research)["id"] == "q_002"


def test_current_question_includes_a_concluded_question_still_holding_its_conflict():
    """Keyed on the stored status, not on whether a proof summary exists."""
    research = {"questions": [{"id": "q_001", "status": "exhaustive_declared"}]}
    assert sb.current_question(research)["id"] == "q_001"


def test_current_question_is_none_when_every_question_is_resolved():
    assert sb.current_question({"questions": [{"id": "q_001", "status": "resolved"}]}) is None


def test_open_items_is_true_for_a_planned_item_on_the_active_plan():
    assert sb.step_ctx(_research())["open_items"] is True
    assert sb.step_ctx(_research(item_status="in_progress"))["open_items"] is True


def test_open_items_is_false_once_every_item_is_disposed():
    assert sb.step_ctx(_research(item_status="completed"))["open_items"] is False
    assert sb.step_ctx(_research(item_status="skipped"))["open_items"] is False


def test_an_item_waiting_only_on_the_researchers_upload_does_not_count():
    """It is not work the agent can do, so it must not hold the boundary open."""
    log = [
        {
            "id": "log_001",
            "tool": "external_site",
            "outcome": "partial",
            "plan_item_id": "pli_001",
            "external_site": {
                "site": "ancestry",
                "url_generated": "https://example.test/search",
                "capture_received": False,
            },
        }
    ]
    assert sb.step_ctx(_research(log=log))["open_items"] is False


def test_a_closed_hand_off_lets_its_item_count_again():
    """A later entry for the same URL whose outcome is not `partial` closes it."""
    log = [
        {
            "id": "log_001",
            "tool": "external_site",
            "outcome": "partial",
            "plan_item_id": "pli_001",
            "external_site": {
                "site": "ancestry",
                "url_generated": "https://example.test/search",
                "capture_received": False,
            },
        },
        {
            "id": "log_002",
            "tool": "external_site",
            "outcome": "error",
            "plan_item_id": "pli_001",
            "external_site": {
                "site": "ancestry",
                "url_generated": "https://example.test/search",
                "capture_received": False,
            },
        },
    ]
    assert sb.step_ctx(_research(log=log))["open_items"] is True


def test_a_positive_hand_off_logged_without_a_capture_waits_on_nobody():
    """Keyed on `partial`, not on `capture_received` alone (alpha feedback #2864)."""
    log = [
        {
            "id": "log_001",
            "tool": "external_site",
            "outcome": "positive",
            "plan_item_id": "pli_001",
            "external_site": {
                "site": "ancestry",
                "url_generated": "https://example.test/search",
                "capture_received": False,
            },
        }
    ]
    assert sb.step_ctx(_research(log=log))["open_items"] is True


def test_a_superseded_plan_does_not_hold_the_boundary_open():
    research = _research()
    research["plans"][0]["status"] = "superseded"
    assert sb.step_ctx(research)["open_items"] is False


def test_step_ctx_on_an_empty_project_is_closed_not_crashing():
    assert sb.step_ctx({})["open_items"] is False
    assert sb.step_ctx({"questions": []})["question_id"] is None


# ---------------------------------------------------------------------------
# The deny reason
# ---------------------------------------------------------------------------


def test_the_deny_reason_names_the_step_it_stopped():
    assert "running the searches" in sb.deny_reason("search-records")
    assert "planning the searches" in sb.deny_reason("research-plan")
    assert "linking the records" in sb.deny_reason("person-evidence")


def test_the_deny_reason_tells_the_model_to_report_and_stop():
    reason = sb.deny_reason("search-records")
    assert reason.startswith("Step complete.")
    assert "end your turn" in reason


def test_the_wrapup_deny_reason_says_wrapping_up():
    assert "wrapping up" in sb.deny_reason("search-records", mode="wrapup")


# ---------------------------------------------------------------------------
# reply_options (acceptance item 3)
# ---------------------------------------------------------------------------


def _with_question(**extra):
    question = {"id": "q_001", "status": "open"}
    question.update(extra)
    return {"questions": [question]}


def test_no_offer_means_no_buttons():
    """A step that ended on a question for the researcher, or a final conclusion."""
    assert sb.reply_options(None, _with_question()) == []
    assert sb.reply_options("", _with_question()) == []


def test_an_ordinary_offer_gets_continue_keep_going_and_wrap_it_up():
    options = sb.reply_options("search-records", _with_question())
    assert options == [sb.REPLY_CONTINUE, sb.REPLY_KEEP_GOING, sb.REPLY_WRAP_UP]


def test_no_wrap_it_up_when_no_question_is_unresolved():
    """init-project's offer: there is nothing yet to wrap up."""
    options = sb.reply_options("question-selection", {"questions": []})
    assert options == [sb.REPLY_CONTINUE, sb.REPLY_KEEP_GOING]


def test_no_wrap_it_up_beside_a_proof_conclusion_offer():
    """Continue already concludes."""
    assert sb.REPLY_WRAP_UP not in sb.reply_options("proof-conclusion", _with_question())


def test_no_wrap_it_up_beside_a_question_selection_offer():
    """The offer after a wrap-up, where the question may be one a conflict held open."""
    assert sb.REPLY_WRAP_UP not in sb.reply_options("question-selection", _with_question())


def test_only_wrap_it_up_for_a_wrap_up_offer():
    assert sb.reply_options(sb.WRAP_UP, _with_question()) == [sb.REPLY_WRAP_UP]


def test_a_wrap_up_turn_offering_the_next_question_still_gets_buttons():
    """Keyed on the offer line, never on the step the turn ran."""
    options = sb.reply_options("question-selection", _with_question())
    assert sb.REPLY_CONTINUE in options and sb.REPLY_KEEP_GOING in options


_LOW = {"stopped_because": "resources_spent", "justification": "Overturn risk: low. Two sources agree."}
_HIGH = {"stopped_because": "resources_spent", "justification": "Overturn risk: high - the probate is unsearched."}


def test_search_more_only_at_a_low_risk_choice():
    low = _with_question(search_stop=_LOW)
    assert sb.REPLY_SEARCH_MORE in sb.reply_options("proof-conclusion", low)
    # No stop recorded: an ordinary conclude offer.
    assert sb.REPLY_SEARCH_MORE not in sb.reply_options("proof-conclusion", _with_question())
    # A high-risk choice offers planning instead, where Wrap it up is the alternative.
    assert sb.REPLY_SEARCH_MORE not in sb.reply_options("research-plan", low)


def test_search_more_is_not_offered_on_a_high_risk_or_unstated_stop():
    """Only the LOW verdict recommends concluding (section B), so only it gets the
    button beside a conclude offer. Mirrors `lowOverturnRisk` in question-state.ts."""
    for stop in (_HIGH, {"stopped_because": "resources_spent"},
                 {"stopped_because": "resources_spent", "justification": "Ran out of budget."}):
        research = _with_question(search_stop=stop)
        assert sb.REPLY_SEARCH_MORE not in sb.reply_options("proof-conclusion", research), stop


def test_search_more_goes_once_the_question_is_concluded():
    research = _with_question(search_stop=_LOW)
    research["proof_summaries"] = [{"id": "ps_001", "question_id": "q_001"}]
    assert sb.REPLY_SEARCH_MORE not in sb.reply_options("proof-conclusion", research)


# ---------------------------------------------------------------------------
# next_auto_reply (section A2)
# ---------------------------------------------------------------------------


def _reply(state=None, mode="job", prev="search-records", step="person-evidence",
           offer="research-exhaustiveness", outcome="ok"):
    return sb.next_auto_reply(state, mode, prev, step, offer, outcome)


def test_an_ordinary_offer_is_answered_with_keep_going():
    out = _reply()
    assert out["reply"] == sb.REPLY_KEEP_GOING
    assert out["state"]["replies"] == 1


def test_only_a_job_turn_gets_a_reply():
    """A "Continue." or "Wrap it up." turn ends the run."""
    assert _reply(mode="step")["reply"] is None
    assert _reply(mode="wrapup")["reply"] is None


def test_a_turn_that_did_not_finish_cleanly_ends_the_run():
    assert _reply(outcome="stopped")["reply"] is None
    assert _reply(outcome="error")["reply"] is None
    assert _reply(outcome="completed")["reply"] == sb.REPLY_KEEP_GOING


def test_no_offer_ends_the_run():
    """Including a step that ended on a question for the researcher."""
    assert _reply(offer=None)["reply"] is None


def test_a_wrap_up_offer_ends_the_run_because_only_the_researcher_answers_it():
    assert _reply(offer=sb.WRAP_UP)["reply"] is None


def test_a_proof_conclusion_turn_ends_the_run():
    assert _reply(step="proof-conclusion", offer="question-selection")["reply"] is None


def test_the_run_stops_at_max_auto_replies():
    at_cap = {"replies": sb.MAX_AUTO_REPLIES, "planning_rounds": 0, "answered": []}
    assert _reply(state=at_cap)["reply"] is None
    under = {"replies": sb.MAX_AUTO_REPLIES - 1, "planning_rounds": 0, "answered": []}
    assert _reply(state=under)["reply"] == sb.REPLY_KEEP_GOING


def test_a_repeated_step_and_offer_pair_ends_the_run():
    """A link-and-assess cycle that never plans."""
    first = _reply()
    second = sb.next_auto_reply(
        first["state"], "job", "search-records", "person-evidence",
        "research-exhaustiveness", "ok",
    )
    assert second["reply"] is None


def test_the_first_planning_round_is_allowed():
    out = _reply(prev="research-exhaustiveness", step="research-plan", offer="search-records")
    assert out["reply"] == sb.REPLY_KEEP_GOING
    assert out["state"]["planning_rounds"] == 1


def test_a_research_plan_offer_after_a_planning_round_gets_wrap_it_up():
    used = {"replies": 1, "planning_rounds": 1, "answered": []}
    out = _reply(state=used, prev="person-evidence", step="research-exhaustiveness",
                 offer="research-plan")
    assert out["reply"] == sb.REPLY_WRAP_UP


def test_a_second_planning_round_ends_the_run():
    used = {"replies": 2, "planning_rounds": 1, "answered": []}
    out = _reply(state=used, prev="research-exhaustiveness", step="research-plan",
                 offer="search-records")
    assert out["reply"] is None


def test_the_ordinary_first_plan_does_not_spend_the_planning_round():
    """research-plan after setup or after itself is the first plan, not a re-plan."""
    for prev in ("question-selection", "locality-guide", "init-project", "research-plan"):
        out = _reply(prev=prev, step="research-plan", offer="search-records")
        assert out["reply"] == sb.REPLY_KEEP_GOING, prev
        assert out["state"]["planning_rounds"] == 0, prev


def test_a_planning_round_clears_the_answered_pairs():
    """Pairs are tracked since the run's LAST planning round."""
    state = {"replies": 1, "planning_rounds": 0,
             "answered": [["research-plan", "search"]]}
    out = _reply(state=state, prev="research-exhaustiveness", step="research-plan",
                 offer="search-records")
    assert out["reply"] == sb.REPLY_KEEP_GOING
    # Cleared, then this turn's own pair appended -- so the one pair that stands is
    # this one, recorded under the OFFER KEY the line parser yields.
    assert out["state"]["answered"] == [["research-plan", "search"]]


def test_next_auto_reply_does_not_mutate_the_state_it_was_given():
    state = {"replies": 0, "planning_rounds": 0, "answered": []}
    _reply(state=state)
    assert state == {"replies": 0, "planning_rounds": 0, "answered": []}


def test_next_auto_reply_survives_a_missing_or_junk_state():
    assert _reply(state=None)["reply"] == sb.REPLY_KEEP_GOING
    assert _reply(state={})["reply"] == sb.REPLY_KEEP_GOING
    assert _reply(state={"replies": "x", "answered": "x"})["reply"] == sb.REPLY_KEEP_GOING


# ---------------------------------------------------------------------------
# offered_step / offer_key: the read side of deny_reason (section A2)
# ---------------------------------------------------------------------------


def test_every_step_offer_parses_back_to_the_key_it_was_written_from():
    """The property the whole reply path rests on: `deny_reason` WRITES the line and
    `offered_step` READS it, so for every step the two must agree.

    This is why the offer is a STEP_LABELS key and not an agent name. Five groups
    have more than one member, so "running the searches" cannot say which of the
    five it meant -- a parser returning an agent name would have to guess.
    """
    agents = sorted({m for members in sb.GROUPS.values() for m in members})
    assert len(agents) > 20, "the table shrank; this would pass on a near-empty set"
    disagreed = [a for a in agents if sb.offered_step(sb.deny_reason(a)) != sb.offer_key(a)]
    assert disagreed == [], f"deny_reason writes a line offered_step cannot read back: {disagreed}"


def test_the_wrapup_offer_round_trips_too():
    """Mode `wrapup` renders the one label only the researcher can answer."""
    assert sb.offered_step(sb.deny_reason("proof-conclusion", mode="wrapup")) == sb.WRAP_UP


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   \n  \n",
        "I found three records. What was her maiden name?",
        "Continue with inventing a brand new step?",
        "Continue with writing the conclusion?\nActually, one question first.",
        "Continue with writing the conclusion",
        "Continue with extracting the 0 Matches?",
        "Continue with extracting the census?",
        "Continue with running the 3 searches?",
    ],
    ids=["empty", "blank", "a question", "unknown label", "not the last line", "no question mark",
         "zero Matches", "extracting no Match", "a count on another label"],
)
def test_a_line_naming_no_entry_is_no_offer(text):
    """No offer ends a "Keep going" run, so every one of these must read as None --
    a parser that guessed here would keep a run going past a question for the
    researcher, which is the failure the step boundary exists to prevent."""
    assert sb.offered_step(text) is None


def test_offered_step_is_none_rather_than_raising_on_junk():
    for junk in (None, 3, [], {}):
        assert sb.offered_step(junk) is None


def test_the_offer_survives_the_markdown_the_router_writes_it_in():
    for line in (
        "**Continue with writing the conclusion?**",
        "*Continue with writing the conclusion?*",
        "`Continue with writing the conclusion?`",
        "CONTINUE WITH WRITING THE CONCLUSION?",
        "Continue with  writing the conclusion ?",
    ):
        assert sb.offered_step(f"The report.\n\n{line}") == "conclude", line


def test_offer_key_accepts_a_key_an_agent_or_a_namespaced_spawn():
    assert sb.offer_key("conclude") == "conclude"          # already a key
    assert sb.offer_key("proof-conclusion") == "conclude"  # an agent name
    assert sb.offer_key("genealogy-research:proof-conclusion") == "conclude"
    assert sb.offer_key(sb.WRAP_UP) == sb.WRAP_UP
    assert sb.offer_key(None) == "" and sb.offer_key("") == ""


def test_the_reply_functions_read_an_agent_name_and_its_key_the_same_way():
    """Callers pass a key (from the parser); the tests above pass agent names. The
    two spellings must not diverge, or a test would pin behaviour production
    never takes."""
    research = _with_question()
    for agent, key in (("proof-conclusion", "conclude"), ("research-plan", "plan"),
                       ("question-selection", "setup"), ("search-records", "search")):
        assert sb.reply_options(agent, research) == sb.reply_options(key, research), agent
        assert _reply(offer=agent)["reply"] == _reply(offer=key)["reply"], agent


def test_a_spawn_naming_no_agent_is_still_a_step():
    """The runtime runs an unnamed Task as a general-purpose agent, which can do any
    step's work. Read as no step, it ran a second step inside any turn with no deny."""
    assert sb.step_candidate("Task", {"prompt": "do the searches"}) == sb.UNNAMED_SPAWN
    assert sb.step_candidate("Agent", {}) == sb.UNNAMED_SPAWN
    assert sb.step_candidate("Skill", {}) is None
    gate = sb.StepGate(boundary=sb, mode="step")
    assert gate.check("Task", {"subagent_type": "research-plan"}, subagent=False) is None
    assert gate.check("Task", {"prompt": "now run the searches"}, subagent=False)[0] == "deny"


def test_a_wrap_up_that_has_concluded_names_the_next_step_not_wrapping_up():
    """After proof-conclusion the wrap-up is done. Offering "wrapping up" again would
    re-run it on a question already concluded."""
    under_way = sb.deny_reason("question-selection", "wrapup", ["research-plan"])
    assert "wrapping up" in under_way
    done = sb.deny_reason("question-selection", "wrapup", ["research-plan", "proof-conclusion"])
    assert "wrapping up" not in done and sb.STEP_LABELS["setup"] in done


# ---------------------------------------------------------------------------
# Search-hit review: the verdicts, then "Continue with extracting the N Matches?"
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        "Continue with extracting the 3 Matches?",
        "Continue with extracting three Matches?",
        "Continue with extracting the Match?",
        "Continue with extracting the 1 Match?",
        "Continue with extracting the 11 Matches?",
        "Continue with extracting the Matches?",
        "**Continue with extracting the 3 Matches?**",
        "**Continue with extracting the Match?**",
        "Continue with **extracting the 1 Match**?",
        "CONTINUE WITH EXTRACTING THE TEN MATCHES?",
    ],
)
def test_the_extraction_offer_parses_with_or_without_its_count(line):
    """The router writes the count; the host reads the step. A count of 0 is no
    offer, which `test_a_line_naming_no_entry_is_no_offer` pins."""
    assert sb.offered_step(f"Hit 4 is a Match.\n\n{line}") == "extract-matches"


def test_a_record_structurer_stopped_in_a_review_turn_offers_the_extraction():
    """The ruled close is "Continue with extracting the N Matches?". Rendered from
    record-structurer's home group, the deny would offer "running the searches"."""
    reason = sb.deny_reason("record-structurer", "step", ["evaluate-search-results"])
    assert sb.offered_step(reason) == "extract-matches"
    namespaced = sb.deny_reason("genealogy-research:record-structurer", "step",
                                [sb.ROUTER, "genealogy-research:evaluate-search-results"])
    assert sb.offered_step(namespaced) == "extract-matches"
    # Only there: stopped in any other turn, it is still the search step.
    assert sb.offered_step(sb.deny_reason("record-structurer", "step", ["timeline"])) == "search"
    assert sb.offered_step(sb.deny_reason("record-structurer")) == "search"


def test_the_extraction_offer_gets_the_default_replies():
    research = _with_question()
    assert sb.reply_options("extract-matches", research) == [
        sb.REPLY_CONTINUE, sb.REPLY_KEEP_GOING, sb.REPLY_WRAP_UP,
    ]
    out = _reply(prev="search-full-text", step="evaluate-search-results", offer="extract-matches")
    assert out["reply"] == sb.REPLY_KEEP_GOING
