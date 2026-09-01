#!/usr/bin/env python3
"""Readout for the craftNotes uptake probe — the instrument behind the figures in
ADR-0010's 2026-09-01 ledger row and the architecture guide's references section.

    python3 probe_craftnotes_uptake.py <run-log.json> [<run-log.json> ...]

WHY THIS IS COMMITTED. CI cannot reproduce the measurement — it needs a paid
`record-extraction` run — so the instrument is committed and the docs are checked
against what it printed, the same reason `dev/measured-figures.json` exists.

SELF-TEST, and the only check that matters. Run it against the six committed
baseline logs in `eval/runlogs/unit/record-extraction/`. Every metric must sit at
its pre-probe baseline:

    D 0/25 · R 0 tagged of 1052 notes · Ntests 0 of 16 (ut_020 shows 4/24
    separately) · X 0 of 1638 over 13 tests · Xstr 0 · S 0 · G mean 2.959

A non-zero there means the script drifted from the population it was written for,
not that the world changed. Reproducing the zeros is what licensed trusting it on
the probe run, where the same metrics read D 24/24, R 563/563, Ntests 13/13,
X 289/289, S 0, G 2.000.

THE PROBE RUN'S OWN LOG IS NOT COMMITTED, deliberately. It was written outside the
tracked tree via `--runlogs-root`, because the record-extraction directory holds
six candidates against a keep-limit of five: committing it would have pruned two
baselines and their annotations, and installed a run whose extractor was following
a deliberately wrong rule as the newest baseline.

WHAT THE ARMS MEASURE. The payload was three notes returned from `project_context`:
[0] a required `[record-type]` prefix on every `informant_bias_notes` (a read
receipt), [1] `date_certainty: "calculated"` for a birth year computed from a
stated age (novel craft the agent body does not legislate), and [2] a rule
CONTRADICTING the census informant table in `agents/record-extractor.md` — census
assertions to `informant_proximity: "witness"` (the override arm). None of it is
doctrine; the engine-side payload is reverted.
"""
import collections
import json
import sys

# The 13 tests that persist stated-fact assertions from a census schedule. Every
# one carries non-residence household_member rows in all six committed baselines,
# and zero `witness` rows on that population.
CENSUS13 = {
    "ut_record_extraction_%s" % n
    for n in ("001", "003", "005", "006", "007", "008", "013",
              "014", "018", "020", "022", "026", "027")
}
# Non-census tests whose non-residence `witness` count is 0 in all six baselines.
# 009/010/016 are excluded: they carry small non-zero baselines.
CONTROL8 = {
    "ut_record_extraction_%s" % n
    for n in ("015", "017", "021", "023", "024", "025", "028", "029")
}
# Excluded from Ntests only: the sole test that ever wrote `calculated` at
# baseline (4 of 305 across six runs).
N_EXCLUDE = {"ut_record_extraction_020"}


def _ops(run):
    for call in (run.get("output") or {}).get("tool_calls") or []:
        if not str(call.get("tool") or "").endswith("extraction_append"):
            continue
        for op in ((call.get("args") or {}).get("ops") or []):
            if isinstance(op, dict):
                yield op


def _entries(op):
    """Assertion payloads from one op — `entry` (append) or `fields` (update)."""
    out = []
    entry = op.get("entry")
    if isinstance(entry, dict):
        out.append(entry)
    elif isinstance(entry, list):
        out += [x for x in entry if isinstance(x, dict)]
    fields = op.get("fields")
    if isinstance(fields, dict):
        out.append(fields)
    return out


