"""Corpus-wide gate for the committed e2e fixtures.

The tree schema drifted into fiction because nothing automated ran it: 25
of 26 committed starting trees failed it, silently, until the fixture-
authoring work audited them by hand — and the agent was repairing broken
fixtures mid-run, burning the tokens the fixtures exist to measure. This
test is the "never again": every push that touches a fixture or a schema
(eval-harness-tests.yml already triggers on both paths) re-lints the whole
corpus, offline and deterministically.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.validate_fixture import DEFAULT_FIXTURES_ROOT, lint_fixture


FIXTURE_DIRS = (
    sorted(
        p
        for p in DEFAULT_FIXTURES_ROOT.iterdir()
        if p.is_dir() and (p / "expected-findings.json").exists()
    )
    if DEFAULT_FIXTURES_ROOT.exists()
    else []
)


def _load(fixture_dir: Path, name: str) -> dict:
    return json.loads((fixture_dir / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("fixture_dir", FIXTURE_DIRS, ids=lambda p: p.name)
def test_committed_fixture_passes_the_hard_gates(fixture_dir: Path):
    # Suspects are advisory — the author reviews them at authoring time.
    # Hard errors (schema, reference integrity, duplicate ids, living
    # persons) fail the corpus.
    _, errors = lint_fixture(fixture_dir)
    assert errors == []


@pytest.mark.parametrize(
    "fixture_dir",
    [p for p in FIXTURE_DIRS if (p / "unstripped-tree.gedcomx.json").exists()],
    ids=lambda p: p.name,
)
def test_starting_tree_is_a_subset_of_its_unstripped_tree(fixture_dir: Path):
    """A starting tree is *derived* from the committed snapshot by removal
    only. A person in the starting tree that is absent from the unstripped
    one means the fixture was hand-edited out from under its snapshot, and
    a re-strip would silently revert the edit. (Vacuous while no committed
    fixture carries an unstripped tree; the parametrize keeps it
    self-populating as they land.)"""
    unstripped_pids = {
        str(p.get("id"))
        for p in _load(fixture_dir, "unstripped-tree.gedcomx.json").get("persons") or []
    }
    starting_pids = {
        str(p.get("id"))
        for p in _load(fixture_dir, "starting-tree.gedcomx.json").get("persons") or []
    }
    assert starting_pids <= unstripped_pids


# --- avoid-guard: which fixtures stay structurally unpassable ------------
#
# The avoid guard (`apply_avoid_guard`, e2e/judge.py): RELATIONSHIP avoid
# findings are subject-anchored (Dallan ruling, 2026-10-20) — forced only on a
# relationship the agent NEWLY attached to the subject (final vs starting) whose
# other end matches the target name, so a pre-existing namesake relative is not
# force-failed. FACT / PERSON / SOURCE avoid findings stay on the legacy
# whole-tree matcher (a subject-anchored fact branch was prototyped and withdrawn
# after review — it force-failed correct runs; Option 3, 2026-10-20).
#
# Consequence: the old guard force-failed a `required` avoid finding whose name
# collided with a legitimate starting-tree person on EVERY run (ceiling
# `partial`), which pinned antonio-lucas-spouse, heinrich-zinsmeister-death and
# thomas-seaver-other-wife. Making RELATIONSHIP avoids subject-anchored fixed the
# first and third. heinrich's avoid is a FACT finding, so it stays on the legacy
# path and remains force-failed on a no-op — the Death/Burial blind spot this PR
# leaves unresolved (spec §3.4.1).
#
# This test feeds the starting tree as the final tree (a perfect no-op run)
# through the REAL `apply_avoid_guard` (so the retained fact/person/source path
# stays exercised) and asserts the set of force-failed fixtures is EXACTLY the
# known blind spot. Fails both directions: a NEW unpassable fixture fails it, and
# fixing heinrich fails it too (then remove it from the set below and say so).
# `nothing-checks`: an avoid finding that can never score `true` looks exactly
# like an agent that over-claimed.
_KNOWN_UNPASSABLE_AVOID_FIXTURES = {"heinrich-zinsmeister-death"}


def _exempt_person_ids(fixture_dir: Path) -> set[str]:
    """Mirrors orchestrator.py's subject set: subject_person_ids u source_pid.

    This is the fixture's subject — the anchor the subject-anchored relationship
    guard needs (and the exempt id for the legacy fact/person/source path)."""
    exempt: set[str] = set()
    try:
        research = _load(fixture_dir, "starting-research.json")
        for sid in (research.get("project") or {}).get("subject_person_ids") or []:
            exempt.add(str(sid))
    except (OSError, json.JSONDecodeError):
        pass
    try:
        src = _load(fixture_dir, "fixture.json").get("source_pid")
    except (OSError, json.JSONDecodeError):
        src = None
    if src and "TODO" not in str(src):
        exempt.add(str(src))
    return exempt


def test_unpassable_avoid_fixtures_are_exactly_the_known_legacy_fact_blind_spot():
    from e2e.judge import apply_avoid_guard

    unpassable = set()
    for fixture_dir in FIXTURE_DIRS:
        tree_path = fixture_dir / "starting-tree.gedcomx.json"
        if not tree_path.exists():
            continue
        expected = _load(fixture_dir, "expected-findings.json")
        findings = expected.get("findings") or []
        if not any(str(f.get("polarity", "recover")) == "avoid" for f in findings):
            continue
        starting_tree = json.loads(tree_path.read_text(encoding="utf-8"))
        subject_ids = _exempt_person_ids(fixture_dir)
        # A judge output that passed every finding; the guard can only downgrade.
        per_finding = [{"finding_id": str(f.get("id")), "matched": "true"} for f in findings]
        graded = apply_avoid_guard(
            {"per_finding": per_finding, "verdict": "pass"},
            expected_findings=expected,
            final_tree=starting_tree,  # perfect no-op run: final == starting
            starting_tree=starting_tree,
            subject_person_ids=subject_ids,
        )
        if (graded.get("avoid_guard") or {}).get("forced_false"):
            unpassable.add(fixture_dir.name)

    assert unpassable == _KNOWN_UNPASSABLE_AVOID_FIXTURES, (
        "the set of fixtures force-failed on a perfect no-op run changed.\n"
        f"  now:      {sorted(unpassable)}\n"
        f"  expected: {sorted(_KNOWN_UNPASSABLE_AVOID_FIXTURES)}\n"
        "A NEW entry means a required avoid finding is structurally unpassable "
        "(relationship avoids should be subject-anchored; a fact/person/source "
        "avoid may collide on the legacy path). A REMOVED entry means someone "
        "resolved the blind spot — delete it from the set and say so in the PR."
    )


# Regression: the subject-anchored FACT branch (withdrawn, Option 3) force-failed
# a correct run that recovered a sibling finding's fact of the same type. On the
# legacy path the subject's own facts are exempt, so a legitimate recovery must
# NOT force the paired avoid finding. These three were the confirmed cases.
_FACT_AVOID_SIBLING_REGRESSION = [
    ("wasyl-kapach-birth", "f3"),
    ("inocente-lopez-death", "f3"),
    ("creszentia-haas-birth", "f3"),
]


@pytest.mark.parametrize("slug,avoid_id", _FACT_AVOID_SIBLING_REGRESSION)
def test_legacy_fact_avoid_does_not_force_a_legitimate_sibling_recovery(slug, avoid_id):
    from e2e.judge import apply_avoid_guard

    fixture_dir = DEFAULT_FIXTURES_ROOT / slug
    expected = _load(fixture_dir, "expected-findings.json")
    findings = expected.get("findings") or []
    avoid = next(f for f in findings if str(f.get("id")) == avoid_id)
    fact_type = (avoid.get("details") or {}).get("fact_type")
    assert fact_type, f"{slug}:{avoid_id} has no details.fact_type to exercise"
    subject_ids = _exempt_person_ids(fixture_dir)
    # Simulate a correct run: the subject legitimately gains a fact of that type
    # (a sibling recover finding asks for it). Fresh parse so starting is untouched.
    starting_tree = _load(fixture_dir, "starting-tree.gedcomx.json")
    final_tree = _load(fixture_dir, "starting-tree.gedcomx.json")
    added = False
    for p in final_tree.get("persons") or []:
        if str(p.get("id")) in subject_ids:
            p.setdefault("facts", []).append(
                {"id": "FREG", "type": fact_type, "date": "1 Jan 1900",
                 "standard_date": "+1900-01-01"})
            added = True
            break
    assert added, f"{slug}: no subject person found to attach a recovered fact"
    per_finding = [{"finding_id": str(f.get("id")), "matched": "true"} for f in findings]
    graded = apply_avoid_guard(
        {"per_finding": per_finding, "verdict": "pass"},
        expected_findings=expected,
        final_tree=final_tree,
        starting_tree=starting_tree,
        subject_person_ids=subject_ids,
    )
    forced_ids = {
        e["finding_id"] for e in (graded.get("avoid_guard") or {}).get("forced_false") or []
    }
    assert avoid_id not in forced_ids, (
        f"{slug}: a legitimate sibling recovery of a {fact_type} fact on the "
        f"subject wrongly force-failed the avoid finding {avoid_id}. The "
        f"withdrawn subject-anchored fact branch did this; the legacy path must not."
    )
