#!/usr/bin/env python3
"""Measure the refusal rate behind issue #2535's relationship-direction rule.

Committed rather than pasted into a PR body: PR #2601's drift review found its
satisfiability script was "in neither the body nor the repo", and a rate nobody
can re-derive is a rate nobody can challenge.

THE RULE, which is one rule serving both the eval validator and the write-path
deny. `structured_value.relationship_type` names the record subject's OWN role
(`research-schema-spec.md` 5.6.1); `related_person_role` names the other
party's. A `value` that opens `<relation> of <name>` therefore states the
subject's role and can be compared against the type. A value that opens
`<relation> named as X` or `<relation>: X` LABELS the other party and says
nothing about the subject, so it is skipped. Anything else is skipped.

Refuse only when all three hold:

    1. the value opens `<relation> of <name>`
    2. that relation's category is one the table knows
    3. `relationship_type`'s category differs from it

Stating it loosely matters: a rule that merely looks for a disagreeing relation
word ANYWHERE in the value refuses 27 legitimate writes over the full
population below (`--counterfactual` re-derives it), because
values routinely name a second party in passing ("child of Hannah Grice
(wife)").

An unknown spelling (`stepfather`, `father_in_law`) yields no category and is
SKIPPED, never refused -- the designed fail-open at
`validators/test_record_extraction.py`.

Usage:
    cd eval/harness && uv run python scripts/measure_relationship_direction.py
    ... --json              machine-readable, for stamping a rate into a spec
    ... --counterfactual    what the pre-#2535 word-anywhere rule refused
    ... --axes              why record_role may not be required to match
    ... --domain            what sits outside the guard fact_type scope
    ... --self-referential  related_person_role holding the persona own role

Every arm folds fact_type through the engine alias table, so all of them mean
the same thing by "a relationship assertion" as the engine does.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), "validators"))

from validators.test_record_extraction import (  # noqa: E402
    _relationship_category,
    _subject_role_in_value,
)

REPO = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
#: Files that could not be read or parsed, named in the output rather than
#: silently dropped: a silent under-count reads as a measured zero. PR #2601's
#: drift review made exactly this fix to `measure_negative_evidence.py`.
SKIPPED: list[str] = []


def _relationship_aliases():
    """fact_types the engine folds INTO `relationship` before the guard runs.

    Read out of the engine's own table rather than restated, so the two
    cannot drift. This matters only for the run-log populations: a unit log
    carries the assertion as it was PASSED to `research_append`, before
    `canonicalizeAssertionLabels` folds it, so a `parentage` write is inside
    the guard's domain while reading as outside this script's. A persisted
    `research.json` is already folded, which is why the eval validator's
    exact match is right for ITS input and this is right for this one.
    """
    src = os.path.join(REPO, "packages", "engine", "mcp-server", "src",
                       "tools", "research-append.ts")
    with open(src, encoding="utf-8") as fh:
        text = fh.read()
    block = text.split("const FACT_TYPE_ALIASES", 1)[-1].split("\n};", 1)[0]
    table = dict(re.findall(r'^\s*(\w+):\s*"([^"]+)"', block, re.M))
    folds = {k for k, v in table.items() if v == "relationship"}
    # An empty parse would silently narrow the population back to exact
    # matches and read as 'the engine folds nothing'.
    if "parentage" not in folds:
        raise SystemExit("could not read FACT_TYPE_ALIASES from %s -- the engine's table moved, and a silent empty parse would understate the measured population" % src)
    return folds


_FOLDS_INTO_RELATIONSHIP = _relationship_aliases()


def _is_relationship(fact_type):
    key = re.sub(r"[^a-z0-9]", "", str(fact_type or "").lower())
    return key in _FOLDS_INTO_RELATIONSHIP


def _sha():
    try:
        return subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"],
                              capture_output=True, text=True,
                              encoding="utf-8",
                              errors="replace").stdout.strip()[:9]
    except OSError:
        return "unknown"


def disagrees(relationship_type, value):
    """True when `value` states a subject role the type contradicts.

    The predicate itself is imported from the validator rather than restated,
    so the rate this script reports and the rule the harness enforces cannot
    drift apart -- which is the whole reason the rate is worth recording.
    """
    want = _relationship_category(relationship_type)
    if not want or not value:
        return False
    states = _subject_role_in_value(value)
    return bool(states) and want != states


def _assertions_in(doc):
    """Every relationship assertion in a document, wherever it is carried.

    A `.final-research.json` holds them at the top level. A unit run log holds
    them inside `tests[].*` states and inside `tool_calls[].args` -- and those
    are where issue #2535's live, reproducing defect actually sits, so a walk
    that reaches only the first shape measures a population that excludes the
    thing the guard exists to catch.

    `fact_type` is folded through the engine's alias table, because the
    `tool_calls[].args` shape is pre-fold: an exact match would drop the
    `parentage` and `familycomposition` writes the guard does see.
    """
    seen = set()

    def walk(node):
        if isinstance(node, dict):
            if (_is_relationship(node.get("fact_type"))
                    and isinstance(node.get("structured_value"), dict)):
                key = (str(node.get("id")), str(node.get("value")))
                if key not in seen:
                    seen.add(key)
                    yield node
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)

    yield from walk(doc)


def _scan(paths):
    checkable, rows = 0, []
    for path in paths:
        if path.endswith(".ann.json"):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError) as exc:
            SKIPPED.append("%s (%s)" % (os.path.relpath(path, REPO),
                                        type(exc).__name__))
            continue
        for a in _assertions_in(doc):
            sv = a.get("structured_value") or {}
            rt = sv.get("relationship_type")
            value = str(a.get("value") or "")
            if not _relationship_category(rt) or not value:
                continue
            checkable += 1
            if disagrees(rt, value):
                rows.append((os.path.basename(path), str(a.get("id")),
                             str(rt), value[:58]))
    return checkable, rows


def _axes():
    """`record_role` is the persona's role in the RECORD; `relationship_type`
    is their role in ONE relationship assertion, and a persona carries
    several. Both figures below come from the same glob and the same
    fact_type filter, because an earlier revision took them from different
    populations and the two could not be reconciled by a reader.

    'Comparable' means: the assertion is fact_type relationship -- folded
    through the engine's alias table, as every arm here does, so the arms
    cannot disagree about what the word means -- its
    relationship_type maps through the category table, AND its record_role
    does too -- a rule could only ever compare those.
    """
    from validators.test_record_extraction import _RELATION_CATEGORY  # noqa: F401

    paths = sorted(glob.glob(os.path.join(
        REPO, "eval", "**", "*final-research.json"), recursive=True))
    comparable = disagree = correct = 0
    personas = {}
    for path in paths:
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError) as exc:
            SKIPPED.append("%s (%s)" % (os.path.relpath(path, REPO),
                                        type(exc).__name__))
            continue
        if not isinstance(doc, dict):
            continue
        for a in doc.get("assertions") or []:
            if not isinstance(a, dict):
                continue
            if not _is_relationship(a.get("fact_type")):
                continue
            sv = a.get("structured_value")
            if not isinstance(sv, dict):
                continue
            rt = _relationship_category(sv.get("relationship_type"))
            if not rt:
                continue
            key = (os.path.basename(path), str(a.get("record_id")),
                   str(a.get("record_role")))
            personas.setdefault(key, set()).add(rt)
            own = _relationship_category(a.get("record_role"))
            if not own:
                continue
            comparable += 1
            if rt != own:
                disagree += 1
                # The shipped prose rule is the arbiter: where it does not
                # refuse, a record_role rule would have refused correct data.
                if not disagrees(sv.get("relationship_type"),
                                 str(a.get("value") or "")):
                    correct += 1
    multi = sum(1 for v in personas.values() if len(v) > 1)
    print("record_role vs relationship_type are different axes "
          "(measured at %s)" % _sha())
    print("  population: eval/**/*final-research.json, fact_type "
          "relationship")
    print("  requiring the two to agree refuses %d of %d comparable,"
          % (disagree, comparable))
    print("    of which %d are correct data by the shipped rule" % correct)
    print("  %d of %d personas carrying a relationship assertion carry"
          % (multi, len(personas)))
    print("    more than one category")
    return 0


def _domain():
    """What the guard does NOT look at, and would if the scope widened.

    The scope comment in `research-append.ts` cites this, so it is emitted
    rather than pasted. Counted AFTER the engine's alias fold, because
    `parentage` and `familycomposition` are inside the scope, not outside
    it -- an earlier revision of that comment counted them as outside.
    """
    import collections

    outside = collections.Counter()
    for name, paths in _populations().items():
        for path in paths:
            if path.endswith(".ann.json"):
                continue
            try:
                with open(path, encoding="utf-8") as fh:
                    doc = json.load(fh)
            except (OSError, ValueError) as exc:
                SKIPPED.append("%s (%s)" % (os.path.relpath(path, REPO),
                                            type(exc).__name__))
                continue
            for ft, rt in _categorised_non_relationship(doc):
                outside[ft] += 1
    print("outside the guard's fact_type scope, but carrying a "
          "categorised relationship_type (measured at %s)" % _sha())
    print("  population: the four scanned above, fact_type folded through "
          "the engine's alias table")
    print("  %d assertions across %d fact types"
          % (sum(outside.values()), len(outside)))
    for ft, n in outside.most_common():
        print("    %-22s %d" % (ft, n))
    return 0


def _categorised_non_relationship(doc):
    """(fact_type, relationship_type) for assertions the guard skips."""
    seen = set()

    def walk(node):
        if isinstance(node, dict):
            sv = node.get("structured_value")
            ft = node.get("fact_type")
            if (isinstance(sv, dict) and ft is not None
                    and not _is_relationship(ft)):
                rt = sv.get("relationship_type")
                if _relationship_category(rt):
                    key = (str(node.get("id")), str(node.get("value")))
                    if key not in seen:
                        seen.add(key)
                        yield (re.sub(r"[^a-z0-9]", "", str(ft).lower()),
                               str(rt))
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)

    yield from walk(doc)


def _self_referential():
    """`related_person_role` holding the persona's OWN `record_role`.

    The 2026-09-07 rejection turned on this shape. It is a CONTENT defect
    -- the field populated with the wrong party -- not the axis mismatch
    the relationship_type rule addresses, so stating the convention does
    not repair it. Kept here so the spec cites a command, and kept
    separate so nobody quotes one guard's rate as the other's.
    """
    strip = lambda v: re.sub(r"_(\d+|inferred)$", "", str(v or "").strip().lower())
    total, shapes = 0, {}
    for path in sorted(glob.glob(os.path.join(
            REPO, "eval", "**", "*final-research.json"), recursive=True)):
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError) as exc:
            SKIPPED.append("%s (%s)" % (os.path.relpath(path, REPO),
                                        type(exc).__name__))
            continue
        if not isinstance(doc, dict):
            continue
        for a in doc.get("assertions") or []:
            if not isinstance(a, dict):
                continue
            if str(a.get("fact_type") or "").lower() not in (
                    "relationship", "marriage"):
                continue
            sv = a.get("structured_value")
            if not isinstance(sv, dict) or sv.get("related_person_role") is None:
                continue
            total += 1
            own = strip(a.get("record_role"))
            if own and own == strip(sv.get("related_person_role")):
                k = (own, str(a.get("fact_type")).lower())
                shapes[k] = shapes.get(k, 0) + 1
    hits = sum(shapes.values())
    pct = (100.0 * hits / total) if total else 0.0
    print("related_person_role holding the persona's OWN record_role")
    print("  %d of %d (%.1f%%), measured at %s" % (hits, total, pct, _sha()))
    print("  denominator: relationship+marriage assertions that CARRY the "
          "field, since a cross-check cannot run where it is absent.")
    print("  %d distinct (record_role, fact_type) shapes:" % len(shapes))
    for k, v in sorted(shapes.items(), key=lambda kv: (-kv[1], kv[0])):
        print("     %-30s %d" % ("%s / %s" % k, v))
    return 0


def _counterfactual():
    """What the pre-#2535 word-anywhere rule refused, and what it cost.

    Reported PER POPULATION, because the same number is right on one and
    wrong on another -- which is how a correct figure ended up beside a
    rate measured over a wider set and read as an error. The new rule is
    the arbiter: where it does not refuse, the old rule refused correct
    data."""
    from validators.test_record_extraction import _RELATION_CATEGORY

    any_rel = re.compile(r"\b(" + "|".join(_RELATION_CATEGORY) + r")\b", re.I)
    pops = {
        "runlogs only": [("eval", "runlogs", "**", "*final-research.json")],
        "runlogs + fixtures": [
            ("eval", "runlogs", "**", "*final-research.json"),
            ("eval", "fixtures", "**", "research.json")],
        "full script population": [
            ("eval", "runlogs", "**", "*final-research.json"),
            ("eval", "runlogs", "unit", "**", "*.json"),
            ("eval", "fixtures", "**", "research.json"),
            ("apps", "server", "app", "seed", "**", "research.json"),
            ("apps", "electron", "test", "**", "research.json")],
    }
    print("the pre-#2535 word-anywhere rule, per population "
          "(measured at %s)" % _sha())
    for name, globs in pops.items():
        paths = sorted({p for g in globs
                        for p in glob.glob(os.path.join(REPO, *g),
                                           recursive=True)})
        flagged = wrong = out_of_cat = 0
        spellings = set()
        for path in paths:
            if path.endswith(".ann.json"):
                continue
            try:
                with open(path, encoding="utf-8") as fh:
                    doc = json.load(fh)
            except (OSError, ValueError):
                continue
            for a in _assertions_in(doc):
                sv = a.get("structured_value") or {}
                rt = sv.get("relationship_type")
                value = str(a.get("value") or "")
                if rt is None or not value:
                    continue
                want = _relationship_category(rt)
                if want is None:
                    out_of_cat += 1
                    spellings.add(str(rt).lower().replace("_inferred", ""))
                    continue
                found = {_RELATION_CATEGORY[w.lower()]
                         for w in any_rel.findall(value)}
                if found and want not in found:
                    flagged += 1
                    if not disagrees(rt, value):
                        wrong += 1
        print("  %-24s flagged %-4d of which correct data %-4d | "
              "out-of-category %d across %d spellings"
              % (name, flagged, wrong, out_of_cat, len(spellings)))
    return 0


def _populations():
    """The four scanned populations, named so an arm cannot quietly use
    a different one than the headline rate does."""
    def g(*p):
        return sorted(glob.glob(os.path.join(REPO, *p), recursive=True))

    return {
        "e2e run logs": g("eval", "runlogs", "**", "*final-research.json"),
        "unit run logs": g("eval", "runlogs", "unit", "**", "*.json"),
        "eval fixtures": g("eval", "fixtures", "**", "research.json"),
        "shipped seed + app fixtures":
            g("apps", "server", "app", "seed", "**", "research.json")
            + g("apps", "electron", "test", "**", "research.json"),
    }


def _report_skipped():
    if SKIPPED:
        print("\nUNREADABLE (not counted -- a silent skip reads as a zero):")
        for s in SKIPPED:
            print("  " + s)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    ap.add_argument(
        "--axes", action="store_true",
        help="instead, report why relationship_type may not be required to "
             "match record_role: they are different axes. Emits the two "
             "figures research-schema-spec 5.6.1 cites, over one named "
             "population.",
    )
    ap.add_argument(
        "--self-referential", action="store_true",
        help="instead, report related_person_role holding the persona's "
             "OWN record_role -- the 2026-09-07 rejection's shape. A "
             "DIFFERENT guard from the one above; do not quote its rate "
             "as this one's.",
    )
    ap.add_argument(
        "--domain", action="store_true",
        help="instead, report what sits OUTSIDE the guard's fact_type "
             "scope while still carrying a categorised relationship_type "
             "-- the figure the scope comment in research-append.ts "
             "cites.",
    )
    ap.add_argument(
        "--counterfactual", action="store_true",
        help="instead, report what the pre-2535 word-anywhere rule "
             "refused and how much of it was correct data, per "
             "population, plus the out-of-category spellings.",
    )
    args = ap.parse_args()
    # Each arm returns THROUGH here: an unreadable file is not counted, so
    # a silent skip reads as a zero in whichever arm hit it, not just the
    # default one.
    for flag, arm in ((args.axes, _axes),
                      (args.self_referential, _self_referential),
                      (args.counterfactual, _counterfactual),
                      (args.domain, _domain)):
        if flag:
            rc = arm()
            _report_skipped()
            return rc

    populations = _populations()

    out = {}
    for name, paths in populations.items():
        checkable, rows = _scan(paths)
        out[name] = {"checkable": checkable, "refusals": len(rows), "rows": rows}

    sha = _sha()

    total_c = sum(v["checkable"] for v in out.values())
    total_r = sum(v["refusals"] for v in out.values())
    # A unit run log carries the same assertion twice -- once as the write op
    # under `tool_calls[].args`, once persisted. Both are real sightings, and
    # the write-op view is the one the deny actually sees, but "read every
    # refusal" means the DISTINCT count. Print both rather than let a reader
    # discover the difference.
    distinct = len({(r[2], r[3]) for v in out.values() for r in v["rows"]})
    pct = (100.0 * total_r / total_c) if total_c else 0.0

    if args.json:
        print(json.dumps({
            "measured_at": sha, "checkable": total_c, "refusals": total_r,
            "populations": {k: {"checkable": v["checkable"],
                                "refusals": v["refusals"]}
                            for k, v in out.items()},
            "unreadable": SKIPPED}, indent=2))
        return 0

    print("measured at %s\n" % sha)
    for name, v in out.items():
        print("  %-28s checkable %-5d refusals %d"
              % (name, v["checkable"], v["refusals"]))
    print("  %-28s checkable %-5d refusals %d" % ("TOTAL", total_c, total_r))
    print("\n  refuses %d of %d (%.1f%%), measured at %s"
          % (total_r, total_c, pct, sha))
    print("  %d distinct assertions (a unit log carries each one twice)"
          % distinct)
    print("\nEvery refusal, for the ADR-0011 limit 2 read-through:")
    for name, v in out.items():
        for row in v["rows"]:
            print("  [%s] %-40s %-6s rt=%-16s | %s" % ((name,) + row))
    _report_skipped()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
