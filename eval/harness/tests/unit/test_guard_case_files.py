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

# Guards that predate the rule, and guards that never graduate. Frozen: a new
# guard is registered with a case file, not added here. Removing a name is the
# way out of the backlog, and it requires registering the guard.
FROZEN_OWES_CASE_FILE = frozenset(
    {
        "find_citation_nulling_in_conclusions",
        "find_citation_nulling_in_tree_sources",
        "find_relationship_writes_without_warnings_check",
        "find_conclusions_without_tree_encoding",
        "find_tree_facts_disagreeing_with_assertions",
        "find_protected_writes_by_unnamed_delegate",
        "find_person_evidence_missing_same_person",
        "find_effects_without_invocation",
        "find_missing_mentor_verdicts",
    }
)
FROZEN_NOT_A_CANDIDATE = frozenset({"find_unguarded_protected_writes"})


def _registry() -> dict:
    return json.loads((CASES_DIR / "registry.json").read_text(encoding="utf-8"))


def _guard_module_names(source: str) -> tuple[set[str], set[str]]:
    """(``find_*`` functions, ``*_KIND`` constants) defined at the top level of a
    guard module's source."""
    tree = ast.parse(source)
    detectors = {n.name for n in tree.body if isinstance(n, ast.FunctionDef) and n.name.startswith("find_")}
    kinds = {
        t.id
        for n in tree.body
        if isinstance(n, ast.Assign)
        for t in n.targets
        if isinstance(t, ast.Name) and t.id.endswith("_KIND")
    }
    return detectors, kinds


def _accounted(registry: dict) -> tuple[set[str], set[str]]:
    entries = (
        list(registry["guards"]) + list(registry["owes_case_file"]) + list(registry["not_a_candidate"])
    )
    detectors = {e.get("harness_detector") or e.get("detector") for e in entries} - {None}
    kinds = {e.get("kind") for e in entries} - {None}
    return detectors, kinds


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


def test_every_guard_in_the_harness_guard_module_is_accounted_for():
    assert _unaccounted(GUARD_MODULE.read_text(encoding="utf-8"), _registry()) == []


def test_the_backlog_and_the_exemptions_are_frozen():
    reg = _registry()
    assert {e["detector"] for e in reg["owes_case_file"]} == FROZEN_OWES_CASE_FILE
    assert {e["detector"] for e in reg["not_a_candidate"]} == FROZEN_NOT_A_CANDIDATE
    for e in reg["owes_case_file"] + reg["not_a_candidate"]:
        assert e.get("reason"), f"{e['detector']}: a backlog or exemption entry states why"


def test_no_registered_guard_is_also_in_the_backlog():
    reg = _registry()
    registered = {g["harness_detector"] for g in reg["guards"]}
    assert not registered & FROZEN_OWES_CASE_FILE
    assert not registered & FROZEN_NOT_A_CANDIDATE


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
