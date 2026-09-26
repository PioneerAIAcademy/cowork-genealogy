"""Nothing silently stops being enforced when ownership moves out of Python.

`validators/test_universal.py` used to carry two dict literals. They now live in
`docs/specs/schemas/ownership.json`, and a JSON file is much easier to edit than
a literal sitting next to the check that reads it — an owner can be dropped in a
one-line diff that reads like tidying.

So the literals are pasted below **verbatim, as they stood before the move**, and
this module asserts the manifest still produces them. Deleting an owner reddens
this test. Adding one reddens it too, which is the point: a widening is a
decision, and it should have to be written down here.

Four deltas are declared explicitly below — one newly-enforced section, two
widenings (one per artifact), one narrowing — each with the reason it was made
and the measurement behind it. They are the only four.

**This is not `make harness-test`'s ownership result.** `pyproject.toml` sets
`testpaths = ["tests"]`, so `validators/test_universal.py::test_ownership_table`
is never collected by the harness's own suite — its real pass/fail set is
produced only inside a paid per-skill eval run. What this module checks is the
declaration, which is free and runs on every push.
"""

from __future__ import annotations

import pytest

from harness.ownership import (
    REPO_ROOT,
    RESEARCH_JSON,
    TREE_GEDCOMX_JSON,
    UNIT_PLANE,
    OwnershipManifestError,
    load_manifest,
    rows,
    writer_sets,
)


# ── The literals, exactly as `test_universal.py` carried them ───────────────

FROZEN_TREE_OWNERSHIP_TABLE: dict[str, set[str]] = {
    "persons": {"init-project", "tree-edit", "proof-conclusion",
                "person-evidence"},
    "relationships": {"init-project", "tree-edit", "proof-conclusion",
                      "person-evidence"},
    "sources": {"init-project", "tree-edit", "proof-conclusion",
                "record-extraction"},
}


FROZEN_OWNERSHIP_TABLE: dict[str, set[str]] = {
    "project": {"init-project", "proof-conclusion"},
    "questions": {"question-selection", "research-exhaustiveness"},
    "plans": {"research-plan", "search-records", "search-external-sites",
              "search-full-text", "search-images", "record-extraction"},
    "log": {"search-records", "search-external-sites", "record-extraction",
            "search-full-text", "search-images"},
    "sources": {"record-extraction", "citation"},
    "assertions": {"record-extraction", "convert-dates"},
    "person_evidence": {"person-evidence"},
    "conflicts": {"conflict-resolution"},
    "hypotheses": {"hypothesis-tracking"},
    "timelines": {"timeline"},
    "proof_summaries": {"proof-conclusion"},
    "localities": {"locality-guide"},
}


# ── The four deltas, and why each was made ─────────────────────────────────

#: `localities` had a declared owner from the day the section shipped and was
#: never once evaluated: the check iterated `REQUIRED_SECTIONS`, which the
#: section was missing from. Promotion is what first enforces it. It cannot
#: newly fail a non-owner's test unless that non-owner writes the section:
#: across the unit corpus, 8 tests run against a scenario carrying a non-empty
#: `localities` (all in `research-plan`, a documented pure consumer), plus
#: `locality-guide`'s own persist test.
NEWLY_ENFORCED = {"localities"}

#: `questions` gains `proof-conclusion`. The transition it covers —
#: `status -> resolved` — was owned by nobody: `proof-conclusion`'s body hands
#: it to `question-selection`, `question-selection`'s body hands it back, and
#: across 154 committed runs 150 questions reached `resolved` from 11 different
#: skill contexts. The prose ownership table, the write-boundary gate's remedy
#: text, and the batches that write a summary and its resolve together all name
#: `proof-conclusion`. A widening cannot newly fail a test; the matching skill
#: body edit is a separate, eval-gated change.
WIDENED: dict[str, set[str]] = {"questions": {"proof-conclusion"}}

#: `assertions` loses `convert-dates`. The grant was dead on arrival: the skill's
#: only tool is `convert_calendar`, it holds no writer tool, and its own body
#: says it writes nothing. A narrowing is the direction that CAN break a run, so
#: it was measured first — none of the skill's 14 unit tests names
#: `research_append` or `assertions`, and with no writer tool there is no call it
#: could emit that this would refuse.
#:
#: Declaring it here rather than editing the frozen literal above is the point:
#: the literal stays a verbatim copy of what was enforced before, and every
#: departure from it is a line someone had to write.
NARROWED: dict[str, set[str]] = {"assertions": {"convert-dates"}}


