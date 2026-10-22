"""Skill-specific validators for the locality-guide skill.

locality-guide consults the place_search, collections_search,
external_links_search, wiki, and wikipedia MCP tools and compiles a
locality research guide. When invoked inside a research project it
persists the guide in one `localities` entry via research_append — it
owns the `localities` section in the ownership manifest — and returns
only the entry's `loc_` id and its summary, not the guide (issue #3442).
Standalone Q&A (no research.json to write to) persists nothing and
returns the guide itself. It never writes
tree.gedcomx.json — enforced by
`test_universal.py::test_tree_ownership_table` (locality-guide is on no
tree row, so any tree write triggers a violation).

The three rubric dimensions (Jurisdiction accuracy, Record availability,
Research strategy) require reading the narrative output for genealogical
judgment, so they stay in `rubric.md`. The deterministic checks below
guard the structural properties a validator can settle without judgment
(issue #1886, from the locality-guide deep dive #1664):

  - test_localities_persisted_with_full_page_coverage — tag-gated; the
    only assertion that a localities entry was persisted AT ALL.
  - test_persisted_localities_entry_shape (VR1) — presence-gated: on any
    run that wrote a localities entry, checks the two properties the shared
    schema validator does NOT cover — source == "locality-guide" and
    coverage of all four wiki sections. The nested key-sets
    (jurisdictions/collections/pages_read) are already enforced by
    `test_universal.py::test_research_json_validates_schema` against
    `research.schema.json` ($defs.locality, additionalProperties:false),
    so VR1 does not re-check them.
  - test_survey_run_calls_both_collections_and_volume_search (VR4) — gating:
    a records survey that called one Step-3 search must have called both.
  - test_persisted_guide_is_the_guide, test_in_project_return_follows_the_contract
    and test_no_project_return_carries_guide — the guide is written exactly once
    (issue #3442): into `guide_markdown` inside a project, into the return
    outside one. Rationale in each docstring.

Of the two other checks the deep dive proposed, VR3 was dropped and VR2 is held
(NOT shipped here, and NOT dropped on the reasons first given — those don't hold):
  - VR2 (persisted collection id must trace to a same-run collections_search /
    volume_search response) — held pending the locality-guide skill->agent
    conversion, which may relocate where such a validator lives (#1886). Its
    earlier "drop" rationale was wrong and is corrected here so it is not carried
    as fact: it is NOT circular — #1886 scopes grounding to the run's own cs/vs
    responses, read via `tc.get("response")` (`mock_mcp.py`), not project_context;
    it does NOT duplicate `test_research_plan` — `validator_runner` loads only
    test_universal + test_<skill>, so that never runs on locality-guide; and it
    does NOT duplicate `provenance_report` — that is non-gating and reads fixtures
    at rest, not live responses. VR2 is genuinely class-closing (#1886 measures 58
    persisted ids / 0 untraceable, and no other gating guard catches a fabricated
    collections[].id here), so there is no valid ground to drop it — only to defer.
  - VR3 (digitization label requires a volume_search call) — dropped as
    subsumed by VR4, and it would only ever false-fire. A wiki-grounded label
    is NOT a legitimate substitute for the call: agents/locality-guide.md Step 3 makes
    volume_search a required Step-3 call, and Step 4 derives every label from
    its result — even the "No match in volume_search" branch presupposes the
    call was made, with the wiki as a cross-check, not a substitute. VR4
    already gates "a survey must call volume_search". In the acceptance run
    (v1_2026-09-21_13-46-57) every survey with volume_search available called
    it (VR4: 22 passed, 0 survey skipped it). The one run that assigns a
    digitization label without a volume_search call is ut_002, whose fixtures
    don't register volume_search (fixture-backed, absent from LIVE_TOOLS) so the
    tool was uncallable — exactly where VR3 would fire wrongly. (ut_023 makes no
    such classification at all: with the search tools unregistered it reports
    the coverage gap plainly rather than labelling.)

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import json
import re

import pytest

from harness.skill_runner import agent_return_text
from validators_lib import as_mapping, bare_tool_name, new_section_entries

REQUIRED_WIKI_SECTIONS = {"home", "getting_started", "online_records", "research_tips"}


def _written_localities(before_state, after_state):
    """localities[] entries this run created or modified in place.
    `include_modified=True` so an in-place rewrite (research_append op:"update")
    is re-checked, not skipped as a new-id-only diff would. The top-level entry
    is always an object (validator.ts `isObjectEntry` rejects a non-object at
    write time), so no entry-level guard is needed here.
    """
    return new_section_entries(
        before_state, after_state, "localities", include_modified=True
    )


def test_localities_persisted_with_full_page_coverage(after_state, test):
    """Tag-gated (`localities-persist`): when locality-guide runs inside a project it
    must persist a localities[] entry whose pages_read attempts all four wiki
    sections. Guards the '1-of-4 under-read' — a section that 404s is recorded
    found:false, but every section must appear.

    This is the ONLY validator that asserts persistence happened; VR1 below
    checks a persisted entry but skips when nothing was written, so it cannot
    stand in for this. Do not fold the two together.
    """
    if "localities-persist" not in (test.get("tags") or []):
        pytest.skip("not a localities-persist test")
    research = after_state.get("research_json")
    if research is None:
        pytest.fail("no research.json in after_state")
    locs = research.get("localities") or []
    assert locs, "locality-guide should have persisted a localities[] entry"
    loc = locs[-1]
    assert loc.get("source") == "locality-guide", (
        f"localities source should be 'locality-guide', got {loc.get('source')!r}"
    )
    sections = {p.get("section") for p in (loc.get("pages_read") or [])}
    missing = REQUIRED_WIKI_SECTIONS - sections
    assert not missing, (
        f"pages_read is missing wiki sections {sorted(missing)} — locality-guide "
        "must attempt all four (home / getting_started / online_records / research_tips)"
    )


def test_persisted_localities_entry_shape(before_state, after_state):
    """VR1 — presence-gated check on any localities[] entry this run wrote,
    covering the two properties the shared schema validator does not:

      1. source == "locality-guide"
      2. pages_read attempts all four wiki sections.

    The nested key-sets (jurisdictions/collections/pages_read) are enforced by
    `test_universal.py::test_research_json_validates_schema` against
    `research.schema.json` ($defs.locality, additionalProperties:false + required
    keys), so VR1 does not duplicate them. (That enforcement is the EVAL plane:
    the production runtime validator `validator.ts` deliberately does NOT
    deep-check those nested items — see its `checkLocalities` note — so the guard
    VR1 leans on is the schema check in this suite, not a production guarantee.)
    Presence-gated rather than tag-gated:
    the ~20 `empty-project-just-created` survey tests carry that scenario
    without the `localities-persist` tag, so on any that DO persist this catches
    source/section defects the tag-gated test above never sees. (How many
    persist is a separate, currently-low number — 2 of 26 in v1_2026-09-21_13-46-57;
    that population question is tracked on #1886, not asserted here.)

    Skips when the run wrote no entry (standalone Q&A / decline). Persistence
    itself is asserted only by the tag-gated test above, so a skill that stops
    persisting fails there, never silently here.
    """
    written = _written_localities(before_state, after_state)
    if not written:
        pytest.skip("no localities entry created or modified this run")
    for loc in written:
        lid = loc.get("id")
        assert loc.get("source") == "locality-guide", (
            f"localities[{lid}] source should be 'locality-guide', got {loc.get('source')!r}"
        )
        sections = {p.get("section") for p in (loc.get("pages_read") or []) if isinstance(p, dict)}
        missing = REQUIRED_WIKI_SECTIONS - sections
        assert not missing, (
            f"localities[{lid}] pages_read is missing wiki sections {sorted(missing)} — "
            "must attempt all four (home / getting_started / online_records / research_tips)"
        )


def test_survey_run_calls_both_collections_and_volume_search(tool_calls):
    """VR4 (gating) — a records-availability survey that called one of the Step-3
    searches must have called both: collections_search and volume_search are both
    required Step-3 calls (agents/locality-guide.md Step 3, "do not drop any call").

    Grades call PRESENCE, not the result: the skill *making* both calls is the
    behaviour under test. A `fixture_not_found` response means the skill DID call
    a *registered* tool with args no fixture matched (a test-corpus gap, not
    skill misbehaviour); in production the call always returns. That is distinct
    from a tool with NO fixture at all: collections_search and volume_search are
    fixture-backed and absent from LIVE_TOOLS, so a test that declares no fixture
    for one never registers it and the skill cannot call it — which is why ut_002
    (which declares NEITHER search fixture) is a no-search run VR4 skips, not a
    `fixture_not_found`. Grounding of a result is not this validator's concern.

    LIMIT (documented, not a bug): a run that called NEITHER search is skipped —
    it cannot be distinguished from a legitimate non-survey (standalone Q&A, a
    wiki-only guide, or a decline). `ut_locality_guide_023` is exactly such a
    deliberate no-collection-tool test (its judge_context forbids naming a
    collection), so VR4 correctly stands down there; `ut_002` is a plain records
    survey that stands down only because its fixture list omits the searches.
    Catching "a survey that should have called both but called neither" would
    need an intent signal (e.g. the `volume-search` tag already on 12 tests, none
    of them the seven rewired here) VR4 does not yet consult — a deliberate
    choice, tracked on #1886, not an absence.
    """
    tools = {bare_tool_name(tc.get("tool")) for tc in (tool_calls or [])}
    called_cs = "collections_search" in tools
    called_vs = "volume_search" in tools
    if not (called_cs or called_vs):
        pytest.skip("not a records survey — called neither collections_search nor volume_search")
    missing = [
        name
        for name, called in (("collections_search", called_cs), ("volume_search", called_vs))
        if not called
    ]
    assert not missing, (
        f"records survey called {sorted(tools & {'collections_search', 'volume_search'})} "
        f"but not {missing} — both are required Step-3 calls (agents/locality-guide.md Step 3)"
    )


def test_catalog_search_called_and_broadened(tool_calls, test):
    """VR5 (issue #3107) — scoped to ut_locality_guide_028: the agent must call
    catalog_search, and when it gets 0 hits, broaden by calling catalog_search
    again on a wider standardPlace.

    Grades call PRESENCE and COUNT, not the result content: the skill *making*
    the initial call and then broadening is the behaviour under test. Skips for
    all other tests — catalog_search is not registered in their fixtures, so they
    cannot call it.
    """
    if (test.get("id") or "") != "ut_locality_guide_028":
        pytest.skip("not the catalog-search broadening test")
    calls = [
        tc for tc in (tool_calls or [])
        if bare_tool_name(tc.get("tool")) == "catalog_search"
    ]
    assert calls, (
        "ut_locality_guide_028 must call catalog_search at least once"
    )
    places = [(tc.get("args") or {}).get("standardPlace") or "" for tc in calls]

    def parts(place):
        return [p.strip().lower() for p in place.split(",") if p.strip()]

    def is_parent(broader, narrower):
        b, n = parts(broader), parts(narrower)
        return 0 < len(b) < len(n) and n[-len(b):] == b

    assert any(
        is_parent(places[j], places[i])
        for i in range(len(places))
        for j in range(i + 1, len(places))
    ), (
        f"catalog_search places in call order: {places}. After the 0-hit village "
        "call, a later call must name one of its parent jurisdictions (the text "
        "after its first comma), not a sibling or the same place"
    )


def test_single_jurisdiction_enforced(before_state, after_state, tool_calls, test):
    """VR6 (issue #3186) — tag-gated (`single-jurisdiction`): when delegated
    several separate jurisdictions, the agent must survey only one. Asserts:

      1. Exactly one localities[] entry is persisted (not one per county).
      2. volume_search standardPlace arguments target at most one county
         (broadening to a parent jurisdiction is allowed).

    Guards the context-overflow bug: surveying three counties in parallel
    produces ~30 tool calls whose results exceed the agent's context window.
    """
    if "single-jurisdiction" not in (test.get("tags") or []):
        pytest.skip("not a single-jurisdiction test")
    # 1. Exactly one localities entry persisted
    written = _written_localities(before_state, after_state)
    assert len(written) == 1, (
        f"expected exactly 1 localities entry, got {len(written)} — "
        "the agent should survey one jurisdiction per call, not all of them"
    )
    # 2. volume_search calls target at most one county
    vs_calls = [
        tc for tc in (tool_calls or [])
        if bare_tool_name(tc.get("tool")) == "volume_search"
    ]
    if vs_calls:
        # Extract the most-specific component (first comma part) of each
        # standardPlace argument. Broadening calls (e.g. "Kentucky, United
        # States") have fewer components than county-level calls (e.g.
        # "Pulaski, Kentucky, United States"), so only county-level calls
        # (3+ components for US places) contribute a distinct first part.
        county_firsts = set()
        for tc in vs_calls:
            sp = (tc.get("args") or {}).get("standardPlace") or ""
            parts = [p.strip() for p in sp.split(",") if p.strip()]
            if len(parts) >= 3:
                county_firsts.add(parts[0].lower())
        assert len(county_firsts) <= 1, (
            f"volume_search called for multiple counties: {sorted(county_firsts)} — "
            "the agent should survey only one jurisdiction per call"
        )


# --- The guide is written once (issue #3442) ---------------------------------


def _heading(title):
    """A level-two template heading: line-anchored, case-insensitive, suffix allowed
    (`## Jurisdiction overview (1840s)` counts; `### Jurisdiction overview` and the
    words mid-line do not)."""
    return re.compile(rf"^##[ \t]+{re.escape(title)}", re.IGNORECASE | re.MULTILINE)


_GUIDE_HEADINGS = {
    title: _heading(title)
    for title in ("Jurisdiction overview", "Available record types", "Research tips")
}
_RECORD_TYPES_HEADING = _GUIDE_HEADINGS["Available record types"]
_POINTER = re.compile(
    r"\bsee\s+(the\s+)?(full\s+guide|research\s+log)\b"
    r"|\bfull\s+guide\s+(text\s+)?(as\s+)?presented\b",
    re.IGNORECASE,
)
_IN_PROJECT_RETURN_LIMIT = 3000


def test_persisted_guide_is_the_guide(before_state, after_state):
    """Presence-gated: every localities[] entry this run wrote holds the guide
    itself in `guide_markdown` — a non-empty string carrying the template's
    `## Jurisdiction overview`, `## Available record types` and `## Research tips`
    sections, and no pointer to a guide kept somewhere else.

    Why the stub guard exists: inside a project the persisted entry is now the
    only copy of the guide. The return carries the `loc_` id instead (see
    `test_in_project_return_follows_the_contract`), and research-plan reads the
    guide back from `guide_markdown`. While the return also carried the guide, a
    `guide_markdown` of "See full guide in research session output." lost
    nothing anyone read; once the return stops carrying it, that stub loses the
    guide outright. It is the live failure, not a hypothetical: replayed over the
    five run logs on main on 2026-10-15, 20 of the 80 persisting runs wrote a
    stub and 5 more a guide cut off before a required section
    (`scripts/replay_locality_guide_validators.py` reproduces the count).

    Skips when the run wrote no entry. Persistence itself is asserted by
    `test_localities_persisted_with_full_page_coverage` (tag-gated) and by the
    contract validator's nothing-written branch.
    """
    written = _written_localities(before_state, after_state)
    if not written:
        pytest.skip("no localities entry created or modified this run")
    problems = []
    for loc in written:
        lid = loc.get("id")
        guide = loc.get("guide_markdown")
        if not isinstance(guide, str) or not guide.strip():
            problems.append(
                f"localities[{lid}].guide_markdown must hold the whole guide; got {guide!r:.80}"
            )
            continue
        missing = [title for title, pattern in _GUIDE_HEADINGS.items() if not pattern.search(guide)]
        if missing:
            problems.append(
                f"localities[{lid}].guide_markdown is missing the `## ` heading(s) {missing}"
            )
        pointer = _POINTER.search(guide)
        if pointer:
            problems.append(
                f"localities[{lid}].guide_markdown points elsewhere ({pointer.group(0)!r}) "
                "instead of holding the guide"
            )
    assert not problems, (
        "the persisted guide is not the guide:\n  - " + "\n  - ".join(problems)
    )


def _response_body(response):
    """A recorded tool response as a mapping: the dict the mock logs, or MCP text
    content holding JSON, or a JSON string. Anything else reads as `{}`, so a
    missing or unparseable response is never taken for a refusal."""
    if (
        isinstance(response, dict)
        and "ok" not in response
        and isinstance(response.get("content"), list)
    ):
        texts = [
            item.get("text")
            for item in response["content"]
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        return as_mapping(texts[0]) if texts else {}
    return as_mapping(response)


def _append_ops(args):
    """The ops one research_append call sent: its batch ops (a list, or the JSON
    string a model may send), else its single top-level op when that names a
    section and ops is absent or unparseable. Kept local rather than in
    validators_lib: a validators_lib edit re-arms every suite's instrument check.
    """
    args = as_mapping(args)
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except (ValueError, TypeError):
            ops = None
    candidates = ops if isinstance(ops, list) else ([args] if args.get("section") else [])
    return [op for op in candidates if isinstance(op, dict)]


def _refused_localities_write(tool_calls):
    return any(
        isinstance(tc, dict)
        and bare_tool_name(tc.get("tool")) == "research_append"
        and (
            as_mapping(tc.get("args")).get("section") == "localities"
            or any(op.get("section") == "localities" for op in _append_ops(tc.get("args")))
        )
        and _response_body(tc.get("response")).get("ok") is False
        and _response_body(tc.get("response")).get("reason") == "no_project"
        for tc in (tool_calls or [])
    )


def _names_id(reply, lid):
    return re.search(rf"(?<!\w){re.escape(lid)}(?!\w)", reply) is not None


def test_in_project_return_follows_the_contract(
    before_state, after_state, tool_calls, agent_returns=None
):
    """Inside a research project the agent writes the guide once, into
    `guide_markdown`, and its return is one line naming the `loc_` id written or
    updated plus `summary_for_user` — never the guide again.

    Why the return omits the guide: the guide runs to 20k characters and more.
    Writing it into `guide_markdown` and then restating it as the return made the
    agent emit it twice, roughly doubling its output tokens and wall clock (the
    live Freeborn County run behind issue #3442), and the dispatcher relayed a
    return nothing downstream reads — research-plan reads the persisted entry.

    Skips with no project (`before_state["research_json"]` is None):
    `test_no_project_return_carries_guide` grades that return.

    Entry written: the return is non-empty, at most 3000 characters (all 32
    October in-project returns that followed this contract are at most 2310) and
    names every written entry's id as a whole word.

    Nothing written: passes only on the no-project fallback — a
    `research_append` writing `localities` whose recorded response is a refusal
    (`ok` exactly False) carrying `reason: "no_project"`, the tool's one
    refusal that is an answer rather than a fixable error
    (`research-append.ts`, `noProjectResult` in `project-io.ts`), and a return
    carrying the guide
    (`## Available record types`). A refused call reaches `tool_calls` with its
    response (`mock_mcp.py`, the research_append live handler); the conftest
    docstring saying `tool_calls` holds only successes is wrong for these live
    handlers. `attempted_mcp_calls` is not read: its entries carry no response,
    include successes, and no run log persists it. Anything else fails: every
    in-project no-write run in the October logs is a survey that should have
    persisted. Known edge, exercised by no test: a legitimate in-project hand-back
    that writes nothing would fail here; such a test needs a tag exemption.
    """
    if before_state.get("research_json") is None:
        pytest.skip("no research project: test_no_project_return_carries_guide grades the return")
    reply = agent_return_text(agent_returns, "locality-guide")
    written = _written_localities(before_state, after_state)
    if written:
        ids = [loc.get("id") for loc in written if isinstance(loc.get("id"), str)]
        assert reply.strip(), (
            f"in a research project the agent wrote {ids} but its return is empty; "
            "it must name the loc_ id and give summary_for_user"
        )
        assert len(reply) <= _IN_PROJECT_RETURN_LIMIT, (
            f"in a research project the return must be at most {_IN_PROJECT_RETURN_LIMIT} "
            "characters (the loc_ id line and summary_for_user, not the guide); "
            f"got {len(reply)}"
        )
        missing = [lid for lid in ids if not _names_id(reply, lid)]
        assert not missing, (
            f"the return does not name the localities entry {missing} this run wrote; "
            "in a research project it must name the loc_ id written or updated"
        )
        return
    assert _refused_localities_write(tool_calls), (
        "in a research project, nothing persisted and no localities write was refused "
        "with reason no_project; the guide belongs in a localities entry, a fixable "
        "refusal must be fixed and retried, and only a no_project answer falls back "
        "to returning the guide"
    )
    assert _RECORD_TYPES_HEADING.search(reply), (
        "a localities write was refused, so the return must carry the guide in full: "
        "no `## Available record types` heading in the return"
    )


def test_no_project_return_carries_guide(test, agent_returns=None):
    """Tag-gated (`no-project`): with no research project there is nowhere to
    persist the guide, so the agent's return is the guide in full.

    Searches the whole joined return for a line-anchored `## Available record
    types` (case-insensitive, suffix allowed). No split on `---`: no-project
    returns open with a narration preamble and a `---`, guides carry internal
    `---` rules, and `summary_for_user` carries no headings, so a plain search is
    both simpler and sufficient.
    """
    if "no-project" not in (test.get("tags") or []):
        pytest.skip("not a no-project test")
    reply = agent_return_text(agent_returns, "locality-guide")
    assert _RECORD_TYPES_HEADING.search(reply), (
        "no `## Available record types` heading in the return; with no project "
        "the guide is the return"
    )
