"""Tests for the tool-identity authorization path in `test_ownership_table`.

Ownership is declared at skill granularity (`callers`), but a merge is a
tool-granular operation. `merge_tree_persons` repoints every research.json
reference to a collapsed person — `project.subject_person_ids`,
`person_evidence[].person_id`, `timelines[].person_ids`,
`known_holdings[].relates_to_person_ids` — in one atomic write, and the skill
that calls it (`tree-edit`) is a declared caller of none of those sections.

The alternative was widening `callers`, which the unit plane keys on. That
grants the skill the section by *any* path, including a direct
`research_append`, and reopens the failure the `person_evidence` row names:
"A skill writing an identity link asserts a `match_score` no tool computed."
Authorizing by tool keeps the grant to what the tool can structurally do.

**The false-pass this path could open, and the test that closes it:** a run
that merges *and* separately edits the same section would be waved through if
the clause only asked "was a merge called". So the clause requires the whole
section delta to be the merge's own id permutation —
`test_merge_call_does_not_launder_an_unrelated_edit` is the one that matters.
"""

import pathlib
import sys

import pytest

_HARNESS_ROOT = pathlib.Path(__file__).resolve().parents[2]
_VALIDATORS_DIR = _HARNESS_ROOT / "validators"
sys.path.insert(0, str(_HARNESS_ROOT))
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import test_ownership_table as check_research  # noqa: E402

POSITIVE = {"type": "positive"}
TREE_EDIT = {"name": "tree-edit"}

SURVIVOR = "I1"
COLLAPSED = "I3"


def merge_call(pairs=((SURVIVOR, COLLAPSED),), tool="mcp__genealogy__merge_tree_persons"):
    return {
        "tool": tool,
        "args": {"projectPath": "/p", "merges": [list(p) for p in pairs]},
        "matched": {},
        "response_fixture": None,
        "response": {"ok": True},
    }


def research(subject_person_ids, person_evidence=(), timelines=()):
    """Wrapped in `{"research_json": ...}` — that is the `before_state` shape.

    A bare dict makes the validator skip on "Missing research.json", and a
    skipped validator reads as a pass: the first run of this file was 12
    skipped, 0 failed, and looked green.
    """
    return {"research_json": {
        "project": {
            "id": "proj_001",
            "objective": "x",
            "updated": "2026-09-10T00:00:00Z",
            "subject_person_ids": list(subject_person_ids),
        },
        "questions": [],
        "plans": [],
        "log": [],
        "sources": [],
        "assertions": [],
        "person_evidence": [dict(e) for e in person_evidence],
        "conflicts": [],
        "hypotheses": [],
        "timelines": [dict(t) for t in timelines],
        "proof_summaries": [],
        "evaluations": [],
        "localities": [],
    }}


def evidence(person_id, match_score=0.9):
    return {"assertion_id": "a_001", "person_id": person_id, "match_score": match_score}


# ── the merge is authorized when the tool actually ran ──────────────────────


def test_merge_remap_passes_for_a_non_owner_when_the_tool_was_called():
    before = research([SURVIVOR, COLLAPSED], person_evidence=[evidence(COLLAPSED)])
    after = research([SURVIVOR], person_evidence=[evidence(SURVIVOR)])
    check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[merge_call()])


def test_merge_remap_passes_under_every_server_spelling():
    """The MCP server prefix is chosen by whoever registers it and moves.

    CLAUDE.md, "Dual-spelled tool names". Matching a single qualified spelling
    would bind in the harness and silently not bind elsewhere.
    """
    before = research([SURVIVOR, COLLAPSED])
    after = research([SURVIVOR])
    for tool in (
        "mcp__genealogy__merge_tree_persons",
        "mcp__remote-devices__Genealogy_Research__merge_tree_persons",
        "mcp__Genealogy_Research__merge_tree_persons",
    ):
        check_research(
            before, after, TREE_EDIT, POSITIVE, tool_calls=[merge_call(tool=tool)]
        )


def test_timelines_remap_passes():
    before = research([SURVIVOR], timelines=[{"id": "t_1", "person_ids": [COLLAPSED]}])
    after = research([SURVIVOR], timelines=[{"id": "t_1", "person_ids": [SURVIVOR]}])
    check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[merge_call()])


# ── and only then. The other direction. ────────────────────────────────────


def test_same_diff_without_the_call_still_fails():
    """The whole point: the state delta alone authorizes nothing."""
    before = research([SURVIVOR, COLLAPSED], person_evidence=[evidence(COLLAPSED)])
    after = research([SURVIVOR], person_evidence=[evidence(SURVIVOR)])
    with pytest.raises(AssertionError) as e:
        check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[])
    assert "person_evidence" in str(e.value)


def test_absent_tool_calls_argument_still_fails():
    """`tool_calls` defaults to None so existing positional callers keep working.

    A default that silently authorized would be the worst possible failure mode
    for this clause, so pin it: no tool calls means no tool-identity grant.
    """
    before = research([SURVIVOR, COLLAPSED])
    after = research([SURVIVOR])
    with pytest.raises(AssertionError):
        check_research(before, after, TREE_EDIT, POSITIVE)


def test_merge_call_does_not_launder_an_unrelated_edit():
    """A run that merges AND edits the section on its own must still fail.

    This is the false-pass the clause would open if it only asked whether a
    merge happened. The `match_score` change survives the id substitution, so
    the remapped before-state no longer equals the after-state.
    """
    before = research([SURVIVOR, COLLAPSED], person_evidence=[evidence(COLLAPSED, 0.9)])
    after = research([SURVIVOR], person_evidence=[evidence(SURVIVOR, 0.4)])
    with pytest.raises(AssertionError) as e:
        check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[merge_call()])
    assert "person_evidence" in str(e.value)


