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