def main(paths):
    delivered = set()
    delivered_subagent = set()
    pc_calls = pc_with_notes = 0
    payload = None
    notes_total = notes_tagged = 0
    n_hits = collections.Counter()
    n_den = collections.Counter()
    x_hits = collections.Counter()
    x_den = collections.Counter()
    x_string = 0
    leak = collections.Counter()
    persisting = set()
    grades = collections.Counter()

    for path in paths:
        log = json.load(open(path, encoding="utf-8"))
        for test in log.get("tests") or []:
            tid = test.get("test_id")
            for run in test.get("runs") or []:
                for call in (run.get("output") or {}).get("tool_calls") or []:
                    if str(call.get("tool") or "").endswith("project_context"):
                        pc_calls += 1
                        notes = (call.get("response") or {}).get("craftNotes")
                        if isinstance(notes, list) and notes:
                            pc_with_notes += 1
                            delivered.add(tid)
                            payload = payload or notes
                        if call.get("agent_id"):
                            delivered_subagent.add(tid)
                for op in _ops(run):
                    for en in _entries(op):
                        if not any(k in en for k in
                                   ("informant", "informant_proximity", "fact_type")):
                            continue
                        persisting.add(tid)
                        note = en.get("informant_bias_notes")
                        if note:
                            notes_total += 1
                            if str(note).startswith("["):
                                notes_tagged += 1
                        # arm [1] — computed birth year
                        if (en.get("fact_type") == "birth"
                                and en.get("evidence_type") == "indirect"
                                and en.get("date_certainty")):
                            if tid not in N_EXCLUDE:
                                n_den[tid] += 1
                                if en["date_certainty"] == "calculated":
                                    n_hits[tid] += 1
                        # arm [2] — census informant override
                        if (tid in CENSUS13
                                and en.get("fact_type") != "residence"
                                and en.get("record_role") != "absent"
                                and en.get("informant_proximity")):
                            x_den[tid] += 1
                            if en["informant_proximity"] == "witness":
                                x_hits[tid] += 1
                                if "enumerat" in str(en.get("informant") or "").lower():
                                    x_string += 1
                        # specificity leak onto non-census records
                        if (tid in CONTROL8
                                and en.get("fact_type") != "residence"
                                and en.get("informant_proximity") == "witness"):
                            leak[tid] += 1
            for dim in (test.get("outcome_summary") or {}).get("aggregated_dimensions") or []:
                if tid in CENSUS13 and "informant" in str(dim.get("name") or "").lower():
                    if isinstance(dim.get("score"), int):
                        grades[dim["score"]] += 1

    print("=== DELIVERY (gate: >= 25 tests; below that the run measures nothing) ===")
    print("  D    = %d of %d persisting tests saw craftNotes   (%d/%d calls)"
          % (len(delivered), len(persisting), pc_with_notes, pc_calls))
    # Dsub reads 0 against any log in this tree, and that is not a failure: MCP
    # calls carry no `agent_id` unless the probe's one-line addition to
    # skill_runner.py's PreToolUse hook is applied, and that line is reverted.
    # It read 24 during the probe, which is how "the extractor saw it" was told
    # apart from "the router saw it".
    print("  Dsub = %d tests where a SUBAGENT call carried it"
          " (0 unless the skill_runner attribution line is applied)"
          % len(delivered_subagent))
    if payload:
        print("  delivered payload, verbatim (first call):")
        for i, note in enumerate(payload):
            print("    [%d] %s" % (i, note[:120]))

    print("\n=== R — read receipt (baseline: 0 tagged, 32.4% coverage) ===")
    print("  notes written = %d ; starting with '[' = %d (%.1f%%)"
          % (notes_total, notes_tagged,
             100.0 * notes_tagged / notes_total if notes_total else 0.0))

    print("\n=== N — novel craft, date_certainty 'calculated' (baseline 0) ===")
    print("  Ntests = %d of %d   N = %d of %d"
          % (len(n_hits), len(n_den), sum(n_hits.values()), sum(n_den.values())))

    print("\n=== X — the override, census informant -> witness (baseline 0 of 1638) ===")
    print("  Xtests = %d of %d   X = %d of %d   Xstr = %d"
          % (len(x_hits), len(x_den), sum(x_hits.values()), sum(x_den.values()), x_string))
    if x_hits:
        print("  per test: %s" % dict(sorted(
            ("%s" % k, "%d/%d" % (x_hits[k], x_den[k])) for k in x_hits)))

    print("\n=== S — leak onto non-census records (baseline 0) ===")
    print("  S = %d   %s" % (sum(leak.values()), dict(leak)))

    print("\n=== G — Informant identification, census tests (CORROBORATION ONLY) ===")
    total = sum(grades.values())
    mean = sum(k * v for k, v in grades.items()) / total if total else 0.0
    print("  cells %s   mean %.3f   baseline 2.959" % (dict(grades), mean))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