def test_a_new_entry_alongside_a_merge_still_fails():
    before = research([SURVIVOR, COLLAPSED], person_evidence=[evidence(COLLAPSED)])
    after = research(
        [SURVIVOR],
        person_evidence=[evidence(SURVIVOR), {"assertion_id": "a_002", "person_id": SURVIVOR}],
    )
    with pytest.raises(AssertionError):
        check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[merge_call()])


def test_a_merge_of_different_ids_does_not_authorize_this_diff():
    """The remap is read from the call's own arguments, not assumed."""
    before = research([SURVIVOR, COLLAPSED])
    after = research([SURVIVOR])
    with pytest.raises(AssertionError):
        check_research(
            before,
            after,
            TREE_EDIT,
            POSITIVE,
            tool_calls=[merge_call(pairs=(("I7", "I9"),))],
        )


def test_an_unrelated_tool_call_authorizes_nothing():
    before = research([SURVIVOR, COLLAPSED])
    after = research([SURVIVOR])
    with pytest.raises(AssertionError):
        check_research(
            before,
            after,
            TREE_EDIT,
            POSITIVE,
            tool_calls=[{"tool": "mcp__genealogy__research_append", "args": {}}],
        )


def test_a_section_with_no_merge_grant_is_unaffected():
    """`conflicts` does not name `merge_tree_persons`, so the clause cannot reach it."""
    before = research([SURVIVOR])
    after = research([SURVIVOR])
    after["research_json"]["conflicts"] = [{"conflict_id": "c_001"}]
    with pytest.raises(AssertionError) as e:
        check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[merge_call()])
    assert "conflicts" in str(e.value)


# ── the clause changes nothing for an owner, or for an ordinary violation ──


def test_owner_writing_its_own_section_still_passes_with_a_merge_call():
    before = research([SURVIVOR], timelines=[])
    after = research([SURVIVOR], timelines=[{"id": "t_1", "person_ids": [SURVIVOR]}])
    check_research(before, after, {"name": "timeline"}, POSITIVE, tool_calls=[merge_call()])


def test_ordinary_violation_still_fails_with_a_merge_call_present():
    before = research([SURVIVOR], person_evidence=[])
    after = research([SURVIVOR], person_evidence=[evidence(SURVIVOR)])
    with pytest.raises(AssertionError) as e:
        check_research(before, after, {"name": "timeline"}, POSITIVE, tool_calls=[merge_call()])
    assert "person_evidence" in str(e.value)


# ── a merge only explains a delta it actually made ──


def test_a_merge_that_did_not_succeed_explains_nothing():
    """`ok: false` — the tool refused, so the skill wrote this permutation itself."""
    before = research([SURVIVOR, COLLAPSED])
    after = research([SURVIVOR])
    call = merge_call()
    call["response"] = {"ok": False}
    with pytest.raises(AssertionError):
        check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[call])


def test_a_merge_the_harness_never_ran_explains_nothing():
    """The shape this actually takes on the unit plane today.

    `merge_tree_persons` is not in `LIVE_TOOLS` and no fixture declares it, so a
    call returns `{"error": "fixture_not_found"}` — no `ok` key at all. Reading
    an absent `ok` as success would authorize precisely the run this plane
    exists to catch: call the merge, watch it do nothing, then hand-write the
    repointing with `research_append`.
    """
    before = research([SURVIVOR, COLLAPSED])
    after = research([SURVIVOR])
    call = merge_call()
    call["response"] = {"error": "fixture_not_found", "tool": "merge_tree_persons"}
    with pytest.raises(AssertionError):
        check_research(before, after, TREE_EDIT, POSITIVE, tool_calls=[call])


# ── the substitution may collapse its own repeats, and no others ──


def test_a_pre_existing_duplicate_is_not_laundered_by_an_unrelated_merge():
    """Deduping BOTH sides erases every pre-existing repeat from the comparison.

    A delta that is only `[I5, I5, I7] -> [I5, I7]` then reads as "explained" by
    a merge over ids that appear nowhere in the section — the skill tidied a
    list it does not own and the merge call laundered it.
    """
    before = research(["I5", "I5", "I7"])
    after = research(["I5", "I7"])
    with pytest.raises(AssertionError):
        check_research(
            before, after, TREE_EDIT, POSITIVE,
            tool_calls=[merge_call(pairs=(("I91", "I90"),))],
        )


def test_a_duplicate_inserted_is_not_laundered_either():
    before = research(["I5", "I7"])
    after = research(["I5", "I7", "I7"])
    with pytest.raises(AssertionError):
        check_research(
            before, after, TREE_EDIT, POSITIVE,
            tool_calls=[merge_call(pairs=(("I91", "I90"),))],
        )


@pytest.mark.parametrize(
    "before_ids",
    [
        pytest.param([SURVIVOR, COLLAPSED], id="survivor-first"),
        pytest.param([COLLAPSED, SURVIVOR], id="collapsed-first"),
    ],
)
def test_the_merge_s_own_repeat_collapses_in_either_order(before_ids):
    """The other direction: a real merge must pass whichever order the ids sit in.

    A rule that only drops a repeat when the CURRENT element was remapped gets
    `[survivor, collapsed]` right and refuses `[collapsed, survivor]`, which is
    a false deny on a legitimate merge.
    """
    check_research(
        research(before_ids), research([SURVIVOR]), TREE_EDIT, POSITIVE,
        tool_calls=[merge_call()],
    )
