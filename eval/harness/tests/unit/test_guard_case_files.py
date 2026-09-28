"""The guard registry and its labelled case files — ADR-0011's graduation rule
made a checked precondition rather than a convention.

ADR-0011, "The bar is inspection, not a rate": a corpus replay proves only that a
candidate does not over-fire on real work, because in a replay the check is its
own ground truth. So a guard may neither enforce nor sit in shadow indefinitely
without a labelled case set — must-fire cases in at least two distinct shapes,
plus must-not-fire cases — and a guard on two planes keeps ONE JSON case file
that both planes replay. This file is the harness half:

1. every guard in the harness guard module (each ``find_*`` detector and each
   ``*_KIND`` shadow constant in ``harness/skill_invocation.py``) is accounted
   for in the registry, and the registry names nothing stale;
2. the backlog of guards that predate the rule, and the exemptions, are frozen
   here, so adding to either is a visible edit to this file and not a quiet one
   to a JSON list;
3. each registered guard's case file meets the rule and replays against its
   harness detector.

The vitest half, ``tests/tools/research-append-guard-cases.test.ts`` under the
engine, replays the same files through each writer-tool precondition.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from harness import skill_invocation

REPO = Path(__file__).resolve().parents[4]
CASES_DIR = REPO / "packages" / "engine" / "mcp-server" / "tests" / "guard-cases"
GUARD_MODULE = REPO / "eval" / "harness" / "harness" / "skill_invocation.py"

# Guards that predate the rule, and guards that never graduate, as exact
# (detector, kind) pairs. Frozen: a new guard is registered with a case file, not
# added here, and a new kind cannot ride in on an existing slot. Removing a pair
# is the way out of the backlog, and it requires registering the guard.
FROZEN_OWES_CASE_FILE = frozenset(
    {
        ("find_citation_nulling_in_conclusions", "CITATION_NULLING_KIND"),
        ("find_citation_nulling_in_tree_sources", "TREE_CITATION_NULLING_KIND"),
        ("find_relationship_writes_without_warnings_check", "WARNINGS_UNCHECKED_KIND"),
        ("find_conclusions_without_tree_encoding", "TREE_ENCODING_KIND"),
        ("find_tree_facts_disagreeing_with_assertions", "TREE_FACT_ASSERTION_KIND"),
        ("find_protected_writes_by_unnamed_delegate", None),
        ("find_person_evidence_missing_same_person", "PERSON_EVIDENCE_DENY_KIND"),
        ("find_effects_without_invocation", None),
        ("find_missing_mentor_verdicts", None),
    }
)
FROZEN_NOT_A_CANDIDATE = frozenset({("find_unguarded_protected_writes", None)})


def _registry() -> dict:
    return json.loads((CASES_DIR / "registry.json").read_text(encoding="utf-8"))


def _guard_module_names(source: str) -> tuple[set[str], set[str]]:
    """(``find_*`` detectors, ``*_KIND`` constants) bound at the top level of a
    guard module's source, however they are bound: ``def``, ``async def``, a
    plain or annotated assignment."""
    tree = ast.parse(source)
    bound: set[str] = set()
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            bound.add(n.name)
        elif isinstance(n, ast.Assign):
            bound.update(t.id for t in n.targets if isinstance(t, ast.Name))
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
            bound.add(n.target.id)
    return {b for b in bound if b.startswith("find_")}, {b for b in bound if b.endswith("_KIND")}


def _entries(registry: dict) -> list[dict]:
    return list(registry["guards"]) + list(registry["owes_case_file"]) + list(registry["not_a_candidate"])


def _detector_of(entry: dict) -> str | None:
    return entry.get("harness_detector") or entry.get("detector")


def _accounted(registry: dict) -> tuple[set[str], set[str]]:
    entries = _entries(registry)
    detectors = {_detector_of(e) for e in entries} - {None}
    kinds = {e.get("kind") for e in entries} - {None}
    return detectors, kinds


def _duplicates(registry: dict) -> list[str]:
    """A detector or a kind listed in more than one registry entry."""
    seen_detectors: set[str] = set()
    seen_kinds: set[str] = set()
    dupes = []
    for e in _entries(registry):
        d, k = _detector_of(e), e.get("kind")
        if d in seen_detectors:
            dupes.append(f"{d}: listed twice")
        if k is not None and k in seen_kinds:
            dupes.append(f"{k}: listed twice")
        seen_detectors.add(d)
        if k is not None:
            seen_kinds.add(k)
    return dupes


def _unaccounted(source: str, registry: dict) -> list[str]:
    """Names a guard module defines that the registry does not account for, and
    names the registry lists that the module no longer defines."""
    detectors, kinds = _guard_module_names(source)
    reg_detectors, reg_kinds = _accounted(registry)
    problems = [f"{n}: defined in the guard module but not in the registry" for n in sorted(detectors - reg_detectors)]
    problems += [f"{n}: defined in the guard module but not in the registry" for n in sorted(kinds - reg_kinds)]
    problems += [f"{n}: in the registry but not defined in the guard module" for n in sorted(reg_detectors - detectors)]
    problems += [f"{n}: in the registry but not defined in the guard module" for n in sorted(reg_kinds - kinds)]
    return problems


def _case_file_problems(case_file: dict) -> list[str]:
    """What stops a case file meeting ADR-0011's rule."""
    cases = case_file.get("cases")
    if not isinstance(cases, list) or not cases:
        return ["no cases"]
    problems = []
    ids = [c.get("id") for c in cases]
    if len(ids) != len(set(ids)):
        problems.append("duplicate case ids")
    for c in cases:
        if c.get("expect") not in ("fire", "silent"):
            problems.append(f"{c.get('id')}: expect must be fire or silent")
        if c.get("expect") == "fire" and not c.get("shape"):
            problems.append(f"{c.get('id')}: a fire case names its shape")
        if not isinstance(c.get("research"), dict) or not c.get("write"):
            problems.append(f"{c.get('id')}: needs research and the id it writes")
    shapes = {c.get("shape") for c in cases if c.get("expect") == "fire"} - {None}
    if len(shapes) < 2:
        problems.append(f"must-fire cases in at least two distinct shapes; found {sorted(shapes)}")
    if not any(c.get("expect") == "silent" for c in cases):
        problems.append("at least one must-not-fire case")
    return problems