# The suite subject the research.json rows need to resolve (issue #2799). The
# `sources` row names `agent:citation`, and `writer_sets` reads an `agent:`
# caller only when it IS the subject — so the freeze below is taken from
# citation's own vantage point. Note what that buys: the frozen set for
# `sources` is UNCHANGED at {"record-extraction", "citation"}. The conversion
# moved how the caller is spelled, not who may write, and this test is what
# says so.
#: Every agent that is both a unit-suite subject and an `agent:` caller in the
#: manifest. `writer_sets` reads an `agent:` caller ONLY when it is the subject
#: (ownership.py's agent rule), so no single vantage point can see the whole
#: manifest any more: from `citation` the `proof-conclusion` rows resolve to
#: nobody, and vice versa. The union over every subject is the manifest as the
#: unit plane actually enforces it, one suite at a time.
#:
#: The frozen tables below stay unchanged across a conversion, and that is the
#: point: it proves the conversion moved how a caller is SPELLED, not who may
#: write. Editing a frozen table to drop a converted skill is the wrong fix --
#: it makes this free suite green and the paid run red.
SUBJECTS = ("citation", "proof-conclusion")


def _union_writer_sets(artifact: str) -> dict[str, set[str]]:
    merged: dict[str, set[str]] = {}
    for subject in SUBJECTS:
        for section, writers in writer_sets(artifact, UNIT_PLANE, subject=subject).items():
            merged.setdefault(section, set()).update(writers)
    return merged


#: tree `persons` and `relationships` gain `forget-and-rederive`. It holds
#: `tree_forget` in its `allowed-tools`, and both rows list that tool among their
#: `writerTools`, so it was a writer of both sections that no row named — one of
#: the nine (holder, writer tool) pairs the new packaging guard finds
#: (`ownership-manifest.test.ts`, "names every plugin holder of a writer tool").
#: It is a `skill:`, so it goes straight into `callers` rather than the
#: `agentCallers` the other eight needed.
#:
#: A widening cannot newly fail a test, and this one cannot fail anything at all:
#: the skill has no unit suite (it is in `RUNLOG_GATE_EXEMPT_SKILLS` for exactly
#: that reason), so no run is graded against this writer set.
TREE_WIDENED: dict[str, set[str]] = {
    "persons": {"forget-and-rederive"},
    "relationships": {"forget-and-rederive"},
}


def expected_tree_owners() -> dict[str, set[str]]:
    expected = {k: set(v) for k, v in FROZEN_TREE_OWNERSHIP_TABLE.items()}
    for section, added in TREE_WIDENED.items():
        expected[section] |= added
    return expected


def expected_research_owners() -> dict[str, set[str]]:
    expected = {k: set(v) for k, v in FROZEN_OWNERSHIP_TABLE.items()}
    for section, added in WIDENED.items():
        expected[section] |= added
    for section, removed in NARROWED.items():
        expected[section] -= removed
    return expected


# ── The freeze ─────────────────────────────────────────────────────────────


def test_research_owners_match_the_frozen_tables():
    assert _union_writer_sets(RESEARCH_JSON) == expected_research_owners()


def test_tree_owners_match_the_frozen_table():
    assert writer_sets(TREE_GEDCOMX_JSON, UNIT_PLANE) == expected_tree_owners()


def test_the_only_newly_enforced_section_is_localities():
    """The set of enforced sections grew by exactly what was declared.

    Separate from the mapping check above so the failure message says *which*
    kind of change happened — a new section being enforced and an owner being
    added to an existing one are different decisions with different costs.
    """
    before = set(FROZEN_OWNERSHIP_TABLE) - NEWLY_ENFORCED
    after = set(_union_writer_sets(RESEARCH_JSON))
    assert after - before == NEWLY_ENFORCED
    assert before - after == set()


def test_no_owner_was_dropped_except_the_declared_one():
    """Every writer the literals named is still a writer, bar `NARROWED`.

    Redundant with the mapping equality above only while that assertion holds
    as equality. It is here because dropping an owner and widening one are the
    two directions of the same edit, and only one of them can quietly weaken
    the check — so the drop side gets its own named assertion and its own
    allow-list, which is a place a reviewer can look.
    """
    actual = _union_writer_sets(RESEARCH_JSON)
    dropped = {
        section: sorted((frozen - actual.get(section, set())) - NARROWED.get(section, set()))
        for section, frozen in FROZEN_OWNERSHIP_TABLE.items()
        if (frozen - actual.get(section, set())) - NARROWED.get(section, set())
    }
    assert dropped == {}

    tree_actual = writer_sets(TREE_GEDCOMX_JSON, UNIT_PLANE)
    tree_dropped = {
        section: sorted(frozen - tree_actual.get(section, set()))
        for section, frozen in FROZEN_TREE_OWNERSHIP_TABLE.items()
        if frozen - tree_actual.get(section, set())
    }
    assert tree_dropped == {}


