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

from e2e.validate_fixture import DEFAULT_FIXTURES_ROOT, lint_fixture, record_hint_tree_errors


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


# --- a record-hint fixture strips nothing ------------------------------
#
# The check itself is `record_hint_tree_errors`, a hard error inside
# `lint_fixture`, so `test_committed_fixture_passes_the_hard_gates` and
# `make e2e-validate` both run it on every committed fixture. These cases prove
# it both ways on scratch fixtures.


def _record_hint_copy(tmp_path: Path, tree: dict, unstripped_text: str | None, genre: str = "record-hint") -> Path:
    d = tmp_path / "fx"
    d.mkdir()
    (d / "fixture.json").write_text(json.dumps({"genre": genre}), encoding="utf-8")
    (d / "starting-tree.gedcomx.json").write_text(json.dumps(tree), encoding="utf-8")
    if unstripped_text is not None:
        (d / "unstripped-tree.gedcomx.json").write_text(unstripped_text, encoding="utf-8")
    return d


_TREE = {
    "persons": [{"id": "P1", "names": [{"given": "Ann"}], "sources": [{"ref": "S1"}, {"ref": "S2"}]}],
    "relationships": [],
    "sources": [{"id": "S1", "title": "a"}, {"id": "S2", "title": "b"}],
}


def _stripped() -> dict:
    stripped = json.loads(json.dumps(_TREE))
    stripped["persons"][0]["sources"] = [{"ref": "S1"}]
    stripped["sources"] = [{"id": "S1", "title": "a"}]
    return stripped


def test_a_stripped_source_fails_the_record_hint_check(tmp_path):
    errors = record_hint_tree_errors(_record_hint_copy(tmp_path, _stripped(), json.dumps(_TREE)))
    assert len(errors) == 1 and "differ" in errors[0]


def test_a_missing_unstripped_tree_fails_the_record_hint_check(tmp_path):
    errors = record_hint_tree_errors(_record_hint_copy(tmp_path, _TREE, None))
    assert len(errors) == 1 and "--none" in errors[0]


def test_a_reformatted_identical_tree_passes_the_record_hint_check(tmp_path):
    reordered = {k: _TREE[k] for k in reversed(list(_TREE))}
    assert record_hint_tree_errors(_record_hint_copy(tmp_path, _TREE, json.dumps(reordered, indent=4))) == []


def test_a_strip_fixture_is_not_held_to_record_hint_equality(tmp_path):
    assert record_hint_tree_errors(_record_hint_copy(tmp_path, _stripped(), json.dumps(_TREE), genre="strip")) == []


# --- avoid-guard collisions: stop the defect propagating ---------------
#
# `apply_avoid_guard` (e2e/judge.py) runs `check_stripping` against the
# agent's FINAL tree and forces `matched: "false"` on any `avoid` finding
# whose given+surname tokens hit a person outside the exempt set
# (subject_person_ids u source_pid). `derive_verdict` needs every REQUIRED
# finding `true` for a `pass`. So an `avoid` finding that is both colliding
# and `required: true` makes the fixture unpassable: its ceiling is
# `partial`, on every run, including a perfect one.
#
# Three committed fixtures are in that state today. This test does NOT
# endorse them and does NOT fix them — which of four possible remedies to
# take is a doctrine call (relax the guard, drop `required`, re-author the
# findings, or exclude guard-forced findings from calibrate_judge's
# denominator). It pins the set so the defect cannot spread quietly, which
# matters because `thomas-seaver-other-wife` is the shape donor that
# `.claude/skills/resolve-record-hint/SKILL.md` tells the next author to
# copy — PR #2634 nearly inherited it that way.
#
# Fails in BOTH directions by construction: adding a fourth unpassable
# fixture fails it, and fixing one of the three fails it too. Either way a
# human has to look. If you fixed one, delete it from the set below and say
# so in your PR.

_KNOWN_UNPASSABLE_AVOID_FIXTURES = {
    "antonio-lucas-spouse",
    "heinrich-zinsmeister-death",
    "thomas-seaver-other-wife",
}


def _exempt_person_ids(fixture_dir: Path) -> set[str]:
    """Mirrors orchestrator.py's exempt set: subject_person_ids u source_pid."""
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


def test_no_new_fixture_becomes_unpassable_via_the_avoid_guard():
    from e2e.validate_fixture import check_stripping

    unpassable = set()
    for fixture_dir in FIXTURE_DIRS:
        tree_path = fixture_dir / "starting-tree.gedcomx.json"
        if not tree_path.exists():
            continue
        findings = _load(fixture_dir, "expected-findings.json").get("findings") or []
        avoid_required = [
            f
            for f in findings
            if str(f.get("polarity", "recover")) == "avoid" and f.get("required")
        ]
        if not avoid_required:
            continue
        exempt = _exempt_person_ids(fixture_dir)
        tree = json.loads(tree_path.read_text(encoding="utf-8"))
        suspects = [
            s
            for s in check_stripping({"findings": avoid_required}, tree)
            if s.person_id not in exempt
        ]
        if suspects:
            unpassable.add(fixture_dir.name)

    assert unpassable == _KNOWN_UNPASSABLE_AVOID_FIXTURES, (
        "the set of fixtures made unpassable by the avoid guard changed.\n"
        f"  now:      {sorted(unpassable)}\n"
        f"  expected: {sorted(_KNOWN_UNPASSABLE_AVOID_FIXTURES)}\n"
        "A NEW entry means a required `avoid` finding's name tokens collide "
        "with a non-exempt person in its own starting tree, so that fixture "
        "can never score `pass`. Either re-word the finding's `details` "
        "target name, or set `required: false` and document the cost in the "
        "fixture README (see hinrich-burmeister-spouse). A REMOVED entry "
        "means someone fixed one — delete it from the set and say so."
    )
