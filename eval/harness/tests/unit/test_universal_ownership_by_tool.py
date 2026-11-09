"""Tests for the tool-identity authorization path in `test_ownership_table`.

Ownership is declared at skill granularity (`callers`), but a merge is a
tool-granular operation. `merge_tree_persons` repoints every research.json
reference to a collapsed person — `project.subject_person_ids`,
`person_evidence[].person_id`, `timelines[].person_ids` — in one atomic write, and the skill
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


# ── timeline_build: a person timeline written by tool identity (issue #3516) ──

RESEARCH_SKILL = {"name": "research"}

HYPOTHESIS = {"id": "t_001", "hypothesis_id": "h_001", "person_ids": [SURVIVOR], "events": [], "gaps": []}
PERSON = {"id": "t_002", "label": "person", "person_ids": [SURVIVOR], "events": [], "gaps": []}


def timeline_call(tool="mcp__genealogy__timeline_build"):
    return {
        "tool": tool,
        "args": {"projectPath": "/p", "personId": SURVIVOR},
        "matched": {},
        "response_fixture": None,
        "response": {"ok": True},
    }


def test_timeline_build_appending_a_person_timeline_passes():
    before = research([SURVIVOR], timelines=[HYPOTHESIS])
    after = research([SURVIVOR], timelines=[HYPOTHESIS, PERSON])
    check_research(before, after, RESEARCH_SKILL, POSITIVE, tool_calls=[timeline_call()])


def test_timeline_build_updating_the_person_s_own_timeline_passes():
    before = research([SURVIVOR], timelines=[HYPOTHESIS, PERSON])
    after = research([SURVIVOR], timelines=[HYPOTHESIS, {**PERSON, "events": [{"date": "1850"}]}])
    check_research(before, after, RESEARCH_SKILL, POSITIVE, tool_calls=[timeline_call()])


def test_timeline_build_editing_a_hypothesis_timeline_fails():
    before = research([SURVIVOR], timelines=[HYPOTHESIS])
    after = research([SURVIVOR], timelines=[{**HYPOTHESIS, "events": [{"date": "1850"}]}])
    with pytest.raises(AssertionError) as e:
        check_research(before, after, RESEARCH_SKILL, POSITIVE, tool_calls=[timeline_call()])
    assert "timelines" in str(e.value)


def test_timeline_build_appending_a_multi_person_timeline_fails():
    before = research([SURVIVOR], timelines=[])
    after = research([SURVIVOR], timelines=[{**PERSON, "person_ids": [SURVIVOR, COLLAPSED]}])
    with pytest.raises(AssertionError):
        check_research(before, after, RESEARCH_SKILL, POSITIVE, tool_calls=[timeline_call()])


def test_a_person_timeline_without_the_call_still_fails():
    before = research([SURVIVOR], timelines=[HYPOTHESIS])
    after = research([SURVIVOR], timelines=[HYPOTHESIS, PERSON])
    with pytest.raises(AssertionError):
        check_research(before, after, RESEARCH_SKILL, POSITIVE, tool_calls=[])


# ── `project.objective` is open to any skill (issue #3975) ─────────────────
#
# Not tool identity, but the same check: the main thread rewrites the objective
# when the user asks, and `research` is a declared caller of no `project` field.
# A subagent's objective write is the plugin hook's to deny, not this check's.

RESEARCH = {"name": "research"}


def _with_project(state, **fields):
    state["research_json"]["project"].update(fields)
    return state


def test_an_objective_rewrite_by_a_non_owner_passes():
    before = research([SURVIVOR])
    after = _with_project(
        research([SURVIVOR]), objective="Who were his parents?", updated="2026-11-03"
    )
    check_research(before, after, RESEARCH, POSITIVE, tool_calls=[])


def test_a_title_rewrite_by_a_non_owner_still_fails():
    """The other direction: only `objective` and `updated` were opened."""
    before = _with_project(research([SURVIVOR]), title="Old")
    after = _with_project(
        research([SURVIVOR]), title="New", objective="Who were his parents?"
    )
    with pytest.raises(AssertionError) as e:
        check_research(before, after, RESEARCH, POSITIVE, tool_calls=[])
    assert "project" in str(e.value)


# ── a namesake row's birth year, filled in when a call links its person (#3363)
#
# research_append fills in `birth_year` on a namesake row of a person a call
# links, whichever skill writes the link, so a person-evidence run changes
# `namesakes`, which only search-records owns. The path allows that change and
# nothing beside it. `toolAuthorized` would grant the section to every caller of
# research_append, which ownership-manifest.test.ts reads it as.

PERSON_EVIDENCE = {"name": "person-evidence"}


def namesake_row(row_id="ns_001", **extra):
    row = {
        "id": row_id,
        "person_id": SURVIVOR,
        "name": "Paul Raymond",
        "place": "Bristol, Addison, Vermont, United States",
        "record_ids": ["ark:/61903/1:1:MC2W-5TM"],
        "log_entry_ids": ["log_045"],
        "record_persona_ids": {"ark:/61903/1:1:MC2W-5TM": "p_235084380"},
        "created": "2026-11-02",
    }
    row.update(extra)
    return row


def with_namesakes(rows):
    state = research([SURVIVOR])
    state["research_json"]["namesakes"] = [dict(r) for r in rows]
    return state


def link_call(tool="mcp__genealogy__research_append"):
    return {
        "tool": tool,
        "args": {"projectPath": "/p", "section": "person_evidence", "op": "append"},
        "matched": {},
        "response_fixture": None,
        "response": {"ok": True},
    }


def check_fill(before_rows, after_rows, tool_calls):
    check_research(with_namesakes(before_rows), with_namesakes(after_rows), PERSON_EVIDENCE, POSITIVE, tool_calls)


def test_h1_a_filled_in_birth_year_passes_under_both_tools_and_every_spelling():
    before = [namesake_row(), namesake_row("ns_002", birth_year=1750)]
    after = [namesake_row(birth_year=1796), namesake_row("ns_002", birth_year=1750)]
    for tool in ("research_append", "extraction_append"):
        for prefix in ("mcp__genealogy__", "mcp__remote-devices__Genealogy_Research__", "mcp__Genealogy_Research__"):
            check_fill(before, after, [link_call(tool=prefix + tool)])


def test_h2_the_same_fill_without_either_tool_fails():
    before = [namesake_row()]
    after = [namesake_row(birth_year=1796)]
    for calls in ([], None, [merge_call()], [timeline_call()]):
        with pytest.raises(AssertionError) as e:
            check_fill(before, after, calls)
        assert "namesakes" in str(e.value)


@pytest.mark.parametrize(
    "why, before, after",
    [
        ("h3 a year and a notes edit", [namesake_row()], [namesake_row(birth_year=1796, notes="moved")]),
        ("h3 a year and a re-stamped persona", [namesake_row()],
         [namesake_row(birth_year=1796, record_persona_ids={"ark:/61903/1:1:MC2W-5TM": "p_1"})]),
        ("h4 a year changed", [namesake_row(birth_year=1750)], [namesake_row(birth_year=1796)]),
        ("h4 a year dropped", [namesake_row(birth_year=1750)], [namesake_row()]),
        ("h5 a row added", [namesake_row()], [namesake_row(birth_year=1796), namesake_row("ns_002")]),
        ("h6 a row removed", [namesake_row(), namesake_row("ns_002")], [namesake_row(birth_year=1796)]),
        ("h6 rows reordered", [namesake_row(), namesake_row("ns_002")],
         [namesake_row("ns_002"), namesake_row(birth_year=1796)]),
        ("h6 a row re-keyed", [namesake_row()], [namesake_row("ns_009", birth_year=1796)]),
        ("h7 a string year", [namesake_row()], [namesake_row(birth_year="1796")]),
        ("h7 a fractional year", [namesake_row()], [namesake_row(birth_year=1796.5)]),
        ("h7 a boolean year", [namesake_row()], [namesake_row(birth_year=True)]),
        ("h7 a null year", [namesake_row()], [namesake_row(birth_year=None)]),
    ],
)
def test_h3_to_h7_anything_beside_a_fill_fails(why, before, after):
    with pytest.raises(AssertionError) as e:
        check_fill(before, after, [link_call()])
    assert "namesakes" in str(e.value), why


def test_search_records_still_writes_its_own_rows_without_the_path():
    """The owner is unaffected: a new row from search-records passes as before."""
    check_research(
        with_namesakes([]),
        with_namesakes([namesake_row(birth_year=1796)]),
        {"name": "search-records"},
        POSITIVE,
        [],
    )