# ── Invariants the loader depends on ───────────────────────────────────────


def test_a_unit_plane_agent_caller_is_a_suite_subject():
    """A unit-plane row may name an agent caller ONLY if that agent owns a suite.

    Reverses the pre-#2799 rule that no unit-plane row could name an agent at
    all. The reason that rule held was that the check reads one frontmatter
    `name` and has no view of which agent made a call. That is still true of
    every agent except one: the suite's own subject, whose `name` is exactly
    what `load_suite_frontmatter` reads off `agents/<n>.md`. So the exception
    is one name wide, and this test is what keeps it one name wide.

    Both halves are load-bearing:

    - `agents/<n>.md` must exist, or the name resolves to nothing and the row
      authorizes an agent that does not ship.
    - `eval/tests/unit/<n>/` must exist, or nothing ever passes `<n>` as the
      subject, and the row silently authorizes no one while looking like it
      authorizes someone.

    `evaluations` (`agent:gps-mentor`) stays off the unit plane and is untouched
    by this: it claims no plane, so it never reaches the filter below.
    """
    repo_root = REPO_ROOT
    agents_dir = repo_root / "packages" / "engine" / "plugin" / "agents"
    suites_dir = repo_root / "eval" / "tests" / "unit"

    offending = []
    for r in rows():
        if UNIT_PLANE not in (r.get("enforceableAt") or []):
            continue
        for c in r.get("callers") or []:
            if not c.startswith("agent:"):
                continue
            name = c[len("agent:") :]
            if not (agents_dir / f"{name}.md").is_file():
                offending.append(f"{r['artifact']}.{r['section']}: {c} ships no agent file")
            elif not (suites_dir / name).is_dir():
                offending.append(
                    f"{r['artifact']}.{r['section']}: {c} has no eval/tests/unit/{name}/ "
                    f"suite, so it is never the subject and this row authorizes no one"
                )
    assert offending == []


def test_the_loader_resolves_an_agent_caller_only_for_its_own_subject(monkeypatch):
    """The structural guard above is only worth having if resolution matches it.

    Dropping a non-subject agent is safe ONLY because that guard proves every
    such agent owns a suite of its own, where it IS the subject. This pins the
    resolution half of that pair.
    """
    manifest = load_manifest()
    poisoned = {
        **manifest,
        "rows": [
            {
                "artifact": RESEARCH_JSON,
                "section": "evaluations",
                "owner": "agent:gps-mentor",
                "callers": ["agent:gps-mentor"],
                "writerTools": ["research_append"],
                "enforceableAt": [UNIT_PLANE],
            }
        ],
    }
    monkeypatch.setattr("harness.ownership.load_manifest", lambda: poisoned)
    # The #2799 exception is exactly one name wide: the agent resolves when it
    # IS the subject, and is dropped for every other subject (and for none).
    assert writer_sets(RESEARCH_JSON, UNIT_PLANE, subject="gps-mentor") == {
        "evaluations": {"gps-mentor"}
    }
    assert writer_sets(RESEARCH_JSON, UNIT_PLANE, subject="citation") == {
        "evaluations": set()
    }
    assert writer_sets(RESEARCH_JSON, UNIT_PLANE) == {"evaluations": set()}


def test_every_row_declares_an_artifact_the_harness_knows():
    unknown = sorted(
        {r["artifact"] for r in rows()} - {RESEARCH_JSON, TREE_GEDCOMX_JSON}
    )
    assert unknown == []


def test_hook_plane_rows_name_the_agent_that_may_write():
    """A row claiming the `hook` plane must say WHICH agent the hook permits.

    `callers` cannot carry it: the unit plane keys on the calling skill's
    frontmatter name, so a row enforced at both planes would raise (the test
    above pins that). The agent therefore lives in `hookCallers`, and without
    this assertion a row could claim the plane while naming no permitted caller
    at all — from which a later phase would derive a rule that denies everyone,
    the `deny unless ==` polarity ADR-0011 warns about.
    """
    missing = [
        r["section"]
        for r in rows()
        if "hook" in r.get("enforceableAt", [])
        and not [c for c in r.get("hookCallers", []) if c.startswith("agent:")]
    ]
    assert missing == [], (
        "these rows are declared enforceable at the hook plane but name no "
        f"`hookCallers` agent, so nothing says who may write them: {missing}"
    )
