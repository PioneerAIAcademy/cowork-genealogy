"""Skill-specific validators for the init-project skill.

init-project creates the two project files (research.json and
tree.gedcomx.json) from scratch. Schema validation for both files is
handled by `test_universal.py::test_research_json_validates_schema` and
`test_universal.py::test_tree_gedcomx_json_validates_schema`. This file
covers init-project-specific structural rules — both files exist after
the run, research.json sections are empty arrays at init time (tag-gated
for tests that explicitly require it), and the stub person is created.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import re

import pytest


# --- Both files exist after init ---------------------------------------

def test_both_project_files_created(before_state, after_state, test):
    """init-project positive tests must produce BOTH research.json and
    tree.gedcomx.json. Either file missing is a structural failure even
    if the other validates. Per issue #1510, every opening-turn question
    (objective, experience level, access) is non-blocking and defaults
    silently if unanswered, so a positive test always completes in one
    pass -- there is no longer a premature-write exception to gate."""
    if test.get("type") != "positive":
        pytest.skip("file-existence rules apply only to positive tests")
    if after_state.get("research_json") is None:
        assert False, "init-project did not create research.json"
    if after_state.get("tree_gedcomx_json") is None:
        assert False, "init-project did not create tree.gedcomx.json"


# --- Opening-turn defaults, checked exactly (tag-gated) -----------------

# Issue #1510: the objective's default is defined as a fixed, verbatim
# string, the same way a defaulted narration_guidance is verbatim rather
# than paraphrased. That makes it checkable in code instead of leaving
# "did the skill hallucinate a specific direction?" to judge interpretation.
_DEFAULT_OBJECTIVE = (
    "General research: build out the tree and identify gaps and next steps."
)


def test_objective_default_verbatim(after_state, test):
    """Tag-gated on `objective-default`: when the test's premise is that the
    user stated no objective, the stored `project.objective` must be this
    exact string -- not a paraphrase, and not a specific direction invented
    from person data. Runs whether or not the test also expects the profile
    fields to default (see `test_profile_defaults_when_all_default` below
    for that tag), since a test can default the objective alone."""
    if "objective-default" not in test.get("tags", []):
        pytest.skip("not an objective-default scenario")
    research = after_state.get("research_json")
    if research is None:
        assert False, "objective-default requires research.json to exist"
    objective = (research.get("project") or {}).get("objective")
    assert objective == _DEFAULT_OBJECTIVE, (
        f"objective should default to the verbatim generic text when unstated, "
        f"got: {objective!r}"
    )


def test_profile_defaults_when_all_default(after_state, test):
    """Tag-gated on `opening-turn-all-defaults`: when the test's premise is
    that the user answered none of the three opening-turn questions,
    `researcher_profile.experience_level` and `.subscriptions` must hold
    the documented defaults exactly -- `intermediate` and `["none"]` -- not
    be left absent (the pre-#1510 dead-edge-case behavior) and not hold
    anything else."""
    if "opening-turn-all-defaults" not in test.get("tags", []):
        pytest.skip("not an all-defaults scenario")
    research = after_state.get("research_json")
    if research is None:
        assert False, "opening-turn-all-defaults requires research.json to exist"
    profile = research.get("researcher_profile")
    assert profile is not None, (
        "researcher_profile is absent -- the opening turn always asks and always "
        "proceeds, so this section should always be written, even when every "
        "answer defaults"
    )
    assert profile.get("experience_level") == "intermediate", (
        f"experience_level should default to 'intermediate', got: "
        f"{profile.get('experience_level')!r}"
    )
    assert profile.get("subscriptions") == ["none"], (
        f"subscriptions should default to ['none'], got: "
        f"{profile.get('subscriptions')!r}"
    )


# --- Empty-section enforcement at init time (tag-gated) ----------------

# Per init-project's bootstrap rule, research.json at creation has empty
# arrays for every section except project. Tests that explicitly require
# this rule add the `init-empty-sections` tag.

_INIT_EMPTY_SECTIONS = (
    "questions", "plans", "log", "sources", "assertions",
    "person_evidence", "conflicts", "hypotheses", "timelines",
    "proof_summaries",
)


def test_init_empty_sections(after_state, test):
    """Tag-gated: at init time, every research.json array section must be
    empty. The init-project workflow surveys known information but does
    not formulate questions or plans — those are downstream skills."""
    if "init-empty-sections" not in test.get("tags", []):
        pytest.skip("not an init-empty-sections scenario")
    research = after_state.get("research_json")
    if research is None:
        assert False, "init-empty-sections requires research.json to exist"
    non_empty = []
    for section in _INIT_EMPTY_SECTIONS:
        value = research.get(section, [])
        if value:
            non_empty.append(f"{section} ({len(value)} entries)")
    assert not non_empty, (
        f"research.json sections not empty at init: {non_empty}. "
        f"init-project should leave questions/plans/log/sources/assertions/"
        f"person_evidence/conflicts/hypotheses/timelines/proof_summaries "
        f"as empty arrays."
    )


# --- The write PATH, not just the resulting state ----------------------

def test_project_files_written_through_the_writer_tools(tool_calls, after_state, test):
    """init-project must create the project by CALLING `project_create`.

    One assertion, on one tool, because `project_create` writes BOTH documents
    in a single validated call — there is no second write to check and no order
    to get right. An earlier version of this validator required a
    `research_append` with `section: "project"`, which encoded a design that was
    abandoned before it shipped: it failed 8 of 11 tests on a skill that was
    behaving correctly, and because a failed validator skips the judge, it also
    threw away the grades. A check that encodes a stale design is worse than no
    check, because its red looks like the skill's fault.

    Every check above reads the after-state, and the after-state cannot see
    this. The unit harness grants `Write` and `Edit` to every skill from a fixed
    baseline independent of frontmatter, and its PreToolUse hook carries no
    protected-file rule — so a run in which the model ignores the rewritten body
    and hand-serializes research.json produces a byte-identical after-state and
    an identical grade. A check on the output alone therefore cannot fail for
    the reason it exists, which is exactly the unfalsifiable shape this repo has
    a standing rule against.

    What it is guarding is not hypothetical. In Cowork the raw-write lockdown
    denies those writes, so `init-project` could not create a project at all and
    the agent routed around the guard through the device bridge — and the write
    landed. The e2e corpus cannot see it either: every fixture starts from an
    existing project.

    Scoped to positive tests that were supposed to produce files -- a
    negative test's calls belong to the routed-to skill.
    """
    if test.get("type") != "positive":
        pytest.skip("write-path rules apply only to positive tests")

    called = {(call.get("tool") or "").rsplit("__", 1)[-1] for call in tool_calls or []}

    assert "project_create" in called, (
        "init-project never called project_create — both project files reached "
        "disk some other way, and in Cowork that route is the one the write "
        f"lockdown denies. Tools called: {sorted(called) or 'none'}"
    )

    # `project_create` deliberately writes no `researcher_profile` — the seed
    # must never invent one. So a profile in the output can only have arrived
    # through `research_append`, or through a raw write the lockdown denies in
    # production but the harness permits. Conditional on the profile existing,
    # because a run where the researcher volunteered nothing legitimately makes
    # exactly one call.
    if (after_state.get("research_json") or {}).get("researcher_profile"):
        assert "research_append" in called, (
            "research.json ends with a researcher_profile but research_append was "
            "never called — project_create does not write one, so it arrived by a "
            f"route the lockdown denies. Tools called: {sorted(called) or 'none'}"
        )

# --- Wrote-it vs. the-tool-returned-it (the deep dive's V1-V8) ----------
#
# Issue #1653's deep dive measured one defect wearing five faces: nothing
# compared a value the skill WROTE against the value a tool RETURNED. Across
# five committed run logs that produced `ark` in four mutually incompatible
# shapes (none canonical), 56 `standard_place` values that were verbatim copies
# of the raw `place` with zero `place_search` calls, and facts with no `sources`
# at all on the objective-only path -- every one scoring 3 on all eight
# dimensions. A judge cannot hold a ledger; a program must.
#
# `tool_calls[].response` is the other half of each comparison. The mock
# (`mock_mcp.py`) supplies it to validators at runtime and it is deliberately
# NOT persisted into the run log, so these checks cannot be replayed against a
# committed log -- which is why each is mutation-tested in
# `tests/unit/test_init_project_provenance_validators.py`.
#
# Two are deliberately WEAKER than the dive first proposed, because the stronger
# form would have failed runs the genealogist confirmed as correct:
#
#   * search-before-stubs is tag-gated, not derived from the user's message.
#     `ut_init_project_002` skipped `person_search` and `ut_init_project_006`
#     did not; both messages say "No FamilySearch tree exists...", and the
#     2026-08-20 annotation confirmed 002's dimensions as passes. An explicit
#     statement of absence makes the search discretionary.
#   * `standard_date` is checked for loss or alteration, never for provenance.
#     The objective-only builds legitimately write `Abt 1920` for a hand-entered
#     `~1920` with no tool involved -- init-project holds no date-standardizing
#     tool, and that value is correct.
#
# A check that encodes a stale design is worse than no check, because its red
# looks like the skill's fault.

_ARK_RE = re.compile(r"^ark:/61903/\d:\d:(.+)$")

_NARRATION_BY_LEVEL = {
    "novice": (
        "Narrate the *why* before each action. Define genealogy terms inline "
        "when first introduced. Explain which GPS step you are executing and "
        "what it produces. Err on the side of more context \u2014 the user is "
        "learning."
    ),
    "intermediate": (
        "One-line preamble per skill invocation explaining what you're about to "
        "do. Assume basic GPS vocabulary. Define unusual or specialized "
        "terminology inline."
    ),
    "experienced": (
        "No preambles. Do the work and report results concisely. Assume fluency "
        "with GPS and standard genealogy terminology."
    ),
    "professional": (
        "No preambles. Do the work and report results concisely. Assume fluency "
        "with GPS, BCG standards, and standard genealogy terminology."
    ),
}


def _tool(call):
    return (call.get("tool") or "").rsplit("__", 1)[-1]


def _responses(tool_calls, name):
    """Every response body returned for `name`, errors excluded."""
    out = []
    for call in tool_calls or []:
        if _tool(call) != name:
            continue
        response = call.get("response")
        if isinstance(response, dict) and "error" not in response:
            out.append(response)
    return out


def _written_tree(after_state):
    tree = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    return tree if isinstance(tree, dict) else {}


def _tree_person_facts(tree):
    """(person_id, fact) for every fact on every person."""
    for person in tree.get("persons") or []:
        for fact in person.get("facts") or []:
            if isinstance(fact, dict):
                yield person.get("id"), fact


def _returned_person_facts(tool_calls):
    """{(person_id, fact_type): fact} as `person_read` returned them.

    Keyed by person and type rather than by id: `person_read` supplies no fact
    ids, so the skill mints them and the written id cannot be joined back.
    """
    out = {}
    for response in _responses(tool_calls, "person_read"):
        for person in response.get("persons") or []:
            for fact in person.get("facts") or []:
                if isinstance(fact, dict):
                    out[(person.get("id"), fact.get("type"))] = fact
    return out


def _returned_person_ids(tool_calls):
    ids = set()
    for response in _responses(tool_calls, "person_read"):
        for person in response.get("persons") or []:
            if person.get("id"):
                ids.add(person["id"])
    for response in _responses(tool_calls, "person_search"):
        for result in response.get("results") or []:
            for person in ((result.get("gedcomx") or {}).get("persons")) or []:
                if person.get("id"):
                    ids.add(person["id"])
            if result.get("personId"):
                ids.add(result["personId"])
    return ids


# --- V1: both person_read flags -----------------------------------------

def test_person_read_passes_both_flags(tool_calls):
    """`relatives` and `sourceDescriptions` both default to false, and without
    them the call returns the subject alone -- a subject-only tree with no
    spouse, children or sources (issue #1475). SKILL.md Step 2 marks both
    required.

    Unfalsifiable before this: the only `person_read` fixture returned the same
    bare payload either way, and its `args` predicate -- which IS the Tool
    Arguments grading target -- named neither flag.
    """
    calls = [c for c in tool_calls or [] if _tool(c) == "person_read"]
    if not calls:
        pytest.skip("no person_read call")
    bad = []
    for call in calls:
        args = call.get("args") or {}
        missing = [
            flag for flag in ("relatives", "sourceDescriptions")
            if args.get(flag) is not True
        ]
        if missing:
            bad.append(f"{args.get('personId')!r} missing {missing}")
    assert not bad, (
        "person_read must pass relatives: true AND sourceDescriptions: true -- "
        "without them the import is silently subject-only: " + "; ".join(bad)
    )


# --- V2: ark form and provenance ----------------------------------------

def test_tree_ark_is_canonical_and_traceable(after_state, tool_calls):
    """`ark` anchors a person to a real FamilySearch record, and per
    simplified-gedcomx-spec.md section 2 it -- not the form of `id` -- carries
    tree membership. So it must be canonical `ark:/61903/n:n:<id>` AND its bare
    id must be a person id some tool actually returned.

    The corpus wrote four incompatible shapes, none canonical. The worst,
    `https://www.familysearch.org/tree/person/details/<pid>`, defeats
    `arkToBareId` outright: it parses as no ARK, so `toGedcomX` rebuilds the
    Persistent identifier as a web page address.
    """
    tree = _written_tree(after_state)
    persons = [p for p in tree.get("persons") or [] if p.get("ark")]
    if not persons:
        pytest.skip("no person carries an ark")
    known = _returned_person_ids(tool_calls)
    bad = []
    for person in persons:
        ark = person["ark"]
        match = _ARK_RE.match(str(ark))
        if not match:
            bad.append(
                f"{person.get('id')}: {ark!r} is not canonical ark:/61903/n:n:<id>"
            )
        elif match.group(1) not in known:
            bad.append(
                f"{person.get('id')}: {ark!r} names {match.group(1)!r}, which no "
                f"tool response returned (returned: {sorted(known) or 'none'})"
            )
    assert not bad, (
        "an ark that is malformed, or names a person no tool returned, anchors "
        "nothing -- omit the key instead: " + "; ".join(bad)
    )


# --- V3: standard_place provenance --------------------------------------

def test_standard_place_came_from_a_tool(after_state, tool_calls):
    """`standard_place` means "FamilySearch's standardized name", so a value no
    place authority returned is a claim about FamilySearch's vocabulary that
    FamilySearch did not make.

    Two legitimate origins: carried from a `person_read` fact that already had
    one, or taken from a `place_search` result. A copy of the fact's own
    free-text `place` is neither -- that is the 56-value defect this closes.
    """
    tree = _written_tree(after_state)
    written = [
        (pid, f) for pid, f in _tree_person_facts(tree) if f.get("standard_place")
    ]
    if not written:
        pytest.skip("no standard_place in the written tree")

    allowed = set()
    for fact in _returned_person_facts(tool_calls).values():
        if fact.get("standard_place"):
            allowed.add(fact["standard_place"])
    for response in _responses(tool_calls, "place_search"):
        for result in response.get("results") or []:
            if result.get("standardPlace"):
                allowed.add(result["standardPlace"])

    bad = []
    for pid, fact in written:
        value = fact["standard_place"]
        if value in allowed:
            continue
        note = (
            " (a copy of the fact's own free-text place)"
            if value == fact.get("place") else ""
        )
        bad.append(f"{pid}/{fact.get('type')}: {value!r}{note}")
    assert not bad, (
        "every standard_place must be one a person_read fact carried or a "
        "place_search returned; these match neither"
        + (
            f" (tools returned: {sorted(allowed)})" if allowed
            else " (no tool returned any)"
        )
        + ": " + "; ".join(bad)
    )


# --- V8: standard_date is not lost or altered ---------------------------

def test_standard_date_survives_from_the_tool(after_state, tool_calls):
    """A `standard_date` the tool returned must reach the tree unchanged.

    Loss and alteration only, NOT provenance: the objective-only builds
    legitimately standardize a hand-entered `~1920` to `Abt 1920` with no tool
    involved, and init-project holds no date-standardizing tool. Requiring
    provenance here would fail runs the genealogist confirmed.
    """
    returned = _returned_person_facts(tool_calls)
    if not returned:
        pytest.skip("no person_read response to compare against")
    # Join on (type, raw date): the written person id is local, and the returned
    # fact carries no id to match on.
    by_type_date = {
        (f.get("type"), f.get("date")): f.get("standard_date")
        for f in returned.values()
        if f.get("standard_date")
    }
    if not by_type_date:
        pytest.skip("no returned fact carried a standard_date")
    bad = []
    for pid, fact in _tree_person_facts(_written_tree(after_state)):
        expected = by_type_date.get((fact.get("type"), fact.get("date")))
        if expected is None:
            continue
        actual = fact.get("standard_date")
        if actual != expected:
            verb = "dropped" if not actual else f"altered to {actual!r}"
            bad.append(f"{pid}/{fact.get('type')}: {expected!r} {verb}")
    assert not bad, (
        "standard_date is what every downstream date comparison reads; a "
        "dropped or re-derived value silently changes what the date claims: "
        + "; ".join(bad)
    )


# --- V4: every fact and relationship is sourced -------------------------

def test_every_fact_and_relationship_is_sourced(after_state, test):
    """SKILL.md Step 3: attach a source reference to every fact AND every
    relationship, at `quality: 1`. On the objective-only path the researcher's
    own statement is the source, and the rule is unchanged.

    `test_id_references_resolve` already checks that a ref which EXISTS
    resolves. Nothing checked that one exists -- and on the objective-only path
    the tree landed with `sources: []` and facts carrying no `sources` key at
    all, in four of four runs.
    """
    if test.get("type") != "positive":
        pytest.skip("sourcing rules apply only to positive tests")
    tree = _written_tree(after_state)
    if not tree.get("persons"):
        pytest.skip("no tree written")
    source_ids = {s.get("id") for s in tree.get("sources") or []}

    def _problems(label, holder):
        refs = holder.get("sources")
        if not refs:
            return [f"{label}: no source reference"]
        out = []
        for ref in refs:
            if not isinstance(ref, dict):
                out.append(f"{label}: malformed source reference {ref!r}")
                continue
            if ref.get("ref") not in source_ids:
                out.append(
                    f"{label}: ref {ref.get('ref')!r} is not a top-level source"
                )
            if ref.get("quality") != 1:
                out.append(f"{label}: quality={ref.get('quality')!r}, expected 1")
        return out

    bad = []
    for pid, fact in _tree_person_facts(tree):
        bad += _problems(f"{pid}/{fact.get('type')}", fact)
    for rel in tree.get("relationships") or []:
        bad += _problems(f"{rel.get('id')}/{rel.get('type')}", rel)
    assert not bad, (
        "a fact or relationship with no source reference reaches the next skill "
        "as a claim from nowhere: " + "; ".join(bad)
    )


# --- V6: the note is dropped, not the source ----------------------------

def test_returned_sources_reach_the_tree_without_notes(after_state, tool_calls):
    """`person_read` emits `notes` on a source; `TREE_SOURCE_FIELDS` rejects the
    field, so a verbatim copy fails the `project_create` write. The plausible
    wrong fix is to drop the whole source -- silently losing evidence the survey
    found. Drop the note, keep the source.

    Joined on `title`, because the skill re-ids sources to S1... on the way in.
    """
    returned = []
    for response in _responses(tool_calls, "person_read"):
        returned += [
            s for s in response.get("sources") or [] if isinstance(s, dict)
        ]
    if not returned:
        pytest.skip("no source descriptions returned")
    written = _written_tree(after_state).get("sources") or []
    titles = {s.get("title") for s in written}

    bad = [
        f"{s.get('id')}: has notes {s['notes']!r}" for s in written if s.get("notes")
    ]
    bad += [
        f"{s.get('id')} {s.get('title')!r}: returned by person_read but absent "
        "from the tree"
        for s in returned if s.get("title") not in titles
    ]
    assert not bad, (
        "drop the note, keep the source -- the survey found it: " + "; ".join(bad)
    )


# --- V5: narration_guidance verbatim ------------------------------------

def test_narration_guidance_is_verbatim_for_the_level(after_state):
    """A closed four-way mapping: `experience_level` keys one fixed string, and
    SKILL.md calls it verbatim ("stored verbatim, not paraphrased").

    Its twin -- the objective's verbatim default -- already has a validator
    (`test_objective_default_verbatim`, issue #1510, added precisely so the
    check lived in code rather than in judge interpretation). This one did not.
    Every downstream SKILL.md reads this field as its narration style, so a
    paraphrase degrades every later invocation in the project.
    """
    research = after_state.get("research_json") or {}
    profile = research.get("researcher_profile") or {}
    level = profile.get("experience_level")
    guidance = profile.get("narration_guidance")
    if not level and not guidance:
        pytest.skip("no researcher_profile written")
    assert level in _NARRATION_BY_LEVEL, (
        f"experience_level {level!r} is not one of {sorted(_NARRATION_BY_LEVEL)}"
    )
    expected = _NARRATION_BY_LEVEL[level]
    assert guidance == expected, (
        f"narration_guidance for {level!r} must be the SKILL.md table text "
        f"verbatim.\n  expected: {expected!r}\n  got:      {guidance!r}"
    )


# --- V7: search before stubs (tag-gated) --------------------------------

def test_search_before_stubs(tool_calls, after_state, test):
    """Tag-gated on `expects-person-search`: when the premise is a named person
    with no id supplied and no claim that they are absent from FamilySearch,
    stubbing without searching mints the duplicate `merge_tree_persons` then has
    to undo.

    Tag-gated rather than derived from the message, and that narrowing is load
    bearing -- see the module note above. The premise belongs to the test
    author, who knows whether the message concedes absence; a validator parsing
    prose would have failed `ut_init_project_002`, which the 2026-08-20
    annotation confirmed as a pass.

    DORMANT ON THE CURRENT SUITE, deliberately: no init-project test carries the
    tag, so this skips on all twelve. `new-project-from-search`
    (`ut_init_project_004`) is its right home -- "I don't have his FamilySearch
    ID", no claim of absence, and it does search -- but adding a tag edits a
    snapshot-tracked test file, which would invalidate the run log this PR just
    bought and cost another paid run. Tag it on the next run that touches that
    file. Until then the firing behaviour is held by the mutation tests rather
    than by the suite, which is worth knowing when reading a run log where this
    line says "skipped".
    """
    if "expects-person-search" not in test.get("tags", []):
        pytest.skip("not an expects-person-search scenario")
    if not _written_tree(after_state).get("persons"):
        pytest.skip("no tree person written")
    called = {_tool(c) for c in tool_calls or []}
    assert "person_search" in called, (
        "a tree person was created without searching FamilySearch first; if the "
        "person is already in the tree this mints a duplicate. Tools called: "
        f"{sorted(called) or 'none'}"
    )