def _replay_mismatches(case_file: dict, detector) -> list[str]:
    """Cases the harness detector decides differently from their label, judged
    for the summary each case writes."""
    out = []
    for c in case_file["cases"]:
        fired = any(v.get("proof_summary_id") == c["write"] for v in detector(c["research"]))
        if fired != (c["expect"] == "fire"):
            out.append(f"{c['id']}: expected {c['expect']}, detector {'fired' if fired else 'was silent'}")
    return out


# --- the precondition, over the real registry and guard module ---------------


def _pairs(entries: list[dict]) -> list[tuple[str | None, str | None]]:
    return [(_detector_of(e), e.get("kind")) for e in entries]


def test_every_guard_in_the_harness_guard_module_is_accounted_for():
    assert _unaccounted(GUARD_MODULE.read_text(encoding="utf-8"), _registry()) == []


def test_no_detector_or_kind_is_listed_twice():
    assert _duplicates(_registry()) == []


def test_the_backlog_and_the_exemptions_are_frozen():
    reg = _registry()
    owes, exempt = _pairs(reg["owes_case_file"]), _pairs(reg["not_a_candidate"])
    assert sorted(owes, key=str) == sorted(FROZEN_OWES_CASE_FILE, key=str)
    assert sorted(exempt, key=str) == sorted(FROZEN_NOT_A_CANDIDATE, key=str)
    for e in reg["owes_case_file"] + reg["not_a_candidate"]:
        assert e.get("reason"), f"{e['detector']}: a backlog or exemption entry states why"


def test_no_registered_guard_is_also_in_the_backlog():
    reg = _registry()
    registered = {g["harness_detector"] for g in reg["guards"]}
    frozen = {d for d, _ in FROZEN_OWES_CASE_FILE | FROZEN_NOT_A_CANDIDATE}
    assert not registered & frozen


@pytest.mark.parametrize("guard", _registry()["guards"], ids=lambda g: g["name"])
def test_registered_guard_meets_the_rule_and_replays(guard):
    case_file = json.loads((CASES_DIR / guard["case_file"]).read_text(encoding="utf-8"))
    assert _case_file_problems(case_file) == []
    detector = getattr(skill_invocation, guard["harness_detector"])
    assert _replay_mismatches(case_file, detector) == []


@pytest.mark.parametrize("guard", [g for g in _registry()["guards"] if g.get("writer_guard")], ids=lambda g: g["name"])
def test_registered_writer_guard_is_exported(guard):
    wg = guard["writer_guard"]
    source = (REPO / wg["file"]).read_text(encoding="utf-8")
    assert re.search(rf"^export function {re.escape(wg['function'])}\(", source, re.M), (
        f"{wg['file']} exports no function {wg['function']}"
    )


# --- the precondition can fail: each check, broken on purpose ----------------

_SOURCE = "def find_a(r):\n    return []\n\nA_KIND = 'a'\n"
_REG = {
    "guards": [{"name": "a", "harness_detector": "find_a", "kind": "A_KIND"}],
    "owes_case_file": [],
    "not_a_candidate": [],
}


def test_accounting_passes_a_fully_registered_module():
    assert _unaccounted(_SOURCE, _REG) == []


def test_accounting_catches_a_new_unregistered_detector_and_kind():
    source = _SOURCE + "\ndef find_b(r):\n    return []\n\nB_KIND = 'b'\n"
    problems = _unaccounted(source, _REG)
    assert any(p.startswith("find_b:") for p in problems)
    assert any(p.startswith("B_KIND:") for p in problems)


def test_accounting_catches_a_stale_registry_entry():
    reg = {**_REG, "owes_case_file": [{"detector": "find_gone", "kind": None, "reason": "x"}]}
    assert any(p.startswith("find_gone:") for p in _unaccounted(_SOURCE, reg))


@pytest.mark.parametrize(
    "binding, name",
    [
        ("async def find_b(r):\n    return []\n", "find_b"),
        ("find_b = lambda r: []\n", "find_b"),
        ("B_KIND: str = 'b'\n", "B_KIND"),
    ],
)
def test_accounting_sees_every_way_a_name_is_bound(binding, name):
    assert any(p.startswith(f"{name}:") for p in _unaccounted(_SOURCE + "\n" + binding, _REG))


def test_duplicates_catch_a_detector_or_kind_listed_twice():
    reg = {
        **_REG,
        "owes_case_file": [
            {"detector": "find_a", "kind": "NEW_KIND", "reason": "x"},
            {"detector": "find_c", "kind": "A_KIND", "reason": "x"},
        ],
    }
    dupes = _duplicates(reg)
    assert "find_a: listed twice" in dupes
    assert "A_KIND: listed twice" in dupes
    assert _duplicates(_REG) == []


def test_accounting_ignores_nested_and_non_find_names():
    source = _SOURCE + "\ndef helper():\n    def find_inner():\n        return []\n    return find_inner\n"
    assert _unaccounted(source, _REG) == []


def _case(cid, expect, shape=None):
    c = {"id": cid, "expect": expect, "write": "ps_001", "research": {}}
    if shape:
        c["shape"] = shape
    return c


def test_rule_accepts_two_fire_shapes_and_a_silent_case():
    cf = {"cases": [_case("a", "fire", "s1"), _case("b", "fire", "s2"), _case("c", "silent")]}
    assert _case_file_problems(cf) == []


@pytest.mark.parametrize(
    "cases, needle",
    [
        ([_case("a", "fire", "s1"), _case("b", "fire", "s1"), _case("c", "silent")], "two distinct shapes"),
        ([_case("a", "fire", "s1"), _case("b", "fire", "s2")], "must-not-fire"),
        ([_case("a", "fire"), _case("b", "fire", "s2"), _case("c", "silent")], "names its shape"),
        ([_case("a", "fire", "s1"), _case("a", "fire", "s2"), _case("c", "silent")], "duplicate"),
        ([], "no cases"),
    ],
)
def test_rule_rejects_a_case_file_that_falls_short(cases, needle):
    assert any(needle in p for p in _case_file_problems({"cases": cases}))


def test_replay_catches_a_label_the_detector_disagrees_with():
    def detector(research):
        return [{"proof_summary_id": "ps_001"}] if research.get("bad") else []

    good = {"cases": [{"id": "x", "expect": "fire", "write": "ps_001", "research": {"bad": True}}]}
    flipped = {"cases": [{"id": "x", "expect": "silent", "write": "ps_001", "research": {"bad": True}}]}
    other_summary = {"cases": [{"id": "x", "expect": "fire", "write": "ps_010", "research": {"bad": True}}]}
    assert _replay_mismatches(good, detector) == []
    assert _replay_mismatches(flipped, detector)
    assert _replay_mismatches(other_summary, detector), "ps_010 must not match a ps_001 violation"
